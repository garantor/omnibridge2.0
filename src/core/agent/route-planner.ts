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
    const srcToken = srcTokens.find(t => t.symbol.toUpperCase() === intent.token.toUpperCase()) || {
      symbol: intent.token,
      name: intent.token,
      address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
      decimals: 6,
      chain: srcChain.name,
    };

    // 2. Resolve token on destination chain
    const dstTokens = this.registry.getSupportedTokens(dstChain.name);
    const dstToken = dstTokens.find(t => t.symbol.toUpperCase() === intent.token.toUpperCase()) || {
      symbol: intent.token,
      name: intent.token,
      address: dstChain.vmType === 'stellar'
        ? 'USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN'
        : '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      decimals: 6,
      chain: dstChain.name,
    };

    // 3. Fast-path route recipe matching
    const recipe = this.registry.getRecommendedRecipe(srcChain.name, dstChain.name, intent.token);
    const bridgeProtocol = recipe ? recipe.recommendedBridge : this.inferBridge(srcChain.name, dstChain.name, intent.token);

    // 4. Calculate fees & slippage invariants
    const inputNum = parseFloat(intent.amount) || 0;
    const bridgeFeePercent = bridgeProtocol === 'circle-cctp' ? 0.0 : 0.0025; // 0% for CCTP, 0.25% for AMM/Relayers
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
    if (dstChain.vmType === 'stellar' && !intent.memo) {
      warnings.push('Stellar destination: Ensure account has an active USDC trustline. If sending to an exchange, a memo tag is required.');
    }
    if (dstChain.vmType === 'xrpl' && !intent.memo) {
      warnings.push('XRPL destination: Ensure wallet does not require a Destination Tag.');
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

  private inferBridge(src: string, dst: string, token: string): string {
    if (token.toUpperCase() === 'USDC' && ['polygon', 'base', 'arbitrum'].includes(src) && ['polygon', 'base', 'arbitrum'].includes(dst)) {
      return 'circle-cctp';
    }
    if (src === 'stellar' || dst === 'stellar') {
      return 'allbridge-core';
    }
    return 'across-v3';
  }
}
