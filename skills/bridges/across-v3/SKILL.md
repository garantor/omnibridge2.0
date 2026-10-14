---
name: across-v3
type: bridge
version: 3.0.0
displayName: "Across Protocol v3"
supportedChains:
  - polygon
  - base
  - arbitrum
supportedTokens:
  - symbol: USDC
    decimals: 6
  - symbol: WETH
    decimals: 18
  - symbol: ETH
    decimals: 18
capabilities:
  - intent-fast-fill
  - sub-minute-settlement
contracts:
  polygon:
    spokePool: "0x9295ee1d8C5b022Be115A2AD3c30C72E34e7F096"
  base:
    spokePool: "0x09aea4b2242abC8bb4BB78D537A67a245A7bEC64"
  arbitrum:
    spokePool: "0xe35e9842fceaCA96570B734083f4a58e8F7C5f2A"
---

# Across Protocol v3 Skill

## Bridge Mechanics
Across uses an intent-driven model with decentralized relayer network. Relayers fill orders on the destination chain immediately (usually 1-3 seconds), taking repayment from Across SpokePools verified by UMA optimistic oracle.

## Execution Pattern
1. Fetch quote from Across API `https://app.across.to/api/suggested-fees`.
2. Approve `spokePool` for `amount`.
3. Call `spokePool.depositV3(depositor, recipient, inputToken, outputToken, inputAmount, outputAmount, destinationChainId, exclusiveRelayer, quoteTimestamp, fillDeadline, exclusivityDeadline, message)`.
