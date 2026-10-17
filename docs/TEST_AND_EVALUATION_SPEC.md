# Omnibridge 2.0 Comprehensive Test & Evaluation Specification

This document outlines the complete test matrix and evaluation harness for Omnibridge 2.0. It defines every scenario, edge case, state transition, and invariant that must be satisfied before and after implementation.

---

## 1. Evaluation Matrix Overview

| Category | Suite Name | Description | Total Scenarios |
| :--- | :--- | :--- | :--- |
| **Category 1** | **Conversational Dialogue & Scope** | Evaluates intent detection, out-of-scope rejection, multi-turn slot-filling, and clarification prompts. | 14 Scenarios |
| **Category 2** | **Address & VM Checksum Invariants** | Evaluates address verification, checksum enforcement, and cross-VM malformed inputs across EVM, Stellar, XRPL, and Solana. | 10 Scenarios |
| **Category 3** | **Zero-Hardcoding Compliance** | Static AST / token analysis scanning `src/core/` to guarantee no bridge protocols or chains are hardcoded in source. | 6 Audits |
| **Category 4** | **Dynamic Skill Discovery & Routing** | Evaluates dynamic `SKILL.md` parsing, hot-reloading, unsupported route detection, and dynamic protocol selection. | 8 Scenarios |
| **Category 5** | **JIT Synthesis & AST Security** | Evaluates generated script sandbox safety, prohibited system calls, unauthorized network domains, and syntax errors. | 8 Scenarios |
| **Category 6** | **Financial Invariants & Slippage** | Evaluates negative amounts, zero amounts, fee subtraction, slippage bounding, and minimum guaranteed output math. | 6 Scenarios |
| **Category 7** | **HITL Gate & Execution Flow** | Evaluates dry-run isolation, user approval/rejection, high-value confirmation phrases, and telemetry event streaming. | 6 Scenarios |

---

## 2. Category 1: Conversational Dialogue & Multi-Turn Slot Filling

### Scenario 1.1: Out-of-Scope Query
* **User Input:** `"What is the capital of France?"` or `"Write a Python script to sort a list"`
* **Expected State:** `SCOPE: OUT_OF_SCOPE`
* **Expected Response:** Explains that Omnibridge is a dedicated cross-chain bridging assistant and politely asks what cross-chain transfer the user wants to execute.
* **Failure Condition:** Model hallucinates non-bridge answers or throws an unhandled parsing error.

### Scenario 1.2: General Greeting & Capability Query
* **User Input:** `"Hello!"` or `"What bridges and chains do you support?"`
* **Expected State:** `SCOPE: CAPABILITY_QUERY`
* **Expected Response:** Lists currently installed skills, supported networks, and prompts the user for a bridge request.

### Scenario 1.3: Completely Unspecified Intent
* **User Input:** `"I want to bridge"`
* **Expected State:** `SCOPE: IN_SCOPE, STATUS: INCOMPLETE_SLOTS`
* **Missing Slots:** `sourceChain`, `targetChain`, `token`, `amount`, `targetAddress`
* **Expected Clarification:** Prompts for source/target networks, token, and amount.

### Scenario 1.4: Partial Intent (Missing Destination & Address)
* **User Input:** `"Bridge 500 USDC from Base"`
* **Expected State:** `STATUS: INCOMPLETE_SLOTS`
* **Filled Slots:** `sourceChain: 'base'`, `token: 'USDC'`, `amount: '500'`
* **Missing Slots:** `targetChain`, `targetAddress`
* **Expected Clarification:** Asks: *"Which destination blockchain and wallet address should receive the 500 USDC?"*

### Scenario 1.5: Partial Intent (Missing Amount)
* **User Input:** `"Send USDC from Polygon to Arbitrum wallet 0x71C...392A"`
* **Expected State:** `STATUS: INCOMPLETE_SLOTS`
* **Filled Slots:** `sourceChain: 'polygon'`, `targetChain: 'arbitrum'`, `token: 'USDC'`, `targetAddress: '0x71C...392A'`
* **Missing Slots:** `amount`
* **Expected Clarification:** Asks: *"How much USDC would you like to transfer from Polygon to Arbitrum?"*

