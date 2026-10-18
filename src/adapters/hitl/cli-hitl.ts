import chalk from 'chalk';
import boxen from 'boxen';
import readline from 'node:readline';
import { AuditPayload, HITLApprovalResponse, IHITLHandler } from './hitl.interface.js';

export class CliHITLHandler implements IHITLHandler {
  constructor(private autoApprove: boolean = false) {}

  public async requestApproval(payload: AuditPayload): Promise<HITLApprovalResponse> {
    const cardContent = this.formatAuditCard(payload);
    console.log(cardContent);

    if (this.autoApprove) {
      console.log(chalk.yellow('[AUTO-APPROVE] Flag detected. Approving execution immediately.'));
      return { approved: true };
    }

    if (payload.requiresPhraseConfirmation && payload.confirmationPhrase) {
      return this.promptPhraseConfirmation(payload.confirmationPhrase);
    }

    return this.promptInteractive(payload);
  }

  private formatAuditCard(p: AuditPayload): string {
    const riskColor = p.riskLevel === 'LOW' ? chalk.green : p.riskLevel === 'MEDIUM' ? chalk.yellow : chalk.red;

    const sections = [
      chalk.bold.cyan('OMNIBRIDGE JIT EXECUTION GATE'),
      '',
      `${chalk.bold('Intent:')}           "${p.intent}"${p.resolvedBy ? ` ${chalk.dim(`[${p.resolvedBy}]`)}` : ''}`,
      `${chalk.bold('Selected Route:')}   ${chalk.green(p.source.chain)} ──[ ${chalk.bold.yellow(p.bridge.protocol)} ]──> ${chalk.green(p.destination.chain)}${p.decisionLatencyMs !== undefined ? ` ${chalk.dim(`(Decision time: ${p.decisionLatencyMs}ms)`)}` : ''}`,
      ...(p.reasoning ? [`${chalk.bold('Reasoning:')}        ${chalk.dim(p.reasoning)}`] : []),
      `${chalk.bold('Safety Score:')}     ${riskColor(`${p.safetyScore}/100 (${p.riskLevel} RISK)`)}`,
      '',
      chalk.gray('─'.repeat(68)),
      chalk.bold.white('TRANSFER DETAILS'),
      chalk.gray('─'.repeat(68)),
      `${chalk.bold('Source Chain:')}     ${p.source.chain}`,
      `${chalk.bold('Source Asset:')}     ${p.source.amount} ${p.source.tokenSymbol} (${chalk.dim(p.source.tokenAddress)})`,
      `${chalk.bold('Bridge Protocol:')}  ${p.bridge.protocol}`,
      `${chalk.bold('Estimated Fees:')}   Bridge: ${p.bridge.estimatedBridgeFee} | Gas: ${p.bridge.estimatedGasFee}`,
      '',
      `${chalk.bold('Target Chain:')}     ${p.destination.chain}`,
      `${chalk.bold('Target Wallet:')}    ${chalk.cyan(p.destination.walletAddress)}`,
      `${chalk.bold('Estimated Output:')} ${chalk.green(p.destination.estimatedOutput)} ${p.destination.tokenSymbol} (Min Guaranteed: ${chalk.yellow(p.destination.minGuaranteedOutput)})`,
      `${chalk.bold('Slippage Limit:')}   ${p.destination.maxSlippagePercent}%`,
      '',
      chalk.gray('─'.repeat(68)),
      chalk.bold.white('INSPECTION & CODE AUDIT'),
      chalk.gray('─'.repeat(68)),
      `${chalk.bold('Ephemeral Script:')} ${chalk.dim(p.generatedScriptPath)}`,
      `${chalk.bold('AST Linter:')}       ${p.simulation.astSecurityPassed ? chalk.green('PASSED') : chalk.red('FAILED')}`,
      `${chalk.bold('Simulation:')}       ${p.simulation.status === 'SUCCESS' ? chalk.green(`SUCCESS (${p.simulation.gasUnitsUsed.toLocaleString()} gas units)`) : chalk.red('REVERTED')}`,
      '',
      chalk.bold('Action Sequence:'),
      ...p.steps.map(s => `  ${chalk.cyan(`[Step ${s.index}]`)} ${s.title}: ${chalk.dim(s.description)}`),
    ];

    if (p.warnings.length > 0) {
      sections.push('');
      sections.push(chalk.yellow.bold('WARNINGS:'));
      p.warnings.forEach(w => sections.push(chalk.yellow(`  ⚠ ${w}`)));
    }

    return boxen(sections.join('\n'), {
      padding: 1,
      margin: 1,
      borderColor: p.riskLevel === 'LOW' ? 'cyan' : 'yellow',
      borderStyle: 'round',
    });
  }

  private async promptInteractive(payload: AuditPayload): Promise<HITLApprovalResponse> {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    return new Promise(resolve => {
      const ask = () => {
        rl.question(chalk.bold.white('\nAuthorize bridge execution? [y/N] to proceed, [v] to view generated code, [a] to abort: '), answer => {
          const cleaned = answer.trim().toLowerCase();

          if (cleaned === 'y' || cleaned === 'yes') {
            rl.close();
            resolve({ approved: true });
          } else if (cleaned === 'v' || cleaned === 'view') {
            console.log(chalk.cyan('\n--- GENERATED TYPESCRIPT JIT SCRIPT PREVIEW ---'));
            console.log(chalk.gray(payload.generatedCodePreview));
            console.log(chalk.cyan('--- END PREVIEW ---\n'));
            ask();
          } else {
            rl.close();
            resolve({ approved: false, rejectionReason: 'User declined or aborted execution' });
          }
        });
      };
      ask();
    });
  }

  private async promptPhraseConfirmation(requiredPhrase: string): Promise<HITLApprovalResponse> {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    return new Promise(resolve => {
      console.log(chalk.yellow.bold(`\nHigh-value security gate activated.`));
      console.log(chalk.white(`Please type the confirmation phrase exactly as shown:`));
      console.log(chalk.bold.cyan(`  ${requiredPhrase}\n`));

      rl.question('Type confirmation phrase (or "abort"): ', answer => {
        rl.close();
        if (answer.trim() === requiredPhrase) {
          resolve({ approved: true });
        } else {
          resolve({ approved: false, rejectionReason: 'Confirmation phrase did not match' });
        }
      });
    });
  }
}
