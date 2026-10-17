---
name: lifi
displayName: "LI.FI Bridge & DEX Aggregator"
type: bridge
version: 4.0.0

# Supported Networks (Resolved automatically from Tier 1 Chain Registry)
supportedChains:
  - ethereum
  - arbitrum
  - optimism
  - base
  - polygon

# Supported Assets (Resolved automatically from Tier 2 Token Registry)
supportedTokens:
  - USDC

capabilities:
  - bridge-aggregation
  - dex-aggregation
  - smart-order-routing
  - intent-solver-fills
  - multi-step-fallback
  - gas-abstraction
  - guaranteed-min-output

api:
  baseUrl: "https://li.quest/v1"
  quoteEndpoint: "/quote"
  statusEndpoint: "/status"
  chainsEndpoint: "/chains"
  tokensEndpoint: "/tokens"
  toolsEndpoint: "/tools"
  connectionsEndpoint: "/connections"

requirements:
  nodePackages:
    - viem
  environmentVariables:
    - LIFI_API_KEY
    - ETHEREUM_RPC_URL
    - ARBITRUM_RPC_URL
    - OPTIMISM_RPC_URL
    - BASE_RPC_URL
    - POLYGON_RPC_URL
---

# LI.FI Protocol Skill (Bridge & DEX Aggregation)

## 1. Protocol Architecture & Mechanics
LI.FI is the multi-chain routing and execution layer that aggregates bridges (Across, Stargate v2, Celer, Hop, Symbiosis, etc.), DEX aggregators (1inch, 0x, Paraswap, Odos), and intent solvers across 58+ ecosystems into a single API and smart contract entry point.

### Core Smart Contract Architecture:
- **LI.FI Diamond Contract (EIP-2535):** Modular on-chain diamond proxy routing funds to specialized facet contracts per bridge/DEX.
- **Atomic Same-Chain Swaps:** Same-chain operations revert atomically if slippage or price impact exceeds constraints.
- **Cross-Chain Bridge Routing:** The user submits a single pre-formed transaction (`transactionRequest`). If a destination swap reverts due to market volatility, the user is safely refunded in the bridged asset on the destination chain (`DONE + REFUNDED` or `DONE + PARTIAL`).
- **Minimal Agent Surface:** AI agents interact through the high-performance REST API (`https://li.quest/v1`) without needing local heavy SDK instances.

---

## 2. API Endpoints Reference

- **Base URL:** `https://li.quest/v1`
- **Rate Limits:** 200 requests / 2 hours without API key; 200 requests / minute with `X-LiFi-Api-Key` or `Authorization: Bearer <key>`.
- **Get Quote (`GET /quote`):** Primary endpoint generating the complete unsigned transaction payload (`transactionRequest`).
- **Check Status (`GET /status`):** Tracks cross-chain settlement until destination fulfillment.
- **Discover Tokens (`GET /tokens`):** Live map of supported tokens per chain ID (treat as ground truth).
- **Discover Chains (`GET /chains`):** Live network list with numerical chain IDs.

---

## 3. Step-by-Step Viem Execution Sequence

When generating JIT TypeScript execution scripts for LI.FI, follow this 4-step sequence:

### Step 1: Query `/v1/quote` for Pre-Built Transaction
```typescript
import { parseUnits, createWalletClient, createPublicClient, http } from 'viem';

const originChainId = 8453;       // Base
const destinationChainId = 42161; // Arbitrum
const fromTokenAddress = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"; // Base USDC
const toTokenAddress = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";   // Arbitrum USDC
const fromAmountUnits = parseUnits("100", 6).toString(); // 100 USDC in atomic units

const quoteUrl = new URL('https://li.quest/v1/quote');
quoteUrl.searchParams.set('fromChain', originChainId.toString());
quoteUrl.searchParams.set('toChain', destinationChainId.toString());
quoteUrl.searchParams.set('fromToken', fromTokenAddress);
quoteUrl.searchParams.set('toToken', toTokenAddress);
quoteUrl.searchParams.set('fromAmount', fromAmountUnits);
quoteUrl.searchParams.set('fromAddress', senderAddress);
quoteUrl.searchParams.set('slippage', '0.005'); // 0.5% max slippage

const quoteRes = await fetch(quoteUrl.toString(), {
  headers: process.env.LIFI_API_KEY ? { 'x-lifi-api-key': process.env.LIFI_API_KEY } : {}
});

if (!quoteRes.ok) {
  const errBody = await quoteRes.json();
  throw new Error(`LI.FI Quote API Error [${quoteRes.status}]: ${errBody.message || JSON.stringify(errBody)}`);
}

const quote = await quoteRes.json();
const txRequest = quote.transactionRequest;

if (!txRequest || !txRequest.to || !txRequest.data) {
  throw new Error('LI.FI Quote did not return a valid executable transactionRequest.');
}
```

