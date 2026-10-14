import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import readline from 'node:readline';
import { OmnibridgeEngine } from '../core/engine.js';
import { createLanguageModel } from '../core/llm/model-provider.js';

export function createCli(): Command {
  const program = new Command();

  program
    .name('omnibridge')
    .description('Modular Just-In-Time (JIT) Cross-Chain Blockchain Bridge Engine & CLI')
    .version('1.1.0');

  // Main natural language intent command (Default)
  program
    .argument('[intent...]', 'Natural language cross-chain intent (e.g. "Bridge 250 USDC from Polygon to Stellar")')
    .option('-d, --dry-run', 'Simulate and generate JIT code without broadcasting transactions', false)
    .option('-y, --yes', 'Automatically approve execution without prompting', false)
    .option('-m, --model <model>', 'LLM model to use')
    .option('-p, --provider <provider>', 'LLM provider (openai-compatible, mock, anthropic, gemini)')
    .action(async (intentParts: string[], options) => {
      const intentText = intentParts.join(' ').trim();
      if (!intentText) {
        program.help();
        return;
      }

      const llm = createLanguageModel({
        provider: options.provider,
        model: options.model,
      });

      const engine = new OmnibridgeEngine({
        llm,
        autoApprove: options.yes,
      });

      try {
        console.log(chalk.bold.cyan(`\n⚡ Omnibridge Engine parsing intent: "${intentText}"...\n`));
        const result = await engine.execute(intentText, { dryRun: options.dryRun });

        if (result.success && !options.dryRun) {
          console.log(chalk.bold.green(`\n✔ Bridge transfer broadcasted successfully!`));
          console.log(`${chalk.bold('Transaction Hash:')} ${chalk.cyan(result.txHash)}`);
          console.log(`${chalk.bold('Expected Settlement:')} ~${result.plan.estimatedSettlementSec} seconds`);
        } else if (result.success && options.dryRun) {
          console.log(chalk.bold.yellow(`\nℹ Dry-run simulation finished successfully.`));
          console.log(`${chalk.bold('Synthesized Script:')} ${result.script.filePath}`);
          console.log(`${chalk.bold('Min Output:')} ${result.plan.amounts.minGuaranteedOutput} ${result.plan.targetToken.symbol}`);
        } else {
          console.log(chalk.bold.red(`\n✖ Execution aborted: ${result.error}`));
        }
      } catch (err: any) {
        console.error(chalk.bold.red(`\n✖ Error: ${err.message}`));
        process.exitCode = 1;
      }
    });

  // Chains command
  program
    .command('chains')
    .description('List all supported blockchain networks discovered from skills and seed catalog')
    .action(async () => {
      const engine = new OmnibridgeEngine();
      await engine.init();
      const chains = engine.registry.getSupportedChains();

      const table = new Table({
        head: [chalk.bold.cyan('Chain'), chalk.bold.cyan('VM Type'), chalk.bold.cyan('Chain ID'), chalk.bold.cyan('Native Gas'), chalk.bold.cyan('Supported Tokens')],
      });

      for (const chain of chains) {
        table.push([
          chain.displayName,
          chain.vmType.toUpperCase(),
          chain.chainId.toString(),
          chain.nativeToken.symbol,
          chain.supportedTokens.map(t => t.symbol).join(', ') || 'None',
        ]);
      }

      console.log(chalk.bold('\n🌐 SUPPORTED BLOCKCHAIN NETWORKS:'));
      console.log(table.toString());
      console.log(chalk.dim(`Total Networks: ${chains.length}\n`));
    });

  // Tokens command
  program
    .command('tokens')
    .description('List supported tokens per chain')
    .option('-c, --chain <chain>', 'Filter by chain name')
    .action(async (options) => {
      const engine = new OmnibridgeEngine();
      await engine.init();
      const tokens = engine.registry.getSupportedTokens(options.chain);

      const table = new Table({
        head: [chalk.bold.cyan('Chain'), chalk.bold.cyan('Symbol'), chalk.bold.cyan('Name'), chalk.bold.cyan('Decimals'), chalk.bold.cyan('Address / Identifier')],
      });

      for (const token of tokens) {
        table.push([
          token.chain,
          chalk.bold.yellow(token.symbol),
          token.name || '-',
          token.decimals.toString(),
          chalk.dim(token.address),
        ]);
      }

      console.log(chalk.bold('\n🪙 SUPPORTED TOKENS & ASSETS:'));
      console.log(table.toString());
      console.log(chalk.dim(`Total Assets: ${tokens.length}\n`));
    });

  // Routes command
  program
    .command('routes')
    .description('List cross-chain pathways and pre-approved fast recipes')
    .action(async () => {
      const engine = new OmnibridgeEngine();
      await engine.init();
      const routes = engine.registry.getAvailableRoutes();

      const table = new Table({
        head: [chalk.bold.cyan('Route'), chalk.bold.cyan('Asset'), chalk.bold.cyan('Bridge Protocol'), chalk.bold.cyan('Est. Settlement')],
      });

      for (const r of routes) {
        table.push([
          `${chalk.green(r.sourceChain)} -> ${chalk.green(r.targetChain)}`,
          chalk.yellow(r.tokenSymbol),
          chalk.cyan(r.bridge),
          `~${r.estimatedSettlementSec}s`,
        ]);
      }

      console.log(chalk.bold('\n🌉 CROSS-CHAIN BRIDGE ROUTES & FAST RECIPES:'));
      console.log(table.toString());
      console.log(chalk.dim(`Total Routes: ${routes.length}\n`));
    });

  // REPL interactive shell
  program
    .command('repl')
    .description('Start interactive Omnibridge intent shell')
    .action(async () => {
      const engine = new OmnibridgeEngine();
      await engine.init();

      console.log(chalk.bold.cyan('\n🚀 Omnibridge Interactive REPL'));
      console.log(chalk.dim('Type your cross-chain intent or "exit" to quit.\n'));

      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

      const promptUser = () => {
        rl.question(chalk.bold.green('omnibridge> '), async (input) => {
          const trimmed = input.trim();
          if (trimmed === 'exit' || trimmed === 'quit') {
            rl.close();
            return;
          }
          if (trimmed) {
            try {
              await engine.execute(trimmed);
            } catch (err: any) {
              console.error(chalk.red(`Error: ${err.message}`));
            }
          }
          promptUser();
        });
      };
      promptUser();
    });

  return program;
}
