---
name: polygon
type: chain
vmType: evm
displayName: "Polygon PoS"
chainId: 137
nativeToken:
  symbol: POL
  name: "Polygon Ecosystem Token"
  decimals: 18
rpcEnvVar: "POLYGON_RPC_URL"
defaultRpc: "https://polygon-rpc.com"
blockExplorer: "https://polygonscan.com"
supportedTokens:
  - symbol: USDC
    name: "USD Coin (Native)"
    address: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359"
    decimals: 6
  - symbol: USDT
    name: "Tether USD"
    address: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F"
    decimals: 6
  - symbol: WETH
    name: "Wrapped Ether"
    address: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619"
    decimals: 18
---

# Polygon PoS Chain Skill

## Network Rules & Execution Guidelines
- Standard EVM account-based model.
- Always validate checksum address using EIP-55.
- Gas token is native POL (18 decimals).
- Use Viem `createPublicClient` and `createWalletClient` with chain `polygon`.
