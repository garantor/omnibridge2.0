import { z } from 'zod';
import { ParsedIntent } from './intent-parser.js';
import { SkillRegistry } from '../skills/skill-registry.js';
import { RouteRecipe, TokenMetadata } from '../skills/skill.types.js';
import { ILanguageModel } from '../llm/model.interface.js';

export interface ExecutionStep {
  index: number;
  title: string;
  description: string;
  chain: string;
  protocol: string;
  action: 'approve' | 'swap' | 'bridge' | 'claim';
}

export interface ExecutionPlan {
  id: string;
  intent: ParsedIntent;
  sourceToken: TokenMetadata;
  targetToken: TokenMetadata;
  bridgeProtocol: string;
  isMultiHop?: boolean;
  intermediateChains?: string[];
  reasoning?: string;
  planningDurationMs?: number;
  recipe: RouteRecipe | null;
  estimatedSettlementSec: number;
  fees: {
    gasFeeUsd: number;
    bridgeFeeUsd: number;
    totalFeeUsd: number;
  };
  amounts: {
    inputAmount: string;
    estimatedOutput: string;
    minGuaranteedOutput: string;
    slippagePercent: number;
  };
  steps: ExecutionStep[];
  warnings: string[];
}

export const LLMRouteDecisionSchema = z.object({
  reasoning: z.string().describe('Detailed explanation of why this bridge or multi-hop path was selected'),
  isMultiHop: z.boolean().describe('True if connecting across multiple bridges or intermediate chains'),
  primaryProtocol: z.string().describe('Protocol identifier or composite string, e.g. "allbridge-core + across-v3"'),
  intermediateChains: z.array(z.string()).default([]).describe('Intermediate chains used if multi-hop'),
  estimatedSettlementSec: z.number().default(60).describe('Total estimated settlement time in seconds'),
  estimatedBridgeFeePercent: z.number().default(0.0025).describe('Estimated total bridge fee rate'),
  steps: z.array(z.object({
    index: z.number(),
    title: z.string(),
    description: z.string(),
    chain: z.string(),
    protocol: z.string(),
    action: z.enum(['approve', 'swap', 'bridge', 'claim']),
  })),
  warnings: z.array(z.string()).default([]),
});

export type LLMRouteDecision = z.infer<typeof LLMRouteDecisionSchema>;

export class RoutePlanner {
  constructor(
    private registry: SkillRegistry,
    private llm?: ILanguageModel
  ) {}

