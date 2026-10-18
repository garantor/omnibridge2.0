# Multi-Hop Intelligent Bridge Routing: Implementation Specification

**Status:** Proposed / Under Review  
**Target Architecture:** Omnibridge Core Engine (Headless, Agentic, Zero-Hardcoded Protocols)  
**Document Version:** 1.0.0  

---

## 1. Executive Summary & Objective

In the current cross-chain ecosystem, protocols rarely connect all blockchain pairs directly. For example:
- **Across Protocol v3** excels between EVM Layer 2s (Arbitrum, Base, Optimism, Polygon).
- **Allbridge Core** specializes in bridging between EVM and Non-EVM chains (Polygon, Base <-> Stellar, Solana).
- **Circle CCTP** offers native mint/burn between supported USDC chains.

When a user requests a route with **no direct bridge connection** (e.g. from a chain supported only by Bridge A to a chain supported only by Bridge B, or across heterogeneous VMs without a 1:1 direct bridge), the current engine fails with:
`No installed bridge skill supports route <source> -> <target> for <token>`.

### Objective
Enable Omnibridge to **intelligently connect the dots** by dynamically discovering intermediate "hub" chains and chaining two (or more) bridge/swap skills into a unified, secure, and transparent multi-hop execution plan.

---

## 2. Core Architecture: Dynamic Graph Pathfinding

To respect the **Zero-Hardcoding Invariant** of the engine, the multi-hop solver will not hardcode intermediate chains or pairs. Instead, it dynamically queries the active `SkillRegistry` and constructs a directed connectivity graph.

```mermaid
graph LR
    subgraph Leg 1 [Hop 1: EVM to Hub]
        S["Source Chain\n(e.g., Stellar / Solana)"] -->|Bridge Skill A\n(e.g., Allbridge Core)| H["Intermediate Hub\n(e.g., Polygon / Base)"]
    end
    subgraph Leg 2 [Hop 2: Hub to Destination]
        H -->|Bridge Skill B\n(e.g., Across v3)| D["Target Chain\n(e.g., Arbitrum)"]
    end

    style S fill:#2b2d42,stroke:#8d99ae,stroke-width:2px,color:#fff
    style H fill:#3a0ca3,stroke:#4cc9f0,stroke-width:2px,color:#fff
    style D fill:#2b2d42,stroke:#8d99ae,stroke-width:2px,color:#fff
```

### 2.1 Graph Formulation
* **Nodes**: A tuple of `(ChainId/Name, TokenSymbol)`.
* **Directed Edges**: Transitions provided by installed skills:
  * **Bridge Edge**: Moves `Token T` from `Chain A` to `Chain B` via bridge protocol $P$.
  * **Swap Edge**: Converts `Token T1` to `Token T2` on `Chain A` via DEX protocol $S$ (e.g., Uniswap v3, Jupiter).
* **Edge Weights**: A composite heuristic:
  `Cost = alpha * GasUsd + beta * BridgeFeeUsd + gamma * SettlementSec`

### 2.2 Pathfinding Solver
* **Phase 1 (Direct Match)**: Check if a direct `RouteRecipe` or 1-hop bridge connects `(srcChain, token) -> (dstChain, token)`.
* **Phase 2 (2-Hop BFS / Dijkstra)**: If no direct route exists, search for paths with <= 2 bridge hops via an intermediate hub chain $H$:
  1. Find all bridge skills where $b_1$ connects `srcChain -> H` for `token`.
  2. Find all bridge skills where $b_2$ connects `H -> dstChain` for `token` (or an intermediate swappable token).
  3. Prune candidate hubs where $H$ is not in the active seed catalog or disabled.
  4. Select the optimal path minimizing total fees and expected settlement time.

---

## 3. Data Structures & Type Definitions

