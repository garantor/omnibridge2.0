---
name: arbitrum
type: chain
vmType: evm
displayName: "Arbitrum One"
chainId: 42161
nativeToken:
  symbol: ETH
  name: "Ethereum"
  decimals: 18
rpcEnvVar: "ARBITRUM_RPC_URL"
defaultRpc: "https://arb1.arbitrum.io/rpc"
blockExplorer: "https://arbiscan.io"
supportedTokens:
  - symbol: USDC
    name: "USD Coin (Native)"
    address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831"
    decimals: 6
  - symbol: ARB
    name: "Arbitrum Governance Token"
    address: "0x912CE59144191C1204E64559FE8253a0e49E6548"
    decimals: 18
  - symbol: WETH
    name: "Wrapped Ether"
    address: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1"
    decimals: 18
---

# Arbitrum One Chain Skill

## Network Rules & Execution Guidelines
- Arbitrum Nitro rollup.
- Native CCTP domain ID: 3.
- Deep liquidity hub for Across Protocol v3 and Uniswap v3.
