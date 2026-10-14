---
name: stellar
type: chain
vmType: stellar
displayName: "Stellar Network"
chainId: 0
nativeToken:
  symbol: XLM
  name: "Lumen"
  decimals: 7
rpcEnvVar: "STELLAR_HORIZON_URL"
defaultRpc: "https://horizon.stellar.org"
sorobanRpc: "https://soroban-rpc.mainnet.stellar.org"
blockExplorer: "https://stellar.expert/explorer/public"
supportedTokens:
  - symbol: USDC
    name: "USD Coin (Centre Circle)"
    address: "USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"
    issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"
    decimals: 7
---

# Stellar Network Chain Skill

## Network Rules & Invariants
- Non-EVM ledger architecture.
- Destination addresses MUST be valid public StrKey starting with 'G' (56 chars).
- Destination account MUST have an active trustline for non-native assets (e.g. USDC:GA5ZSEJYB...).
- Exchange deposits (e.g., Binance, Coinbase) often REQUIRE a Memo ID (text or 64-bit int).
- Operations use `@stellar/stellar-sdk`.