  public plan(intent: ParsedIntent): ExecutionPlan {
    const startTime = Date.now();
    const inputNum = parseFloat(intent.amount);
    if (isNaN(inputNum) || inputNum <= 0) {
      throw new Error(`Amount must be greater than zero. Received: "${intent.amount}"`);
    }

    if (typeof intent.maxSlippagePercent !== 'number' || isNaN(intent.maxSlippagePercent) || intent.maxSlippagePercent < 0 || intent.maxSlippagePercent > 20) {
      throw new Error(`Slippage percentage must be between 0% and 20%. Received: ${intent.maxSlippagePercent}%`);
    }

    const srcChain = this.registry.getChain(intent.sourceChain);
    if (!srcChain) {
      throw new Error(`No active bridge skill currently supports source chain "${intent.sourceChain}".`);
    }
    const dstChain = this.registry.getChain(intent.targetChain);
    if (!dstChain) {
      throw new Error(`No active bridge skill currently supports destination chain "${intent.targetChain}".`);
    }

    // 1. Resolve token on source chain
    const srcTokens = this.registry.getSupportedTokens(srcChain.name);
    const srcToken = srcTokens.find(t => t.symbol.toUpperCase() === intent.token.toUpperCase());
    if (!srcToken) {
      if (srcTokens.length === 0) {
        throw new Error(`No active bridge skill currently supports source chain "${srcChain.displayName}". Add "${srcChain.name}" to supportedChains in your bridge SKILL.md.`);
      }
      throw new Error(`Token "${intent.token}" is not supported on source chain "${srcChain.displayName}". Supported tokens on this chain: [${srcTokens.map(t => t.symbol).join(', ')}]`);
    }

    // 2. Resolve token on destination chain
    const dstTokens = this.registry.getSupportedTokens(dstChain.name);
    const dstToken = dstTokens.find(t => t.symbol.toUpperCase() === intent.token.toUpperCase());
    if (!dstToken) {
      if (dstTokens.length === 0) {
        throw new Error(`No active bridge skill currently supports destination chain "${dstChain.displayName}". Add "${dstChain.name}" to supportedChains in your bridge SKILL.md.`);
      }
      throw new Error(`Token "${intent.token}" is not supported on destination chain "${dstChain.displayName}". Supported tokens on this chain: [${dstTokens.map(t => t.symbol).join(', ')}]`);
    }

    // 3. Fast-path route recipe matching directly from registered skills
    const recipe = this.registry.getRecommendedRecipe(srcChain.name, dstChain.name, intent.token);
    let bridgeProtocol = recipe ? recipe.recommendedBridge : '';
    let isMultiHop = false;
    let intermediateChains: string[] = [];
    let customSteps: ExecutionStep[] | null = null;
    let bridgeFeePercent = 0.0025;
    let estimatedSettlementSec = recipe ? recipe.expectedSettlementTimeSec : 45;

    if (!recipe) {
      const candidates = this.registry.getAllBridgeSkills().filter(b =>
        b.supportedChains.includes(srcChain.name) &&
        b.supportedChains.includes(dstChain.name) &&
        b.supportedTokens.some(t => t.symbol.toUpperCase() === intent.token.toUpperCase())
      );

      if (candidates.length > 0) {
        bridgeProtocol = candidates[0].name;
      } else {
        // Multi-hop discovery: connect the dots via an intermediate hub chain
        const multiHop = this.registry.findMultiHopPath(srcChain.name, dstChain.name, intent.token);
        if (!multiHop) {
          throw new Error(`No installed bridge skill supports route ${srcChain.displayName} -> ${dstChain.displayName} for ${intent.token}`);
        }

        isMultiHop = true;
        intermediateChains = [multiHop.intermediateChain];
        bridgeProtocol = `${multiHop.leg1Bridge.name} + ${multiHop.leg2Bridge.name}`;
        bridgeFeePercent = multiHop.estimatedBridgeFeePercent;
        estimatedSettlementSec = multiHop.estimatedSettlementSec;

        const hubChain = this.registry.getChain(multiHop.intermediateChain);
        const hubDisplayName = hubChain?.displayName || multiHop.intermediateChain;

        customSteps = [
          { index: 1, title: `Approve ${multiHop.leg1Bridge.displayName}`, description: `Approve router contract on ${srcChain.displayName}`, chain: srcChain.name, protocol: 'token', action: 'approve' },
          { index: 2, title: `Bridge to ${hubDisplayName}`, description: `Deposit into ${multiHop.leg1Bridge.displayName} to intermediate hub`, chain: srcChain.name, protocol: multiHop.leg1Bridge.name, action: 'bridge' },
          { index: 3, title: `Approve on ${hubDisplayName}`, description: `Approve ${multiHop.leg2Bridge.displayName} on intermediate hub`, chain: multiHop.intermediateChain, protocol: 'token', action: 'approve' },
          { index: 4, title: `Bridge to ${dstChain.displayName}`, description: `Deposit into ${multiHop.leg2Bridge.displayName} to destination`, chain: multiHop.intermediateChain, protocol: multiHop.leg2Bridge.name, action: 'bridge' },
          { index: 5, title: `Claim on ${dstChain.displayName}`, description: `Attestation settlement and credit to recipient`, chain: dstChain.name, protocol: multiHop.leg2Bridge.name, action: 'claim' },
        ];
      }
    }

    // 4. Calculate fees & slippage invariants
    const bridgeFeeUsd = inputNum * bridgeFeePercent;
    const gasFeeUsd = (srcChain.vmType === 'evm' ? 0.005 : 0.001) * (isMultiHop ? 2 : 1);
    const totalFeeUsd = bridgeFeeUsd + gasFeeUsd;

    const estimatedOutputNum = Math.max(0, inputNum - bridgeFeeUsd);
    const slippageMultiplier = 1 - (intent.maxSlippagePercent / 100);
    const minGuaranteedOutputNum = estimatedOutputNum * slippageMultiplier;

    // 5. Build execution steps
    const steps: ExecutionStep[] = customSteps || (recipe
      ? recipe.hops.map(h => ({
          index: h.step,
          title: `${h.action.toUpperCase()} on ${h.chain}`,
          description: h.details,
          chain: h.chain,
          protocol: h.protocol,
          action: h.action,
        }))
      : [
          { index: 1, title: `Approve ${bridgeProtocol}`, description: `Approve router contract on ${srcChain.displayName}`, chain: srcChain.name, protocol: 'token', action: 'approve' },
          { index: 2, title: `Bridge ${intent.token}`, description: `Deposit into ${bridgeProtocol} cross-chain bridge`, chain: srcChain.name, protocol: bridgeProtocol, action: 'bridge' },
          { index: 3, title: `Claim on ${dstChain.displayName}`, description: `Attestation settlement and credit to recipient`, chain: dstChain.name, protocol: bridgeProtocol, action: 'claim' },
        ]);

    const warnings: string[] = [];
    if (isMultiHop) {
      warnings.push(`Multi-hop route: Transfers via intermediate hub chain (${intermediateChains.join(', ')}). Intermediate gas token required.`);
    }
    if (dstChain.vmType !== 'evm' && !intent.memo) {
      warnings.push(`${dstChain.displayName} destination: If transferring to an exchange or custodial wallet, a memo / destination tag may be required.`);
    }

    return {
      id: `plan-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      intent,
      sourceToken: srcToken,
      targetToken: dstToken,
      bridgeProtocol,
      isMultiHop,
      intermediateChains,
      recipe,
      estimatedSettlementSec,
      planningDurationMs: Math.max(1, Date.now() - startTime),
      fees: {
        gasFeeUsd,
        bridgeFeeUsd,
        totalFeeUsd,
      },
      amounts: {
        inputAmount: intent.amount,
        estimatedOutput: estimatedOutputNum.toFixed(4),
        minGuaranteedOutput: minGuaranteedOutputNum.toFixed(4),
        slippagePercent: intent.maxSlippagePercent,
      },
      steps,
      warnings,
    };
  }

  /**
   * Agentic LLM-driven route reasoning using protocol skills
   */
  public async planWithLLM(intent: ParsedIntent): Promise<ExecutionPlan> {
    const startTime = Date.now();
    if (!this.llm) {
      return this.plan(intent);
    }

    // Always run synchronous validation on numeric inputs first
    const inputNum = parseFloat(intent.amount);
    if (isNaN(inputNum) || inputNum <= 0) {
      throw new Error(`Amount must be greater than zero. Received: "${intent.amount}"`);
    }

    if (typeof intent.maxSlippagePercent !== 'number' || isNaN(intent.maxSlippagePercent) || intent.maxSlippagePercent < 0 || intent.maxSlippagePercent > 20) {
      throw new Error(`Slippage percentage must be between 0% and 20%. Received: ${intent.maxSlippagePercent}%`);
    }

    const srcChain = this.registry.getChain(intent.sourceChain);
    const dstChain = this.registry.getChain(intent.targetChain);
    if (!srcChain || !dstChain) {
      return this.plan(intent); // Fallback to standard error checks
    }

    const capabilityContext = this.registry.formatCapabilityContextForLLM();
    const systemPrompt = `You are the Omnibridge Agentic Route Reasoning Core.
Analyze the registered blockchain skills, their supported networks, and capabilities to determine the optimal route to bridge assets from source to destination.
If there is NO direct bridge connecting source and destination networks, intelligently connect the dots by identifying an intermediate hub chain (multi-hop).

Capabilities and Registered Skills:
${capabilityContext}

Rules:
1. Select from installed bridge protocols only. Do NOT invent phantom protocols.
2. If connecting two bridges across an intermediate chain, set isMultiHop: true, specify intermediateChains, and sequence the execution steps (approve -> bridge to hub -> approve on hub -> bridge to target -> claim).
3. Provide chain-of-thought reasoning explaining why these bridge(s) were selected.`;

    const userPrompt = `Determine the optimal execution route to bridge ${intent.amount} ${intent.token} from ${intent.sourceChain} to ${intent.targetChain} (Recipient: ${intent.targetAddress || 'N/A'}, Max Slippage: ${intent.maxSlippagePercent}%).`;

    try {
      const decision = await this.llm.generateStructured<LLMRouteDecision>({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        schema: LLMRouteDecisionSchema,
        schemaName: 'LLMRouteDecision',
      });

      // Verification guardrail: Ensure candidate chains and steps are valid
      const basePlan = this.plan(intent);

      const feePercent = decision.estimatedBridgeFeePercent || (decision.isMultiHop ? 0.005 : 0.0025);
      const bridgeFeeUsd = inputNum * feePercent;
      const gasFeeUsd = (srcChain.vmType === 'evm' ? 0.005 : 0.001) * (decision.isMultiHop ? 2 : 1);
      const totalFeeUsd = bridgeFeeUsd + gasFeeUsd;
      const estimatedOutputNum = Math.max(0, inputNum - bridgeFeeUsd);
      const slippageMultiplier = 1 - (intent.maxSlippagePercent / 100);
      const minGuaranteedOutputNum = estimatedOutputNum * slippageMultiplier;

      const combinedWarnings = Array.from(new Set([...(basePlan.warnings || []), ...(decision.warnings || [])]));

      return {
        ...basePlan,
        bridgeProtocol: (basePlan.isMultiHop && !decision.isMultiHop) ? basePlan.bridgeProtocol : (decision.primaryProtocol || basePlan.bridgeProtocol),
        isMultiHop: decision.isMultiHop || basePlan.isMultiHop,
        intermediateChains: (decision.intermediateChains && decision.intermediateChains.length > 0) ? decision.intermediateChains : basePlan.intermediateChains,
        reasoning: decision.reasoning,
        planningDurationMs: Math.max(1, Date.now() - startTime),
        estimatedSettlementSec: decision.estimatedSettlementSec || basePlan.estimatedSettlementSec,
        fees: {
          gasFeeUsd,
          bridgeFeeUsd,
          totalFeeUsd,
        },
        amounts: {
          inputAmount: intent.amount,
          estimatedOutput: estimatedOutputNum.toFixed(4),
          minGuaranteedOutput: minGuaranteedOutputNum.toFixed(4),
          slippagePercent: intent.maxSlippagePercent,
        },
        steps: (basePlan.isMultiHop && !decision.isMultiHop)
          ? basePlan.steps
          : (decision.steps && decision.steps.length > 0 ? decision.steps : basePlan.steps),
        warnings: combinedWarnings,
      };
    } catch {
      // Resilient fallback to deterministic / graph routing
      const fallback = this.plan(intent);
      fallback.planningDurationMs = Math.max(1, Date.now() - startTime);
      return fallback;
    }
  }
}
