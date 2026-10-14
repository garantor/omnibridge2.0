---
name: circle-cctp
type: bridge
version: 1.0.0
displayName: "Circle CCTP"
supportedChains:
  - polygon
  - base
  - arbitrum
supportedTokens:
  - symbol: USDC
    decimals: 6
    addresses:
      polygon: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359"
      base: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
      arbitrum: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831"
capabilities:
  - native-burn-and-mint
  - zero-slippage
contracts:
  polygon:
    domainId: 7
    tokenMessenger: "0x9daF83bd2e96B2c0DC037411C292F9E8287F4A42"
  base:
    domainId: 6
    tokenMessenger: "0x1682Eb632590Ea82110Ea6362ac329610221992e"
  arbitrum:
    domainId: 3
    tokenMessenger: "0x19330d10D9Cc8751215333190ac47137aC10F9d8"
---

# Circle Cross-Chain Transfer Protocol (CCTP) Skill

## Bridge Mechanics
Circle CCTP burns native USDC on the source chain and issues a cryptographically signed attestation via the Circle Iris attestation API, allowing 1:1 zero-slippage mint on the target chain.

## Execution Pattern
1. `erc20.approve(tokenMessenger, amount)`
2. `tokenMessenger.depositForBurn(amount, destinationDomain, bytes32Recipient, burnToken)`
3. Retrieve Circle attestation for `messageHash`.
4. `messageTransmitter.receiveMessage(message, attestation)` on destination.
