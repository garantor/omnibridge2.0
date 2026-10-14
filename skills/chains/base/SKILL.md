---
name: base
type: chain
vmType: evm
displayName: "Base (Coinbase L2)"
chainId: 8453
nativeToken:
  symbol: ETH
  name: "Ethereum"
  decimals: 18
rpcEnvVar: "BASE_RPC_URL"
defaultRpc: "https://mainnet.base.org"
blockExplorer: "https://basescan.org"
supportedTokens:
  - symbol: USDC
    name: "USD Coin (Native)"
    address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
    decimals: 6
  - symbol: WETH
    name: "Wrapped Ether"
    address: "0x4200000000000000000000000000000000000006"
    decimals: 18
---

# Base Chain Skill

## Network Rules & Execution Guidelines
- Optimistic rollup on Ethereum (OP Stack).
- Native CCTP domain ID: 6.
- Gas paid in native ETH. Fast sub-second block times.
