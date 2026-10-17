---
# ==============================================================================
# JUPITER DEX AGGREGATOR SKILL (SOLANA)
# Type: swap | Scope: same-chain asset conversion (Non-EVM REST API)
# ==============================================================================

name: jupiter
displayName: "Jupiter DEX Aggregator (Solana)"
type: swap
version: 6.0.0

supportedChains:
  - solana

supportedTokens:
  - SOL
  - USDC
  - USDT
  - JUP
  - BONK

capabilities:
  - dex-aggregation
  - smart-routing
  - rest-api-quote
  - versioned-transactions

# Jupiter v6 REST API
api:
  baseUrl: "https://quote-api.jup.ag/v6"
  quoteEndpoint: "/quote"
  swapEndpoint: "/swap"

requirements:
  nodePackages:
    - "@solana/web3.js"
---

# Jupiter DEX Procedural Instructions (Solana Swap Primitive)

## 1. Skill Purpose in Multi-Hop Routing
This skill is a **non-EVM swap primitive** (`type: swap`) operating on Solana. In a multi-hop transfer such as `Polygon (MATIC) ➔ Solana (SOL)`:
1. `uniswap-v3` swaps `MATIC ➔ USDC` on Polygon.
2. `allbridge-core` bridges `USDC (Polygon) ➔ USDC (Solana)`.
3. **`jupiter`** completes the final hop by swapping incoming `USDC ➔ SOL` directly on Solana.

---

## 2. Dynamic Execution Flow (REST API Driven)

### Step 1: Query Jupiter Quote API
```typescript
const quoteUrl = new URL('https://quote-api.jup.ag/v6/quote');
quoteUrl.searchParams.set('inputMint', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'); // USDC Mint
quoteUrl.searchParams.set('outputMint', 'So11111111111111111111111111111111111111112'); // Native SOL Mint
quoteUrl.searchParams.set('amount', amountUnits.toString());
quoteUrl.searchParams.set('slippageBps', '50'); // 0.5% max slippage

const quoteResponse = await fetch(quoteUrl.toString()).then(r => r.json());
```

### Step 2: Request Serialized Swap Transaction
```typescript
const swapResponse = await fetch('https://quote-api.jup.ag/v6/swap', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    quoteResponse,
    userPublicKey: solanaKeypair.publicKey.toString(),
    wrapAndUnwrapSol: true,
  }),
}).then(r => r.json());

const { swapTransaction } = swapResponse;
```

### Step 3: Deserialize, Sign & Broadcast on Solana
```typescript
import { Connection, VersionedTransaction } from '@solana/web3.js';

const connection = new Connection(process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com');
const swapTransactionBuf = Buffer.from(swapTransaction, 'base64');
const transaction = VersionedTransaction.deserialize(swapTransactionBuf);

transaction.sign([solanaKeypair]);
const txid = await connection.sendRawTransaction(transaction.serialize(), {
  skipPreflight: true,
  maxRetries: 2,
});

await connection.confirmTransaction(txid, 'confirmed');
console.log(`[SWAP COMPLETE] Jupiter swap confirmed: https://solscan.io/tx/${txid}`);
```
