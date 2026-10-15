import { createPublicClient, createWalletClient, http, parseUnits, erc20Abi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import chalk from 'chalk';
import { ExecutionPlan } from '../agent/route-planner.js';
import { ChainMetadata } from '../skills/skill.types.js';

export interface LiveExecutionResult {
  isLive: boolean;
  success: boolean;
  txHash?: string;
  explorerUrl?: string;
  error?: string;
  logs: string[];
}

export class LiveExecutor {
  public static getSignerAccount(): { address: `0x${string}`; privateKey: `0x${string}` } | null {
    const rawKey = process.env.PRIVATE_KEY;
    if (!rawKey) return null;
    try {
      const trimmed = rawKey.trim();
      const formattedKey = (trimmed.startsWith('0x') ? trimmed : `0x${trimmed}`) as `0x${string}`;
      const account = privateKeyToAccount(formattedKey);
      return { address: account.address, privateKey: formattedKey };
    } catch {
      return null;
    }
  }

  public static async getRealBalance(
    chain: ChainMetadata,
    tokenAddress: string,
    tokenDecimals: number,
    walletAddress: `0x${string}`
  ): Promise<string> {
    const rpcUrl = process.env[`${chain.name.toUpperCase()}_RPC_URL`] || chain.defaultRpc;
    if (!rpcUrl) return 'Unknown';

    try {
      const client = createPublicClient({ transport: http(rpcUrl) });
      if (tokenAddress === 'native' || tokenAddress === '0x0000000000000000000000000000000000000000') {
        const bal = await client.getBalance({ address: walletAddress });
        return (Number(bal) / 1e18).toFixed(4);
      } else {
        const bal = await client.readContract({
          address: tokenAddress as `0x${string}`,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [walletAddress],
        });
        return (Number(bal) / Math.pow(10, tokenDecimals)).toFixed(4);
      }
    } catch {
      return 'Unavailable';
    }
  }

  public static async execute(
    plan: ExecutionPlan,
    srcChain: ChainMetadata,
    dstChain: ChainMetadata
  ): Promise<LiveExecutionResult> {
    const logs: string[] = [];
    const signer = this.getSignerAccount();

    if (!signer) {
      return {
        isLive: false,
        success: false,
        error: 'NO_SIGNER_KEY: No valid PRIVATE_KEY detected in environment or .env file. Real mainnet execution requires a private key.',
        logs,
      };
    }

    if (plan.bridgeProtocol === 'across-v3') {
      return this.executeAcrossV3(plan, srcChain, dstChain, signer, logs);
    }

    return {
      isLive: false,
      success: false,
      error: `Unsupported live protocol: ${plan.bridgeProtocol}`,
      logs,
    };
  }

  private static async executeAcrossV3(
    plan: ExecutionPlan,
    srcChain: ChainMetadata,
    dstChain: ChainMetadata,
    signer: { address: `0x${string}`; privateKey: `0x${string}` },
    logs: string[]
  ): Promise<LiveExecutionResult> {
    const rpcUrl = process.env[`${srcChain.name.toUpperCase()}_RPC_URL`] || srcChain.defaultRpc;
    if (!rpcUrl) {
      throw new Error(`RPC URL missing for ${srcChain.displayName}. Set ${srcChain.name.toUpperCase()}_RPC_URL in .env`);
    }

    const account = privateKeyToAccount(signer.privateKey);
    const chainDef = {
      id: srcChain.chainId,
      name: srcChain.displayName,
      nativeCurrency: srcChain.nativeToken,
      rpcUrls: { default: { http: [rpcUrl] } },
    } as any;
    const client = createPublicClient({ chain: chainDef, transport: http(rpcUrl) });
    const walletClient = createWalletClient({
      account,
      chain: chainDef,
      transport: http(rpcUrl),
    });

    logs.push(`[LIVE] Signer address: ${account.address} on ${srcChain.displayName}`);

    // Step 1: Format amount
    const decimals = plan.sourceToken.decimals || 6;
    const amountInUnits = parseUnits(plan.amounts.inputAmount, decimals).toString();

    // Step 2: Request swap approval & calldata from Across Swap API
    const quoteUrl = new URL('https://app.across.to/api/swap/approval');
    quoteUrl.searchParams.set('originChainId', srcChain.chainId.toString());
    quoteUrl.searchParams.set('destinationChainId', dstChain.chainId.toString());
    quoteUrl.searchParams.set('inputToken', plan.sourceToken.address);
    quoteUrl.searchParams.set('outputToken', plan.targetToken.address);
    quoteUrl.searchParams.set('amount', amountInUnits);
    quoteUrl.searchParams.set('depositor', account.address);
    quoteUrl.searchParams.set('recipient', plan.intent.targetAddress);
    quoteUrl.searchParams.set('tradeType', 'minOutput');

    logs.push(`[LIVE] Querying Across Swap API for quotes and transaction calldata...`);
    const res = await fetch(quoteUrl.toString());
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Across Swap API error (${res.status}): ${errText}`);
    }

    const quote = (await res.json()) as any;

    // Check if API returned simulation errors or balance checks failed
    if (quote.checks && quote.checks.balance === false) {
      throw new Error(`Insufficient ${plan.sourceToken.symbol} balance on ${srcChain.displayName} for account ${account.address}`);
    }

    if (!quote.swapTx) {
      throw new Error(`Across Swap API did not return executable swapTx. Response: ${JSON.stringify(quote)}`);
    }

    let activeQuote = quote;

    // Step 3: Execute approval transactions if required
    if (Array.isArray(activeQuote.approvalTxns) && activeQuote.approvalTxns.length > 0) {
      for (let i = 0; i < activeQuote.approvalTxns.length; i++) {
        const appTx = activeQuote.approvalTxns[i];
        const logMsg = `[LIVE] Broadcasting approval tx [${i + 1}/${activeQuote.approvalTxns.length}] to ${appTx.to}...`;
        logs.push(logMsg);
        console.log(chalk.cyan(`\n⚡ Step 1: Broadcasting ERC-20 approval transaction...`));
        const approveHash = await walletClient.sendTransaction({
          chain: null,
          to: appTx.to,
          data: appTx.data,
          value: BigInt(appTx.value || 0),
        });
        logs.push(`[LIVE] Approval broadcasted: ${approveHash}. Waiting for confirmation...`);
        console.log(chalk.dim(`  Tx: ${approveHash}`));
        console.log(chalk.yellow(`  Waiting for block inclusion...`));
        await client.waitForTransactionReceipt({ hash: approveHash });
        logs.push(`[LIVE] Approval confirmed on-chain.`);
        console.log(chalk.green(`✔ ERC-20 approval confirmed on-chain!`));
      }

      // Allow 3 seconds for load-balanced RPC nodes to sync state across the cluster
      console.log(chalk.dim(`⏳ Propagating approval state across RPC nodes...`));
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Refresh quote from Across Swap API with now-active allowance
      const refreshRes = await fetch(quoteUrl.toString());
      if (refreshRes.ok) {
        activeQuote = (await refreshRes.json()) as any;
      }
    }

    // Step 4: Broadcast main swap transaction
    logs.push(`[LIVE] Broadcasting swapTx to Across SpokePool ${activeQuote.swapTx.to}...`);
    console.log(chalk.cyan(`\n⚡ Step 2: Broadcasting bridge deposit to Across SpokePool (${activeQuote.swapTx.to})...`));
    const depositTxHash = await walletClient.sendTransaction({
      chain: null,
      to: activeQuote.swapTx.to,
      data: activeQuote.swapTx.data,
      value: BigInt(activeQuote.swapTx.value || 0),
      gas: activeQuote.swapTx.gas && activeQuote.swapTx.gas !== '0' ? BigInt(activeQuote.swapTx.gas) : undefined,
    });

    logs.push(`[LIVE] Swap transaction broadcasted: ${depositTxHash}`);
    console.log(chalk.dim(`  Tx: ${depositTxHash}`));
    console.log(chalk.yellow(`  Waiting for on-chain confirmation...`));
    await client.waitForTransactionReceipt({ hash: depositTxHash });
    logs.push(`[LIVE] Transaction confirmed on-chain!`);
    console.log(chalk.green(`✔ Mainnet bridge deposit confirmed on-chain!`));

    const explorerUrl = srcChain.blockExplorer ? `${srcChain.blockExplorer}/tx/${depositTxHash}` : undefined;

    return {
      isLive: true,
      success: true,
      txHash: depositTxHash,
      explorerUrl,
      logs,
    };
  }
}
