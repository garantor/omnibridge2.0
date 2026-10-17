---
# ==============================================================================
# CIRCLE CROSS-CHAIN TRANSFER PROTOCOL (CCTP) SKILL
# Type: bridge | Model: burn-and-mint-attestation
# ==============================================================================

name: circle-cctp
displayName: "Circle CCTP (Native Burn & Mint)"
type: bridge
version: 2.0.0

supportedChains:
  - ethereum
  - arbitrum
  - base
  - optimism
  - polygon

supportedTokens:
  - USDC

capabilities:
  - native-usdc-mint
  - zero-slippage
  - cryptographic-attestation
  - finality-settlement

# Contract Addresses per Network (Circle TokenMessenger & MessageTransmitter)
contracts:
  ethereum:
    tokenMessenger: "0xbd3fa81b58ba92a82136038b25adec7066af3155"
    messageTransmitter: "0x0a992d191deec32afe36203ad87d7d289a738f81"
    domainId: 0
  arbitrum:
    tokenMessenger: "0x19330d10d9cc8751218eaf51e8885d058642e08a"
    messageTransmitter: "0xc30362313fbba5cf9163f0bb00a558fd22a52043"
    domainId: 3
  base:
    tokenMessenger: "0x1682ae6375c4e4a97e4b583bc394c861a46d8962"
    messageTransmitter: "0xad0978e171b2f166f00402ae8822dd357779ec86"
    domainId: 6
  optimism:
    tokenMessenger: "0x2b4069517957735be00cee0fadbaeb882d6710fe"
    messageTransmitter: "0x4d41f22c5a0e5c74090899e5a8fb597a8842b3e8"
    domainId: 2
  polygon:
    tokenMessenger: "0x9daF8250e014F962b60931F71006637ba9653241"
    messageTransmitter: "0xF3be9355363857F3e001be68856A2f96b4C39Ba9"
    domainId: 7

# Attestation Service (Circle Iris API)
attestation:
  pollUrl: "https://iris-api.circle.com/attestations/{messageHash}"
  expectedTimeSec: 90

requirements:
  nodePackages:
    - viem
  environmentVariables:
    - PRIVATE_KEY
---

# Circle CCTP Procedural Instructions

## 1. Protocol Architecture
Circle CCTP enables native 1:1 cross-chain USDC transfers without wrapped tokens or liquidity pools.
1. **Source Chain**: USDC is burned via `TokenMessenger.depositForBurn()`.
2. **Attestation Service**: Circle Iris validator network observes the burn event and signs an attestation payload.
3. **Destination Chain**: The user (or relayer) submits the attestation to `MessageTransmitter.receiveMessage()` to mint native USDC directly to the recipient address.

---

## 2. Dynamic Execution Flow

When synthesizing execution code for Circle CCTP, generate the following 4-step sequence:

### Step 1: Token Approval
```typescript
// Grant TokenMessenger allowance to burn source USDC
const allowance = await publicClient.readContract({
  address: sourceUsdcAddress,
  abi: erc20Abi,
  functionName: 'allowance',
  args: [signerAddress, tokenMessengerAddress],
});

if (allowance < amountUnits) {
  const approveTx = await walletClient.writeContract({
    address: sourceUsdcAddress,
    abi: erc20Abi,
    functionName: 'approve',
    args: [tokenMessengerAddress, amountUnits],
  });
  await publicClient.waitForTransactionReceipt({ hash: approveTx });
}
```

### Step 2: Deposit For Burn
```typescript
// Encode destination recipient into bytes32
const mintRecipientBytes32 = pad(recipientAddress, { size: 32 });

const burnHash = await walletClient.writeContract({
  address: tokenMessengerAddress,
  abi: [
    {
      name: 'depositForBurn',
      type: 'function',
      inputs: [
        { name: 'amount', type: 'uint256' },
        { name: 'destinationDomain', type: 'uint32' },
        { name: 'mintRecipient', type: 'bytes32' },
        { name: 'burnToken', type: 'address' }
      ],
      outputs: [{ name: '_nonce', type: 'uint64' }]
    }
  ],
  functionName: 'depositForBurn',
  args: [amountUnits, targetDomainId, mintRecipientBytes32, sourceUsdcAddress],
});
const burnReceipt = await publicClient.waitForTransactionReceipt({ hash: burnHash });
```

### Step 3: Poll Circle Iris Attestation Service
```typescript
// Extract message bytes from MessageSent event log (Topic 0: 0x8c52611786cdab46b8280b5528d2345495949272f83d9b9c5222a8ff6329c52a)
const messageLog = burnReceipt.logs.find(log => log.topics[0] === '0x8c52611786cdab46b8280b5528d2345495949272f83d9b9c5222a8ff6329c52a');
const messageBytes = messageLog.data;
const messageHash = keccak256(messageBytes);

let attestation = null;
while (!attestation) {
  await new Promise(r => setTimeout(r, 5000));
  const res = await fetch(`https://iris-api.circle.com/attestations/${messageHash}`).then(r => r.json());
  if (res.status === 'complete') {
    attestation = res.attestation;
  }
}
```

### Step 4: Mint on Destination Chain
```typescript
// Submit attestation to destination MessageTransmitter
const mintHash = await destinationWalletClient.writeContract({
  address: targetMessageTransmitterAddress,
  abi: [
    {
      name: 'receiveMessage',
      type: 'function',
      inputs: [
        { name: 'message', type: 'bytes' },
        { name: 'attestation', type: 'bytes' }
      ],
      outputs: [{ name: 'success', type: 'bool' }]
    }
  ],
  functionName: 'receiveMessage',
  args: [messageBytes, attestation],
});
await destinationPublicClient.waitForTransactionReceipt({ hash: mintHash });
```
