---
# ==============================================================================
# CANONICAL CHAIN DEFINITION SPECIFICATION
# Use this template when adding support for a new blockchain network.
# Drop it into ./skills/chains/<chain_name>/SKILL.md
# ==============================================================================

name: optimism                      # Chain identifier (kebab-case)
type: chain                         # Skill type: 'chain'
vmType: evm                         # Virtual Machine type: 'evm' | 'stellar' | 'xrpl'
displayName: "Optimism Mainnet"     # UI & CLI display name
chainId: 10                         # Network Chain ID (EVM numeric ID, or 0 for non-EVM)

# Native Gas Currency
nativeToken:
  symbol: ETH
  name: "Ethereum"
  decimals: 18

# Network RPC & Explorer
rpcEnvVar: "OPTIMISM_RPC_URL"       # .env variable checked for private RPC
defaultRpc: "https://mainnet.optimism.io"
blockExplorer: "https://optimistic.etherscan.io"

# Supported Tokens on this Chain
supportedTokens:
  - symbol: USDC
    name: "USD Coin"
    address: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85"
    decimals: 6
  - symbol: OP
    name: "Optimism"
    address: "0x4200000000000000000000000000000000000042"
    decimals: 18
---

# Optimism Chain Skill Guidelines

## Network Invariants
- Standard EVM account model.
- EIP-1559 gas calculation.
- Fast 2-second block production.
