---
# ==============================================================================
# OMNIBRIDGE PROTOCOL SKILL SPECIFICATION (DECLARATIVE v2.0)
# ==============================================================================
# DEVELOPER NOTICE:
# YOU DO NOT NEED TO WRITE TYPESCRIPT CODE.
# A Skill is a pure declarative definition (YAML metadata + API/ABI endpoints).
# The AI Agent reads these specifications and automatically compiles 100% of the
# execution code Just-In-Time (JIT), including composing multi-hop cross-chain
# swaps across different protocols, chains, and tokens.
# ==============================================================================

# 1. Identity & Capability Classification
name: sample-bridge-protocol         # Unique kebab-case ID (e.g. across-v3, circle-cctp, uniswap-v3)
displayName: "Sample Bridge Protocol"
type: bridge                         # Primitive type: 'bridge' (cross-chain) | 'swap' (same-chain DEX)
version: 2.0.0

# 2. Supported Topology
supportedChains:
  - polygon
  - base
  - arbitrum

supportedTokens:
  - USDC

# 3. Protocol Execution Interface (Pure Declarative - Choose API or Contract)
# ─────────────────────────────────────────────────────────────────────────────
# OPTION A: REST API / Intent Solver (e.g. Across, LiFi, Squid)
# If your protocol provides an off-chain API that quotes and constructs calldata:
quoteApi:
  baseUrl: "https://api.sample-protocol.com/v1"
  quoteEndpoint: "/quote"
  method: GET
  params:
    fromChain: "{sourceChainId}"
    toChain: "{targetChainId}"
    inputToken: "{sourceTokenAddress}"
    outputToken: "{targetTokenAddress}"
    amount: "{amountUnits}"
    recipient: "{recipientAddress}"
    slippage: "{slippagePercent}"
  responseMapping:
    estimatedOutput: "quote.outputAmount"
    minOutput: "quote.minOutputAmount"
    approvalTxns: "quote.approvalTransactions"   # Optional array of approval { to, data, value }
    executionTx: "quote.transactionRequest"       # Primary broadcast { to, data, value, gas }
  statusTrackingEndpoint: "/status/{txHash}"

# ─────────────────────────────────────────────────────────────────────────────
# OPTION B: Direct Smart Contracts (e.g. Circle CCTP, Wormhole, Stargate)
# If your protocol interacts directly with on-chain smart contracts:
contracts:
  polygon:
    router: "0x1234567890123456789012345678901234567890"
    domainId: 7
  base:
    router: "0x2345678901234567890123456789012345678901"
    domainId: 6
  arbitrum:
    router: "0x3456789012345678901234567890123456789012"
    domainId: 3

methods:
  # Method invoked on source chain
  dispatch:
    abi: "function deposit(address recipient, uint32 destDomain, uint256 amount, uint256 minAmountOut)"
  # Method invoked on target chain (if active settlement is required, e.g. CCTP/Wormhole)
  claim:
    abi: "function receiveMessage(bytes messageBytes, bytes signature)"
    attestationApi: "https://iris.circle.com/attestations/{messageHash}"

# 4. Runtime Requirements (Injected automatically into transient runner)
requirements:
  nodePackages:
    - viem
  environmentVariables:
    - PRIVATE_KEY                    # Consumed strictly by transient sandbox runner; never exposed to LLM
---

# Declarative Skill Authoring Guide & Multi-Hop Composition

## 1. Zero-Code Skill Authoring Philosophy
In Omnibridge, **developers do not write execution scripts or boilerplate glue code**.
* A skill author simply fills out the declarative YAML header above:
  1. What chains and tokens are supported.
  2. The REST API query parameters OR the smart contract ABI functions.
* The AI Agent acts as an on-the-fly compiler: it reads the YAML schema and writes strictly-typed TypeScript code tailored to the exact user context.

---

## 2. Multi-Hop Composition Across Protocols, Chains & Tokens

Real-world cross-chain transfers often require routing through **different protocols, different chains, and different tokens**:

> **User Request:** *"Move 1,000 MATIC on Polygon to SOL on Solana"*

No single bridge connects Polygon MATIC directly to Solana SOL. The Omnibridge **Graph Solver** automatically composes a multi-hop pipeline using standalone primitive skills:

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                    MULTI-HOP ROUTING PIPELINE SOLVER                         │
└──────────────────────────────────────────────────────────────────────────────┘

  [HOP 1: DEX Swap on Polygon]
  ├── Skill:     skills/uniswap-v3/ (type: swap)
  ├── Action:    Swap 1,000 MATIC ➔ 420 USDC on Polygon
  └── Executor:  Synthesizes Uniswap v3 exactInputSingle()

        │
        ▼ (USDC ready on Polygon)

  [HOP 2: Cross-Chain Bridge]
  ├── Skill:     skills/allbridge-core/ (type: bridge)
  ├── Action:    Bridge 420 USDC (Polygon) ➔ 419.2 USDC (Solana)
  └── Executor:  Synthesizes Allbridge sendPayload()

        │
        ▼ (USDC credited on Solana)

  [HOP 3: DEX Swap on Solana]
  ├── Skill:     skills/jupiter/ (type: swap)
  ├── Action:    Swap 419.2 USDC ➔ 2.85 SOL on Solana
  └── Executor:  Synthesizes Jupiter Swap API call
```

### How the Agent Synthesizes the Multi-Hop Script:
1. The Planner detects that `Polygon MATIC` cannot bridge directly to `Solana SOL`.
2. It solves the intermediate asset path using universal liquidity tokens (`USDC` or `ETH`).
3. The LLM receives the declarative specifications for all three skills (`uniswap-v3` + `allbridge-core` + `jupiter`).
4. The LLM synthesizes a **single, unified execution script** that:
   - Executes Hop 1 and awaits block inclusion.
   - Feeds the resulting balance into Hop 2.
   - Monitors Hop 3 destination settlement to final completion.

---

## 3. Creating a Same-Chain DEX Swap Skill (`type: swap`)

To enable multi-hop asset conversions before or after bridging, authors can add DEX skills:

```yaml
---
name: uniswap-v3
displayName: "Uniswap v3 DEX Router"
type: swap
version: 3.0.0

supportedChains:
  - polygon
  - base
  - arbitrum

# Pure Declarative Swap Interface
quoteApi:
  baseUrl: "https://api.uniswap.org/v1"
  quoteEndpoint: "/quote"
  params:
    tokenIn: "{tokenInAddress}"
    tokenOut: "{tokenOutAddress}"
    amount: "{amountUnits}"
    chainId: "{chainId}"
---
# Uniswap v3 Rules
- If allowance for tokenIn is less than amount, issue approval to Uniswap SwapRouter02.
- Execute swap calldata with deadline constraint of block.timestamp + 300.
```

---

## 4. Checklist for Submitting a New Skill
1. **No Code:** Ensure you did not write custom TypeScript runner code. Only provide YAML metadata and API/ABI specs.
2. **Dynamic Tokens & Chains:** Only declare the chains and tokens your bridge or DEX contract verifiably supports.
3. **Accurate Attestation:** If your protocol requires off-chain attestations (e.g. CCTP or Wormhole), provide the attestation polling URL.
4. **Drop in Folder:** Save as `skills/<protocol-name>/SKILL.md`. The engine discovers it dynamically upon next execution.
