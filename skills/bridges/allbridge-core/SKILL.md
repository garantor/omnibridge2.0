---
name: allbridge-core
type: bridge
version: 2.0.0
displayName: "Allbridge Core"
supportedChains:
  - polygon
  - base
  - arbitrum
  - stellar
supportedTokens:
  - symbol: USDC
    decimals: 6
capabilities:
  - cross-vm-liquidity-pools
  - evm-to-stellar
contracts:
  polygon:
    bridgeRouter: "0xba285A8F52601EabCc769706EBbDe64174F7138D"
    pool: "0x82ec252479427eF29A46522E9B23E2A0Dbe6d0e8"
  stellar:
    recipientType: "strkey-ed25519"
---

# Allbridge Core Skill

## Bridge Mechanics
Allbridge Core connects EVM networks to Non-EVM networks like Stellar (Horizon/Soroban) using cross-chain liquidity pools and messaging validators.

## Execution Pattern (Polygon to Stellar USDC)
1. Approve `bridgeRouter` on Polygon for USDC `amount`.
2. Encode Stellar public key (StrKey `G...`) as 32-byte recipient payload.
3. Call `send(token, amount, recipient, destinationChainId, nonce, messenger)`.
4. Allbridge validators verify lock on Polygon and release USDC directly to target Stellar wallet via public Horizon payment.
