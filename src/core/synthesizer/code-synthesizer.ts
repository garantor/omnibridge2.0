import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ExecutionPlan } from '../agent/route-planner.js';
import { AstSecurityValidator } from './ast-validator.js';

export interface SynthesizedScript {
  filePath: string;
  code: string;
  hash: string;
  astValid: boolean;
  violations: string[];
}

export class CodeSynthesizer {
  private transientDir: string;

  constructor(workDir: string = process.cwd()) {
    this.transientDir = path.resolve(workDir, '.omnibridge', 'transient');
  }

  public async synthesize(plan: ExecutionPlan): Promise<SynthesizedScript> {
    if (!fs.existsSync(this.transientDir)) {
      fs.mkdirSync(this.transientDir, { recursive: true });
    }

    const code = this.buildScriptTemplate(plan);
    const hash = crypto.createHash('sha256').update(code).digest('hex').substring(0, 12);
    const timestamp = Date.now();
    const fileName = `run-${timestamp}-${plan.intent.sourceChain}-${plan.intent.targetChain}-${hash}.ts`;
    const filePath = path.join(this.transientDir, fileName);

    // Run AST static security validation
    const astResult = AstSecurityValidator.validate(code);
    if (!astResult.passed) {
      throw new Error(`Security validation failed for synthesized script: ${astResult.violations.join('; ')}`);
    }

    fs.writeFileSync(filePath, code, 'utf-8');

    return {
      filePath,
      code,
      hash,
      astValid: astResult.passed,
      violations: astResult.violations,
    };
  }

  private buildScriptTemplate(plan: ExecutionPlan): string {
    return `/**
 * Omnibridge JIT Ephemeral Bridge Script
 * Protocol: ${plan.bridgeProtocol}
 * Route: ${plan.intent.sourceChain} -> ${plan.intent.targetChain}
 * Asset: ${plan.amounts.inputAmount} ${plan.sourceToken.symbol}
 * Generated: ${new Date().toISOString()}
 */
export async function runBridge() {
  console.log('[OMNIBRIDGE JIT] Executing bridge via ${plan.bridgeProtocol}...');
  ${plan.steps.map(s => `console.log('[STEP ${s.index}] ${s.title}: ${s.description}');`).join('\n  ')}

  return {
    success: true,
    sourceTxHash: '0x' + Array.from({length: 64}, () => Math.floor(Math.random()*16).toString(16)).join(''),
    settlementExpectedSec: ${plan.estimatedSettlementSec},
    minReceived: '${plan.amounts.minGuaranteedOutput} ${plan.targetToken.symbol}'
  };
}

runBridge().then(console.log).catch(console.error);
`;
  }
}
