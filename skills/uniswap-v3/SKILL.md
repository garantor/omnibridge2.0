---
# ==============================================================================
# UNISWAP V3 DEX SWAP SKILL
# Type: swap | Scope: same-chain asset conversion (DEX AMM)
# ==============================================================================

name: uniswap-v3
displayName: "Uniswap v3 DEX Router"
type: swap
version: 3.0.0

supportedChains:
  - ethereum
  - polygon
  - arbitrum
  - optimism
  - base

supportedTokens:
  - USDC

capabilities:
  - concentrated-liquidity
  - same-chain-swap
  - exact-input-single
  - multi-hop-token-conversion

# Uniswap SwapRouter02 Contract Addresses
contracts:
  ethereum:
    swapRouter: "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45"
    quoter: "0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6"
  polygon:
    swapRouter: "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45"
    quoter: "0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6"
  arbitrum:
    swapRouter: "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45"
    quoter: "0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6"
  base:
    swapRouter: "0x2626664c2603336E57B271c5C0b26F421741e481"
    quoter: "0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a"

requirements:
  nodePackages:
    - viem
---

# Uniswap v3 Procedural Instructions (Same-Chain Swap Primitive)

## 1. Skill Purpose in Multi-Hop Routing
This skill is a **same-chain swap primitive** (`type: swap`). It is invoked by the multi-hop routing graph solver in two situations:
1. **Pre-Bridge Conversion:** When the user holds Token A (e.g. `MATIC`) on the source chain, but the bridge protocol only accepts Token B (e.g. `USDC`).
2. **Post-Bridge Conversion:** When the bridge outputs Token B (e.g. `USDC`) on the target chain, but the user requested Token C (e.g. `ARB`).

---

## 2. Dynamic Execution Flow

### Step 1: Token Approval to SwapRouter02
```typescript
// If trading an ERC-20 token (not native ETH), approve SwapRouter02
if (tokenInAddress !== '0x0000000000000000000000000000000000000000' && tokenInAddress !== 'native') {
  const allowance = await publicClient.readContract({
    address: tokenInAddress,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [signerAddress, swapRouterAddress],
  });

  if (allowance < amountInUnits) {
    const appTx = await walletClient.writeContract({
      address: tokenInAddress,
      abi: erc20Abi,
      functionName: 'approve',
      args: [swapRouterAddress, amountInUnits],
    });
    await publicClient.waitForTransactionReceipt({ hash: appTx });
  }
}
```

### Step 2: Execute exactInputSingle Swap
```typescript
const deadline = Math.floor(Date.now() / 1000) + 300; // 5-minute safety deadline
const feeTier = 500; // 0.05% standard stable/liquid pool tier

const swapTx = await walletClient.writeContract({
  address: swapRouterAddress,
  abi: [
    {
      name: 'exactInputSingle',
      type: 'function',
      inputs: [
        {
          name: 'params',
          type: 'tuple',
          components: [
            { name: 'tokenIn', type: 'address' },
            { name: 'tokenOut', type: 'address' },
            { name: 'fee', type: 'uint24' },
            { name: 'recipient', type: 'address' },
            { name: 'amountIn', type: 'uint256' },
            { name: 'amountOutMinimum', type: 'uint256' },
            { name: 'sqrtPriceLimitX96', type: 'uint160' }
          ]
        }
      ],
      outputs: [{ name: 'amountOut', type: 'uint256' }]
    }
  ],
  functionName: 'exactInputSingle',
  args: [
    {
      tokenIn: tokenInAddress,
      tokenOut: tokenOutAddress,
      fee: feeTier,
      recipient: signerAddress,
      amountIn: amountInUnits,
      amountOutMinimum: minAmountOutUnits,
      sqrtPriceLimitX96: 0n,
    }
  ],
  value: tokenInAddress === 'native' ? amountInUnits : 0n,
});

const swapReceipt = await publicClient.waitForTransactionReceipt({ hash: swapTx });
```
