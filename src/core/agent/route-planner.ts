import { ParsedIntent } from './intent-parser.js';
import { SkillRegistry } from '../skills/skill-registry.js';
import { RouteRecipe, TokenMetadata } from '../skills/skill.types.js';

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

export class RoutePlanner {
  constructor(private registry: SkillRegistry) {}

  public plan(intent: ParsedIntent): ExecutionPlan {
    const srcChain = this.registry.getChain(intent.sourceChain)!;
    const dstChain = this.registry.getChain(intent.targetChain)!;

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
    if (!recipe) {
      const candidates = this.registry.getAllBridgeSkills().filter(b =>
        b.supportedChains.includes(srcChain.name) &&
        b.supportedChains.includes(dstChain.name) &&
        b.supportedTokens.some(t => t.symbol.toUpperCase() === intent.token.toUpperCase())
      );
      if (candidates.length === 0) {
        throw new Error(`No installed bridge skill supports route ${srcChain.displayName} -> ${dstChain.displayName} for ${intent.token}`);
      }
    }
    const bridgeProtocol = recipe ? recipe.recommendedBridge : this.registry.getAllBridgeSkills()[0]?.name;

    // 4. Calculate fees & slippage invariants
    const inputNum = parseFloat(intent.amount) || 0;
    const bridgeFeePercent = 0.0025; // Default standard base fee rate
    const bridgeFeeUsd = inputNum * bridgeFeePercent;
    const gasFeeUsd = srcChain.vmType === 'evm' ? 0.005 : 0.001;
    const totalFeeUsd = bridgeFeeUsd + gasFeeUsd;

    const estimatedOutputNum = Math.max(0, inputNum - bridgeFeeUsd);
    const slippageMultiplier = 1 - (intent.maxSlippagePercent / 100);
    const minGuaranteedOutputNum = estimatedOutputNum * slippageMultiplier;

    // 5. Build execution steps
    const steps: ExecutionStep[] = recipe
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
        ];

    const warnings: string[] = [];
    if (dstChain.vmType !== 'evm' && !intent.memo) {
      warnings.push(`${dstChain.displayName} destination: If transferring to an exchange or custodial wallet, a memo / destination tag may be required.`);
    }

    return {
      id: `plan-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      intent,
      sourceToken: srcToken,
      targetToken: dstToken,
      bridgeProtocol,
      recipe,
      estimatedSettlementSec: recipe ? recipe.expectedSettlementTimeSec : 45,
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
}