### Step 2: Approve ERC-20 Allowance (If Required)
If the quote specifies an `approvalAddress`, check current allowance and submit an approval transaction:
```typescript
const approvalSpender = quote.estimate?.approvalAddress;

if (approvalSpender && fromTokenAddress !== '0x0000000000000000000000000000000000000000') {
  const erc20Abi = [
    {
      name: 'allowance',
      type: 'function',
      stateMutability: 'view',
      inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }],
      outputs: [{ type: 'uint256' }],
    },
    {
      name: 'approve',
      type: 'function',
      stateMutability: 'nonpayable',
      inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }],
      outputs: [{ type: 'bool' }],
    },
  ] as const;

  const currentAllowance = await publicClient.readContract({
    address: fromTokenAddress as `0x${string}`,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [senderAddress as `0x${string}`, approvalSpender as `0x${string}`],
  });

  if (currentAllowance < BigInt(fromAmountUnits)) {
    const approveTx = await walletClient.writeContract({
      address: fromTokenAddress as `0x${string}`,
      abi: erc20Abi,
      functionName: 'approve',
      args: [approvalSpender as `0x${string}`, BigInt(fromAmountUnits)],
    });
    await publicClient.waitForTransactionReceipt({ hash: approveTx });
  }
}
```

### Step 3: Broadcast the Bridge Transaction
Execute the pre-built `transactionRequest` generated by LI.FI:
```typescript
const bridgeTxHash = await walletClient.sendTransaction({
  to: txRequest.to as `0x${string}`,
  data: txRequest.data as `0x${string}`,
  value: BigInt(txRequest.value || '0'),
  gas: txRequest.gasLimit ? BigInt(txRequest.gasLimit) : undefined,
});

const receipt = await publicClient.waitForTransactionReceipt({ hash: bridgeTxHash });
```

### Step 4: Track Cross-Chain Fulfillment
Poll `/v1/status` until the transaction transitions to `DONE` or `FAILED`:
```typescript
const statusUrl = new URL('https://li.quest/v1/status');
statusUrl.searchParams.set('txHash', bridgeTxHash);
statusUrl.searchParams.set('fromChain', originChainId.toString());
statusUrl.searchParams.set('toChain', destinationChainId.toString());
if (quote.tool) {
  statusUrl.searchParams.set('bridge', quote.tool);
}

// Poll every 10 seconds (up to 30 attempts)
for (let i = 0; i < 30; i++) {
  await new Promise(r => setTimeout(r, 10000));
  const res = await fetch(statusUrl.toString());
  const statusData = await res.json();

  if (statusData.status === 'DONE') {
    if (statusData.substatus === 'COMPLETED') {
      console.log('✔ Cross-chain transfer fully completed!');
    } else if (statusData.substatus === 'PARTIAL' || statusData.substatus === 'REFUNDED') {
      console.log(`ℹ Transfer ended with substatus: ${statusData.substatus}`);
    }
    break;
  } else if (statusData.status === 'FAILED') {
    throw new Error(`LI.FI Bridge execution failed: ${statusData.message || 'Unknown failure'}`);
  }
}
```

---

## 4. Status Life Cycle & Decision Table

| Status | Substatus | Meaning & Recommended Action |
| :--- | :--- | :--- |
| `NOT_FOUND` | - | Transaction not yet indexed by relayer. Continue polling. |
| `PENDING` | - | In flight on source chain or bridge network. Continue polling every 10–15s. |
| `DONE` | `COMPLETED` | **Success:** Target token received by user on destination chain. |
| `DONE` | `PARTIAL` | **Success:** Bridge succeeded, but destination swap fell back to intermediate token. Full value preserved. |
| `DONE` | `REFUNDED` | Bridge failed or reverted; user received refunded assets back on destination/source. |
| `FAILED` | - | Terminal failure. Check `error` details and inspect on-chain receipt. |

---

## 5. Security Guardrails & Invariants

- **Token Address Verification:** NEVER hardcode arbitrary or unofficial token addresses. Look up verified addresses through Tier 2 or live `/v1/tokens`.
- **Zero Key Exposure:** Never log or include private keys in any API requests or LLM outputs.
- **Slippage Bounds:** Default to 0.5% (`slippage: 0.005`). Do not exceed 2% without explicit human approval.
- **Approval Scope:** Only approve the exact `quote.estimate.approvalAddress` returned by the API.
- **Simulation Verification:** Ensure `quote.transactionRequest` exists and is non-empty before initiating approvals.

---

## 6. Common Agent Tasks

- **"Bridge tokens with LI.FI"**: Query `/v1/quote`, verify approval, execute `transactionRequest`, poll `/v1/status`.
- **"Get cross-chain quote"**: Query `/v1/quote` with `fromChain`, `toChain`, `fromToken`, `toToken`, and `fromAmount`.
- **"Track transfer"**: Call `/v1/status` with origin transaction hash and chain IDs.