We will update [skill.types.ts](file:///Users/afo/playground/ominiBridge/src/core/skills/skill.types.ts) and [route-planner.ts](file:///Users/afo/playground/ominiBridge/src/core/agent/route-planner.ts):

### 3.1 Multi-Hop Route Types
```typescript
export interface RouteHopLeg {
  legIndex: number;
  fromChain: string;
  toChain: string;
  token: string;
  protocol: string;
  protocolDisplayName: string;
  type: 'bridge' | 'swap';
  estimatedSettlementSec: number;
  estimatedFeeUsd: number;
}

export interface MultiHopRoute {
  isMultiHop: boolean;
  totalHops: number;
  intermediateChains: string[];
  legs: RouteHopLeg[];
  totalEstimatedSettlementSec: number;
  totalFeeUsd: number;
}
```

### 3.2 Enhanced `ExecutionPlan`
```typescript
export interface ExecutionPlan {
  id: string;
  intent: ParsedIntent;
  sourceToken: TokenMetadata;
  targetToken: TokenMetadata;
  bridgeProtocol: string;              // e.g. "allbridge-core -> across-v3"
  isMultiHop: boolean;
  multiHopRoute?: MultiHopRoute;       // Populated when totalHops > 1
  recipe: RouteRecipe | null;
  estimatedSettlementSec: number;
  fees: {
    gasFeeUsd: number;
    bridgeFeeUsd: number;
    totalFeeUsd: number;
    breakdownPerHop?: { hop: number; protocol: string; feeUsd: number }[];
  };
  amounts: {
    inputAmount: string;
    estimatedOutput: string;
    minGuaranteedOutput: string;
    slippagePercent: number;
  };
  steps: ExecutionStep[];
  warnings: string[];
}
```

---

## 4. Key Subsystem Implementation Details

### 4.1 Route Planner (`src/core/agent/route-planner.ts`)
1. **Fallback to Multi-Hop**: When no 1-hop recipe or direct skill connects `src` and `dst`, call `registry.findMultiHopPath(srcChain.name, dstChain.name, intent.token)`.
2. **Fee & Slippage Compounding**:
   * Compound bridge fees across all legs:
     `Estimated Output = Input * (1 - f_1) * (1 - f_2)`
   * Compound slippage bounds:
     `Min Guaranteed = Estimated Output * (1 - slippage_1) * (1 - slippage_2)`
3. **Execution Steps Decomposition**:
   * Generate ordered steps with clear sequential indices:
     * *Step 1*: Approve Leg 1 Protocol on Source Chain
     * *Step 2*: Bridge via Leg 1 Protocol (Source -> Hub)
     * *Step 3*: Await settlement on Hub Chain
     * *Step 4*: Approve Leg 2 Protocol on Hub Chain
     * *Step 5*: Bridge via Leg 2 Protocol (Hub -> Target)
     * *Step 6*: Settlement / Claim on Target Chain

### 4.2 Intermediate Chain & Gas Preflight (`src/core/simulation/preflight-simulator.ts`)
* **Intermediate Balance Checks**: A multi-hop transfer requires native gas on the intermediate chain (e.g., Base ETH or Polygon MATIC) to execute the second bridge transaction and token approval.
* **Advisory Warning**: The simulator adds a warning if the intermediate wallet address lacks native gas tokens:
  > *"Multi-hop notice: Intermediate execution on Base requires native ETH for Step 4 approval and Step 5 deposit."*

### 4.3 JIT Ephemeral Code Synthesis (`src/core/synthesizer/code-synthesizer.ts`)
The JIT synthesizer compiles a single-use TypeScript script that coordinates both legs:
1. **Leg 1 Dispatch**: Submits transaction to Bridge 1 on Source Chain.
2. **Attestation / Polling Wait**: Implements a secure polling loop checking the intermediate wallet's token balance on Hub Chain or listening for the bridge attestation receipt.
3. **Leg 2 Dispatch**: Once the balance is verified on Hub Chain, dispatches approval and deposit transactions for Bridge 2 on Hub Chain to Target Chain.

### 4.4 Conversational Agent Transparency (`src/core/agent/chat-session.ts`)
When a multi-hop route is planned, `ChatSession` informs the user directly:
> *"No direct bridge exists between Stellar and Arbitrum for USDC. I have connected the dots using a 2-hop route via Polygon:\n- Hop 1: Stellar -> Polygon via Allbridge Core (~60s)\n- Hop 2: Polygon -> Arbitrum via Across Protocol v3 (~2s)\nEstimated total time: ~62s. Total estimated fee: $1.25."*

---

## 5. Security Invariants & Failure Modes

1. **Non-Atomic Intermediary Risk**:
   * Unlike single-chain transactions, cross-chain multi-hop transfers are **not atomic**. Leg 1 can succeed while Leg 2 is delayed or fails.
   * **Mitigation**: The synthesized script outputs checkpoint states and transaction receipts for Leg 1 so that the user's funds on the intermediate chain are never lost; if Leg 2 fails, the script reports the exact intermediate token balance and provides a recovery command.
2. **Recipient Routing**:
   * For Leg 1, the recipient must be the *user's own address on the intermediate chain* (so they control the funds for Leg 2).
   * For Leg 2, the final recipient is the user's intended target address on the destination chain.
3. **AST Static Code Safety**:
   * Multi-hop synthesized scripts continue to be strictly verified against `AstSecurityValidator` (no arbitrary shell execution, no unverified network exfiltration).

---

## 6. Implementation Roadmap

```
[Phase 1] Graph Pathfinding in SkillRegistry
    └── Build adjacency graph from loaded skills
    └── Implement findMultiHopPath() algorithm

[Phase 2] RoutePlanner & ExecutionPlan Enhancement
    └── Multi-hop fallback when direct route is missing
    └── Step breakdown (Approve 1 -> Bridge 1 -> Settle -> Approve 2 -> Bridge 2 -> Settle)
    └── Compounded fee and slippage calculation

[Phase 3] Preflight Simulation & Chat Transparency
    └── Multi-hop simulation logging & gas verification
    └── Conversational agent UI messaging & warnings for intermediate chains

[Phase 4] JIT Code Synthesis & Live Execution Support
    └── Synthesize 2-hop orchestration script with polling receipt check
    └── Intermediate recipient safety check

[Phase 5] Verification & Automated Test Suite
    └── Unit tests for graph solver and multi-hop route generation
    └── Simulation & synthetic script AST security validation
    └── End-to-end evaluation benchmark
```