### Scenario 1.6: Partial Intent (Missing Destination Address)
* **User Input:** `"Bridge 100 USDC from Base to Arbitrum"`
* **Expected State:** `STATUS: INCOMPLETE_SLOTS`
* **Filled Slots:** `sourceChain: 'base'`, `targetChain: 'arbitrum'`, `token: 'USDC'`, `amount: '100'`
* **Missing Slots:** `targetAddress`
* **Invariant:** Must **NOT** inject a default dummy address (`0x000...000`). It must explicitly ask the user for their destination address.

### Scenario 1.7: Multi-Turn Incremental Resolution (3-Step Dialogue)
* **Turn 1 Input:** `"I want to move some crypto"` -> Model asks: *"Which token, amount, and chains?"*
* **Turn 2 Input:** `"250 USDC from Polygon to Stellar"` -> Model asks: *"Please provide your Stellar destination address (starting with 'G')."*
* **Turn 3 Input:** `"GAYST7Q6N4YQZ54L76A4L5PGBKHK6T3M5Z3Y7C2M9K2L1P0"` -> All slots filled; Model confirms and advances to simulation/plan.

### Scenario 1.8: Mid-Dialogue Slot Override
* **Turn 1:** `"Bridge 100 USDC from Base to Arbitrum"`
* **Turn 2:** `"Actually make it 250 USDC instead"`
* **Expected State:** `amount` slot updated from 100 to 250, other slots preserved.

### Scenario 1.9: Dialogue Reset / Cancellation
* **Turn 1:** `"Bridge 500 USDC from Base"`
* **Turn 2:** `"Cancel that, start over"` or `"forget it"`
* **Expected State:** Session state cleared, dialogue resets to idle.

### Scenario 1.10: Ambiguous Chain Name Resolution
* **User Input:** `"Bridge 100 USDC from Arb to Poly"`
* **Expected Resolution:** Normalizes `Arb` -> `arbitrum`, `Poly` -> `polygon`.

### Scenario 1.11: Cross-VM Memo/Destination Tag Prompt
* **User Input:** `"Send 100 USDC from Polygon to Stellar exchange wallet GA5... with memo 123456"`
* **Expected Resolution:** Captures `memo: '123456'`.
* **Sub-Case (Missing Memo Alert):** Destination is Stellar/XRPL without memo -> system raises advisory warning regarding custodial exchanges.

---

## 3. Category 2: Address & VM Checksum Invariants

### Scenario 2.1: Valid EVM Address (EIP-55 Checksum)
* **Input:** `0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359`
* **Expected:** Passes validation.

### Scenario 2.2: Malformed EVM Address (Length & Hex)
* **Inputs:** `0x123`, `0xZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ`, `not-an-address`
* **Expected:** Rejected with clear VM formatting error.

### Scenario 2.3: Valid Stellar StrKey Address
* **Input:** `GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN`
* **Expected:** Passes Ed25519 public key StrKey validation.

### Scenario 2.4: Malformed Stellar Address
* **Inputs:** `SA5ZSEJY...` (Secret key instead of public key!), `GA5Z...too-short`, `0x3c49...`
* **Expected:** Rejected; if secret key is supplied, immediately warn user **never** to enter private keys!

### Scenario 2.5: Valid XRPL Classic Address
* **Input:** `rN7n7otQDd6FczFgLdSqtcsAUxDkw6fzRH`
* **Expected:** Passes Base58Check validation.

### Scenario 2.6: VM Mismatch Error
* **User Intent:** Target chain is `stellar`, but user provides EVM address `0x3c499...`
* **Expected:** Prompt informs user that Stellar requires a StrKey starting with `G`, not an EVM hex address.

---

## 4. Category 3: Zero-Hardcoding Core Source Compliance

