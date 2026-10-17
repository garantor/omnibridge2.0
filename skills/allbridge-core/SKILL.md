---
# ==============================================================================
# ALLBRIDGE CORE PROTOCOL SKILL
# Type: bridge | Model: heterogeneous-cross-vm (EVM <-> Non-EVM)
# ==============================================================================

name: allbridge-core
displayName: "Allbridge Core (Cross-VM)"
type: bridge
version: 2.4.0

supportedChains:
  - polygon
  - base
  - arbitrum
  - stellar
  - solana

supportedTokens:
  - USDC
  - USDT

capabilities:
  - cross-vm-settlement
  - non-evm-trustline-check
  - liquidity-pool-swap
  - gas-topup

# Chain Identifiers and Bridge Router Contracts
chains:
  polygon:
    chainId: 137
    routerContract: "0xba452A62c45873FE81c164A4A61c8aC55A9B4842"
    chainPrecision: 6
  base:
    chainId: 8453
    routerContract: "0xC527017B49B2e25287515F15c0eC99eb664F94cE"
    chainPrecision: 6
  stellar:
    network: "public"
    horizonUrl: "https://horizon.stellar.org"
    assetIssuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"
    destinationPrecision: 7

requirements:
  nodePackages:
    - viem
    - "@stellar/stellar-sdk"
  environmentVariables:
    - PRIVATE_KEY
---

# Allbridge Core Procedural Instructions (EVM ➔ Stellar Cross-VM)

## 1. Protocol Architecture & Non-EVM Trustlines
Allbridge Core bridges native and stable assets across EVM and Non-EVM chains (like Stellar and Solana) through localized liquidity pools and decentralized relayers.

> **CRITICAL STELLAR INVARIANT:**  
> On Stellar, an account **cannot receive USDC** unless it has established a Trustline with the official USDC issuer (`GA5ZSEJY...`). If an account has no trustline, any bridge attempt will fail.

---

## 2. Dynamic Execution Flow

### Step 1: Pre-Flight Verification on Stellar Horizon
```typescript
import * as StellarSdk from '@stellar/stellar-sdk';

const server = new StellarSdk.Horizon.Server('https://horizon.stellar.org');
const recipientStellarAddress = plan.intent.targetAddress;

// 1. Verify destination account exists and has USDC trustline
try {
  const account = await server.loadAccount(recipientStellarAddress);
  const usdcLine = account.balances.find((b: any) => 
    b.asset_code === 'USDC' && 
    b.asset_issuer === 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN'
  );

  if (!usdcLine) {
    throw new Error(`Recipient Stellar account (${recipientStellarAddress}) does not have an established USDC trustline.`);
  }
} catch (err: any) {
  if (err.response?.status === 404) {
    throw new Error(`Recipient Stellar account does not exist on Stellar mainnet. Fund account with XLM first.`);
  }
  throw err;
}
```

### Step 2: Approve Source Pool Router on EVM Chain
```typescript
// Grant Allbridge Pool Router allowance to spend source token
const allowance = await publicClient.readContract({
  address: sourceTokenAddress,
  abi: erc20Abi,
  functionName: 'allowance',
  args: [signerAddress, routerAddress],
});

if (allowance < amountUnits) {
  const appTx = await walletClient.writeContract({
    address: sourceTokenAddress,
    abi: erc20Abi,
    functionName: 'approve',
    args: [routerAddress, amountUnits],
  });
  await publicClient.waitForTransactionReceipt({ hash: appTx });
}
```

### Step 3: Dispatch sendPayload() on EVM Source Chain
```typescript
// Convert Stellar StrKey G... into bytes32 recipient format
const stellarRecipientBytes32 = pad(toHex(recipientStellarAddress), { size: 32 });

const bridgeTx = await walletClient.writeContract({
  address: routerAddress,
  abi: [
    {
      name: 'sendPayload',
      type: 'function',
      inputs: [
        { name: 'amount', type: 'uint256' },
        { name: 'recipient', type: 'bytes32' },
        { name: 'destinationChainId', type: 'uint8' },
        { name: 'sourceToken', type: 'address' }
      ]
    }
  ],
  functionName: 'sendPayload',
  args: [amountUnits, stellarRecipientBytes32, 5 /* Stellar */, sourceTokenAddress],
});
await publicClient.waitForTransactionReceipt({ hash: bridgeTx });
```

### Step 4: Monitor Horizon Stream for Incoming Payment
```typescript
console.log(`[SETTLEMENT] Monitoring Stellar Horizon stream for recipient ${recipientStellarAddress}...`);
```
