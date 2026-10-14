---
name: xrpl
type: chain
vmType: xrpl
displayName: "XRP Ledger"
chainId: 0
nativeToken:
  symbol: XRP
  name: "XRP"
  decimals: 6
rpcEnvVar: "XRPL_WEBSOCKET_URL"
defaultRpc: "wss://s1.ripple.com"
blockExplorer: "https://xrpscan.com"
supportedTokens:
  - symbol: XRP
    name: "XRP (Native)"
    address: "native"
    decimals: 6
---

# XRP Ledger Chain Skill

## Network Rules & Invariants
- Non-EVM consensus ledger.
- Base addresses start with 'r' (Base58Check).
- Destination Tag (32-bit unsigned int) is REQUIRED for exchange wallets.
- Amounts in drops (1 XRP = 1,000,000 drops).
- Uses `xrpl` library (`Client`, `Wallet`).
