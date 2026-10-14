---
# ==============================================================================
# CANONICAL SKILL DEFINITION SPECIFICATION (v1.0)
# This file serves as the official template and guide for authoring protocol skills
# in Omnibridge. Drop any valid SKILL.md into ./skills/<protocol-name>/ to
# automatically enable it in the engine. Networks, tokens, and routes are
# dynamically loaded directly from the installed skills library.
# ==============================================================================

# 1. Core Identity & Metadata
name: sample-protocol-v1            # Unique kebab-case identifier
displayName: "Sample Protocol v1"   # Human-readable label displayed in CLI & UI
type: bridge                        # Protocol skill type
version: 1.0.0                      # Semver protocol specification version

# 2. Network Topology & Supported Chains
# Define network metadata directly within the skill (Zero hardcoded defaults in code)
supportedChains:
  - name: polygon
    displayName: "Polygon PoS"
    chainId: 137
    vmType: evm
    nativeToken:
      symbol: POL
      decimals: 18
    rpcUrl: "https://polygon-rpc.com"
  - name: base
    displayName: "Base"
    chainId: 8453
    vmType: evm
    nativeToken:
      symbol: ETH
      decimals: 18
    rpcUrl: "https://mainnet.base.org"
  - name: arbitrum
    displayName: "Arbitrum One"
    chainId: 42161
    vmType: evm
    nativeToken:
      symbol: ETH
      decimals: 18
    rpcUrl: "https://arb1.arbitrum.io/rpc"

# 3. Asset & Token Coverage
supportedTokens:
  - symbol: USDC
    decimals: 6
    addresses:
      polygon: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359"
      base: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
      arbitrum: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831"
  - symbol: ETH
    decimals: 18

# 4. Protocol Capabilities & Execution Traits
capabilities:
  - intent-fast-fill                # e.g. intent-fast-fill, native-burn-mint, pool-swap
  - sub-minute-settlement           # Expected user settlement speed
  - guaranteed-quote                # Fixed quote vs dynamic slippage

# 5. Smart Contract Addresses & Domain IDs per Chain
contracts:
  polygon:
    router: "0x0000000000000000000000000000000000000001"
    pool: "0x0000000000000000000000000000000000000002"
    domainId: 7
  base:
    router: "0x0000000000000000000000000000000000000003"
    domainId: 6
  arbitrum:
    router: "0x0000000000000000000000000000000000000004"
    domainId: 3

# 6. Environment & SDK Requirements
requirements:
  nodePackages:
    - viem
  environmentVariables:
    - POLYGON_RPC_URL
    - BASE_RPC_URL
    - ARBITRUM_RPC_URL
---

# Sample Protocol Specification & Execution Guidelines

## 1. Protocol Architecture & Mechanics
Explain the high-level mechanism used by this protocol to bridge assets:
- **Model:** (e.g., Lock & Mint, Burn & Mint, Liquidity Pool, Intent-based Relayer Network)
- **Settlement Time:** Expected turnaround for user funds (e.g., 2-5 seconds for Across, ~1 min for CCTP).
- **Fee Dynamics:** Base gas cost + protocol fee percentage (e.g., 0.1% LP fee).

---

## 2. API & Quote Endpoints
List any external REST or RPC endpoints used to fetch quotes or attestation signatures:
- **Quote API:** `https://api.sample-protocol.com/v1/quote`
- **Attestation Service:** `https://api.sample-protocol.com/v1/attestations/{txHash}`
- **Relayer Status:** `https://api.sample-protocol.com/v1/status/{depositId}`

---

## 3. Step-by-Step Execution Sequence

The JIT Code Synthesizer follows this precise sequence when generating transient TypeScript execution code:

### Step 1: Pre-Flight Invariant Validation
- Verify the sender balance is strictly greater than `amountIn + estimatedGas`.
- Ensure destination address is non-zero and passes checksum validation (EIP-55 for EVM, StrKey for Stellar).
- Validate that `deadline >= currentTimestamp + 300` (5-minute execution safety window).

### Step 2: Token Approval (EVM Only)
```typescript
// Approve Router or SpokePool contract to spend input token
await tokenContract.write.approve([routerAddress, amountIn], {
  account: senderWallet,
});
```

### Step 3: Deposit / Bridge Dispatch
```typescript
// Call protocol deposit or bridge initiation function
await routerContract.write.deposit([
  recipientAddress,
  destinationDomainId,
  amountIn,
  minAmountOut,
  deadline,
]);
```

### Step 4: Relayer Tracking & Destination Verification
- Poll relayer status or query target chain balance until recipient wallet receives `amountOut >= minAmountOut`.

---

## 4. Security Invariants & Guardrails
- **Slippage Bounds:** Revert if `amountOut < amountIn * (1 - maxSlippage)`.
- **Address Formatting:** EVM addresses mapped into non-EVM protocols (or vice versa) must be padded to `bytes32` (`padHex(address, { size: 32 })`).
- **Destination Tag / Memo:** If destination is an exchange or non-EVM account (Stellar/XRPL), enforce memo presence.
