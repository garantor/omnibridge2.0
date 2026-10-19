import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import readline from 'node:readline';
import { OmnibridgeEngine } from '../core/engine.js';
import { createLanguageModel } from '../core/llm/model-provider.js';
import { LiveExecutor } from '../core/execution/live-executor.js';

export function createCli(): Command {
  const program = new Command();

  program
    .name('omnibridge')
    .description('Modular Just-In-Time (JIT) Cross-Chain Blockchain Bridge Engine & CLI')
    .version('1.2.0');

  // Main natural language intent command (Default)
  program
    .argument('[intent...]', 'Natural language cross-chain intent (e.g. "Bridge 250 USDC from Polygon to Stellar")')
    .option('-d, --dry-run', 'Simulate and generate JIT code without broadcasting transactions', false)
    .option('-y, --yes', 'Automatically approve execution without prompting', false)
    .option('-v, --verbose', 'Print raw structured model response and debug details', false)
    .option('-m, --model <model>', 'LLM model to use')
    .option('-p, --provider <provider>', 'LLM provider (openai-compatible, mock, anthropic, gemini)')
    .action(async (intentParts: string[], options) => {
      let intentText = intentParts.join(' ').trim();
      if (!intentText || intentText.toLowerCase() === 'intent') {
        program.help();
        return;
      }

      if (intentText.toLowerCase().startsWith('intent ')) {
        intentText = intentText.substring(7).trim();
      }

      const llm = createLanguageModel({
        provider: options.provider,
        model: options.model,
      });

      const engine = new OmnibridgeEngine({
        llm,
        autoApprove: options.yes,
      });

      const signer = LiveExecutor.getSignerAccount();
      try {
        await engine.init();

        // Check if query is out of scope (e.g. conversational greetings, general questions)
        const chatSession = engine.createChatSession();
        const chatReply = await chatSession.sendMessage(intentText);
        if (chatReply.scope === 'OUT_OF_SCOPE') {
          console.log(chalk.bold.yellow(`\nℹ ${chatReply.message}\n`));
          return;
        }

        console.log(chalk.bold.cyan(`\n⚡ Omnibridge Engine parsing intent: "${intentText}"...`));
        engine.events.on('intent:parsed', (event: any) => {
          const intent = event?.data || event;
          const resolvedBy = intent?.resolvedBy;
          if (resolvedBy) {
            console.log(chalk.dim(`   ↳ Resolved via: ${chalk.bold.yellow(resolvedBy)}`));
          }
          if (options.verbose) {
            console.log(chalk.bold.white('📦 Model Decomposition Output:'));
            console.log(chalk.green(JSON.stringify(intent, null, 2)));
          }
        });

        engine.events.on('route:planned', (event: any) => {
          const plan = event?.data || event;
          const durationStr = plan?.planningDurationMs !== undefined ? ` (Decision time: ${plan.planningDurationMs}ms)` : '';
          console.log(chalk.bold.cyan(`\n⚡ Route Decision Engine${durationStr}:`));
          console.log(chalk.dim(`   ↳ Selected Route: ${chalk.bold.green(plan.intent.sourceChain)} ──[ ${chalk.bold.yellow(plan.bridgeProtocol)} ]──> ${chalk.bold.green(plan.intent.targetChain)}`));
          if (plan.isMultiHop && plan.intermediateChains?.length) {
            console.log(chalk.dim(`   ↳ Multi-Hop Connection: via intermediate hub ${chalk.bold.magenta(plan.intermediateChains.join(', '))}`));
          }
          if (plan.reasoning) {
            console.log(chalk.dim(`   ↳ Reasoning: ${plan.reasoning}`));
          }
          console.log(chalk.dim(`   ↳ Action Plan: ${plan.steps.length} sequential execution steps scheduled`));
        });

        engine.events.on('script:synthesized', (event: any) => {
          const script = event?.data || event;
          console.log(chalk.bold.cyan(`\n⚡ JIT Code Synthesis & AST Security:`));
          console.log(chalk.dim(`   ↳ Single-use script: ${chalk.white(script.filePath)}`));
          console.log(chalk.dim(`   ↳ AST Sandbox Linter: ${script.astValid ? chalk.green('PASSED (0 violations)') : chalk.red('FAILED')}`));
        });

        engine.events.on('simulation:complete', (event: any) => {
          const sim = event?.data || event;
          console.log(chalk.bold.cyan(`\n⚡ Pre-Flight Simulation Dry-Run:`));
          console.log(chalk.dim(`   ↳ Contract simulation: ${sim.status === 'SUCCESS' ? chalk.green('SUCCESS') : chalk.red('REVERT')}`));
          console.log(chalk.dim(`   ↳ Gas consumption: ${sim.gasUnitsUsed.toLocaleString()} gas units ($${sim.gasCostEstimatedUsd.toFixed(4)})\n`));
        });
        const result = await engine.execute(intentText, {
          dryRun: options.dryRun,
          targetAddress: signer?.address,
        });

        if (result.success && !options.dryRun) {
          if (result.isLive && result.txHash) {
            console.log(chalk.bold.green(`\n✔ Real Mainnet Transfer broadcasted successfully!`));
            console.log(`${chalk.bold('Transaction Hash:')} ${chalk.cyan(result.txHash)}`);
            if (result.explorerUrl) {
              console.log(`${chalk.bold('Block Explorer:')} ${chalk.underline.blue(result.explorerUrl)}`);
            }
            console.log(`${chalk.bold('Expected Settlement:')} ~${result.plan.estimatedSettlementSec} seconds`);
          } else {
            console.log(chalk.bold.yellow(`\nℹ Local Simulation Completed (Not broadcasted on-chain)`));
            if (result.error) {
              console.log(chalk.dim(`Note: ${result.error}`));
            }
          }
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

  // Bridges / Protocols command
  program
    .command('bridges')
    .alias('protocols')
    .alias('skills')
    .description('List all supported cross-chain bridge protocols and installed skills')
    .action(async () => {
      const engine = new OmnibridgeEngine();
      await engine.init();
      const bridges = engine.registry.getAllBridgeSkills();

      const table = new Table({
        head: [
          chalk.bold.cyan('Protocol ID'),
          chalk.bold.cyan('Display Name'),
          chalk.bold.cyan('Version'),
          chalk.bold.cyan('Supported Chains'),
          chalk.bold.cyan('Supported Assets'),
          chalk.bold.cyan('Capabilities'),
        ],
      });

      for (const b of bridges) {
        table.push([
          chalk.bold.green(b.name),
          b.displayName,
          chalk.dim(b.version),
          b.supportedChains.join(', '),
          b.supportedTokens.map(t => t.symbol).join(', '),
          chalk.dim(b.capabilities.slice(0, 3).join(', ') + (b.capabilities.length > 3 ? '...' : '')),
        ]);
      }

      console.log(chalk.bold('\n🛠️  SUPPORTED BRIDGE PROTOCOLS & INSTALLED SKILLS:'));
      console.log(table.toString());
      console.log(chalk.dim(`Total Protocols: ${bridges.length}\n`));
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