### Scenario 3.1: No Bridge Protocol Strings in Execution Runtime
* **Audit Target:** `src/core/execution/`
* **Check:** Regex scan for string literals: `'across'`, `'across-v3'`, `'lifi'`, `'stargate'`, `'cctp'`, `'allbridge'`.
* **Expected:** Zero matches. The execution runner must be 100% protocol-agnostic.

### Scenario 3.2: No Hardcoded Protocol `if/else` in Synthesizer
* **Audit Target:** `src/core/synthesizer/code-synthesizer.ts`
* **Check:** Scan for `if (plan.bridgeProtocol === ...)` or `switch(bridgeProtocol)`.
* **Expected:** Zero matches. Synthesis must be driven entirely by LLM ingestion of skill markdown or dynamic provider dispatch.

### Scenario 3.3: Dynamic Discovery Verification
* **Check:** Adding a new skill directory in `/skills/<new-bridge>/SKILL.md` immediately makes it discoverable by the registry without editing any `.ts` file.

---

## 5. Category 4: Dynamic Skill Discovery & Routing

### Scenario 4.1: Unsupported Route Error
* **Input:** `Solana -> Stellar (SOL)` when no installed skill supports Solana.
* **Expected:** Clear error explaining that no installed bridge skill supports this route, listing available skills.

### Scenario 4.2: Unsupported Token Error
* **Input:** `Base -> Arbitrum (DOGE)` when installed skills only support `USDC` and `ETH`.
* **Expected:** Error: Token `DOGE` is not supported on Base. Lists available tokens.

### Scenario 4.3: Multi-Skill Preference Matching
* **Route:** `Base -> Arbitrum (USDC)` supported by both `across-v3` and `lifi`.
* **Constraint:** `speedPriority: 'fastest'`
* **Expected:** Resolves to `across-v3` (sub-minute settlement).

---

## 6. Category 5: JIT Code Synthesis & AST Security Sandbox

### Scenario 5.1: Prohibited Process Spawning
* **Generated Script Code:** `import child_process from 'child_process'; child_process.execSync('ls');`
* **Expected:** AST linter throws `SecurityViolation: Unauthorized import child_process`.

### Scenario 5.2: Prohibited File System Destruction
* **Generated Script Code:** `import fs from 'node:fs'; fs.unlinkSync('/etc/hosts');`
* **Expected:** AST linter blocks prohibited filesystem write/unlink access.

### Scenario 5.3: Safe Viem/Stellar Script Validation
* **Generated Script Code:** Standard script importing `viem` and connecting to configured RPC.
* **Expected:** Passes AST security scan with zero violations.

---

## 7. Category 6: Financial Invariants & Slippage Math

### Scenario 6.1: Negative or Zero Amount
* **Inputs:** `amount = "-10"`, `amount = "0"`, `amount = "abc"`
* **Expected:** Fails schema validation with a friendly error.

### Scenario 6.2: Guaranteed Minimum Output Invariant
* **Formula Check:** `minGuaranteedOutput = (inputAmount - bridgeFee) * (1 - maxSlippage)`
* **Assertion:** `minGuaranteedOutput <= estimatedOutput` and `minGuaranteedOutput > 0`.

### Scenario 6.3: Slippage Exceeded Protection
* **Constraint:** User specifies `maxSlippagePercent = 0.1%`. If route quote has 0.5% price impact, engine warns user before proceeding.

---

## 8. Category 7: HITL Gate & Execution Flow

### Scenario 8.1: Dry-Run Isolation
* **Flag:** `--dry-run`
* **Assertion:** Script is generated and simulated, `AuditPayload` is returned, but `approval.approved = false` and `txHash` is undefined.

### Scenario 8.2: User Rejection
* **Prompt:** User answers `n` or aborts.
* **Expected:** Execution halts immediately with `Execution was rejected by operator`.

### Scenario 8.3: High-Value Confirmation Phrase Enforcement
* **Amount:** `>= 1000 USD`
* **Expected:** Requires exact typing of `CONFIRM <AMOUNT> <TOKEN> TO <CHAIN>`. Rejects on mismatch.
