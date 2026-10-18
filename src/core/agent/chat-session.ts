import { OmnibridgeEngine } from '../engine.js';
import { AddressChecker } from '../security/address-checker.js';
import { ExecutionPlan } from './route-planner.js';

export interface ChatSlots {
  sourceChain?: string;
  targetChain?: string;
  token?: string;
  amount?: string;
  targetAddress?: string;
  memo?: string;
  maxSlippagePercent?: number;
}

export interface ChatResponse {
  scope: 'IN_SCOPE' | 'OUT_OF_SCOPE';
  message: string;
  isComplete: boolean;
  isReset?: boolean;
  slots: ChatSlots;
  missingSlots: string[];
  targetAddress?: string;
  warnings?: string[];
  plan?: ExecutionPlan;
}

export class ChatSession {
  private slots: ChatSlots = {};
  private defaultSlippage = 0.5;

  constructor(private engine: OmnibridgeEngine) {}

  public getSlots(): ChatSlots {
    return { ...this.slots };
  }

  public reset(): void {
    this.slots = {};
  }

  public async sendMessage(message: string): Promise<ChatResponse> {
    const trimmed = message.trim();

    // 1. Cancellation / Reset Check
    if (/(?:^|\b)(?:cancel|start\s*over|reset|abort)(?:\b|$)/i.test(trimmed)) {
      this.reset();
      return {
        scope: 'IN_SCOPE',
        isReset: true,
        isComplete: false,
        message: 'Dialogue session reset. What cross-chain bridge transfer would you like to make?',
        slots: {},
        missingSlots: ['sourceChain', 'targetChain', 'token', 'amount', 'targetAddress'],
      };
    }

    // 2. Scope Evaluation Gate
    if (!this.isInScope(trimmed)) {
      const activeChains = this.engine.registry.getSupportedChains().map(c => c.displayName).join(', ');
      return {
        scope: 'OUT_OF_SCOPE',
        message: `I am Omnibridge, an autonomous cross-chain bridge agent. I can assist with cross-chain token transfers between active networks (${activeChains || 'Polygon, Base, Arbitrum'}). How can I help you bridge tokens?`,
        isComplete: false,
        slots: { ...this.slots },
        missingSlots: this.computeMissingSlots(),
      };
    }

    // 3. Extract / Update Slots
    const warnings: string[] = [];
    const mismatchError = this.extractAndUpdateSlots(trimmed, warnings);
    if (mismatchError) {
      return {
        scope: 'IN_SCOPE',
        message: mismatchError,
        isComplete: false,
        slots: { ...this.slots },
        missingSlots: this.computeMissingSlots(),
        targetAddress: this.slots.targetAddress || '',
        warnings,
      };
    }

    // 4. Check for Memo Advisories on Stellar / XRPL
    const targetChain = this.slots.targetChain?.toLowerCase();
    if ((targetChain === 'stellar' || targetChain === 'xrpl') && !this.slots.memo) {
      warnings.push(`${this.slots.targetChain} destination: If transferring to an exchange or custodial wallet, a memo / destination tag may be required.`);
    }

    // 5. Check Completeness
    const missing = this.computeMissingSlots();
    const isComplete = missing.length === 0;

    let responseMessage = '';
    let plan: ExecutionPlan | undefined;

    if (isComplete) {
      try {
        plan = await this.engine.planRoute({
          sourceChain: this.slots.sourceChain!,
          targetChain: this.slots.targetChain!,
          token: this.slots.token!,
          amount: this.slots.amount!,
          targetAddress: this.slots.targetAddress!,
          memo: this.slots.memo,
          maxSlippagePercent: this.slots.maxSlippagePercent ?? this.defaultSlippage,
        });

        const latencySuffix = plan.planningDurationMs !== undefined ? ` [Decision in ${plan.planningDurationMs}ms]` : '';
        if (plan.isMultiHop && plan.intermediateChains?.length) {
          responseMessage = `Ready to bridge ${this.slots.amount} ${this.slots.token} from ${this.slots.sourceChain} to ${this.slots.targetChain} via multi-hop (intermediate hub: ${plan.intermediateChains.join(', ')}). Recipient: ${this.slots.targetAddress}.${latencySuffix}`;
        } else {
          responseMessage = `Ready to bridge ${this.slots.amount} ${this.slots.token} from ${this.slots.sourceChain} to ${this.slots.targetChain} (Recipient: ${this.slots.targetAddress}).${latencySuffix}`;
        }
      } catch (err: any) {
        // Keep plan undefined if route planning fails
        responseMessage = `Ready to bridge ${this.slots.amount} ${this.slots.token} from ${this.slots.sourceChain} to ${this.slots.targetChain} (Recipient: ${this.slots.targetAddress}).`;
      }
    } else {
      responseMessage = this.generateClarifyingQuestion(missing);
    }

    return {
      scope: 'IN_SCOPE',
      message: responseMessage,
      isComplete,
      slots: { ...this.slots },
      missingSlots: missing,
      targetAddress: this.slots.targetAddress || '',
      warnings: warnings.length > 0 ? warnings : undefined,
      plan,
    };
  }

  private isInScope(text: string): boolean {
    // If we already have partial active slots, follow-ups are within scope
    if (Object.keys(this.slots).length > 0) return true;

    return /(?:bridge|transfer|send|swap|move|deposit|chain|arbitrum|polygon|base|ethereum|stellar|xrpl|solana|optimism|usdc|usdt|eth|xlm|xrp|token|wallet|0x[a-fA-F0-9]{10}|G[A-Z0-9]{10}|r[0-9a-zA-Z]{10})/i.test(text);
  }

  private extractAndUpdateSlots(text: string, warnings: string[]): string | null {
    // A. Memo Extraction
    const memoMatch = text.match(/(?:with\s+)?(?:memo|tag|destination\s*tag)\s*(?:is\s*)?[:=]?\s*([a-zA-Z0-9_-]+)/i);
    if (memoMatch) {
      this.slots.memo = memoMatch[1];
    } else if (/(?:bridge|send|transfer|move)\s+[\d.]+/i.test(text)) {
      this.slots.memo = undefined;
    }

    // B. Mid-dialogue slot correction (e.g. "Actually, make that 250 USDC instead")
    const correctionMatch = text.match(/(?:actually,?\s*)?(?:make\s+that|make\s+it|change\s+(?:it\s+)?to|use)\s+([\d.]+)(?:\s*([a-zA-Z0-9]+))?/i);
    if (correctionMatch) {
      this.slots.amount = correctionMatch[1];
      if (correctionMatch[2]) {
        this.slots.token = correctionMatch[2].toUpperCase();
      }
      return null;
    }

    // C. Standalone address input (e.g. "to 0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359")
    const evmAddrMatch = text.match(/0x[a-fA-F0-9]{40}/i);
    const stellarAddrMatch = text.match(/\b(G[A-Z0-9]{55})\b/);
    const xrplAddrMatch = text.match(/\b(r[1-9A-HJ-NP-za-km-z]{24,34})\b/);
    const stellarSecretMatch = text.match(/\b(S[A-Z0-9]{55})\b/);

    if (stellarSecretMatch) {
      return `Secret/private key detected! Never enter private keys. Please provide a public wallet address.`;
    }

    // D. Chain vs Token ambiguity resolution: "Send 1 ETH to Arbitrum"
    const sendTokenMatch = text.match(/(?:bridge|send|transfer|move)\s+([\d.]+)\s+(ETH|USDC|USDT|XLM|XRP|SOL|WBTC|DAI)\s+to\s+([a-zA-Z0-9_-]+)/i);
    if (sendTokenMatch) {
      this.slots.amount = sendTokenMatch[1];
      this.slots.token = sendTokenMatch[2].toUpperCase();
      this.slots.targetChain = sendTokenMatch[3].toLowerCase();
      if (!this.slots.sourceChain) {
        // Default source chain to ethereum for ETH if unspecified, or leave missing
        if (this.slots.token === 'ETH' && this.slots.targetChain !== 'ethereum') {
          this.slots.sourceChain = 'ethereum';
        }
      }
    } else {
      // E. Full or partial pattern: "Bridge 100 USDC from Base [to Arbitrum]" or "Bridge 100 USDC to Arbitrum"
      const fullOrPartialMatch = text.match(/(?:bridge|send|transfer|move)\s+([\d.]+)\s+([a-zA-Z0-9]+)(?:\s+(?:from\s+)?([a-zA-Z0-9_-]+))?(?:\s+to\s+([a-zA-Z0-9_-]+))?/i);
      if (fullOrPartialMatch) {
        if (fullOrPartialMatch[1]) this.slots.amount = fullOrPartialMatch[1];
        if (fullOrPartialMatch[2]) this.slots.token = fullOrPartialMatch[2].toUpperCase();
        if (fullOrPartialMatch[3]) {
          const cand = fullOrPartialMatch[3].toLowerCase();
          const chain = this.engine.registry.getChain(cand);
          this.slots.sourceChain = chain ? chain.name : cand;
        }
        if (fullOrPartialMatch[4]) {
          const cand = fullOrPartialMatch[4].toLowerCase();
          const chain = this.engine.registry.getChain(cand);
          this.slots.targetChain = chain ? chain.name : cand;
        }
      }
    }

    // Detect targetChain mentions if not yet set
    if (!this.slots.targetChain) {
      const toChainMatch = text.match(/to\s+([a-zA-Z0-9_-]+)/i);
      if (toChainMatch) {
        const potentialChain = toChainMatch[1].toLowerCase();
        const chainMeta = this.engine.registry.getChain(potentialChain);
        if (!chainMeta || chainMeta.name !== this.slots.sourceChain) {
          this.slots.targetChain = chainMeta ? chainMeta.name : potentialChain;
        }
      } else if (this.slots.sourceChain) {
        // If entire text or word is a known supported chain
        const trimmedWord = text.trim().toLowerCase();
        const chainMeta = this.engine.registry.getChain(trimmedWord);
        if (chainMeta && chainMeta.name !== this.slots.sourceChain) {
          this.slots.targetChain = chainMeta.name;
        }
      }
    }

    // Detect sourceChain mentions if not yet set
    if (!this.slots.sourceChain) {
      const fromChainMatch = text.match(/from\s+([a-zA-Z0-9_-]+)/i);
      if (fromChainMatch) {
        const potentialChain = fromChainMatch[1].toLowerCase();
        const chainMeta = this.engine.registry.getChain(potentialChain);
        if (chainMeta) {
          this.slots.sourceChain = chainMeta.name;
        }
      }
    }

    // Address verification & VM cross-checks
    const targetChainName = this.slots.targetChain?.toLowerCase();
    const targetChainMeta = targetChainName ? this.engine.registry.getChain(targetChainName) : undefined;
    const targetVmType = targetChainMeta?.vmType || (targetChainName === 'stellar' ? 'stellar' : targetChainName === 'xrpl' ? 'xrpl' : 'evm');

    // Check for VM format mismatch
    if (targetVmType === 'stellar' && evmAddrMatch) {
      return `The destination network is Stellar, but an EVM address starting with 0x (${evmAddrMatch[0]}) was provided. Stellar requires a 56-character StrKey starting with 'G'.`;
    }

    if (targetVmType === 'xrpl' && evmAddrMatch) {
      return `The destination network is XRPL, but an EVM address starting with 0x (${evmAddrMatch[0]}) was provided. XRPL requires a classic Base58Check address starting with 'r'.`;
    }

    if (targetVmType === 'evm' && (stellarAddrMatch || xrplAddrMatch)) {
      return `The destination network is EVM (${this.slots.targetChain}), but a non-EVM address was provided. EVM requires a 42-character hex address starting with 0x.`;
    }

    // Assign validated address
    if (targetVmType === 'stellar' && stellarAddrMatch) {
      const check = AddressChecker.validate(stellarAddrMatch[1], 'stellar');
      if (check.isValid) {
        this.slots.targetAddress = check.normalizedAddress;
      }
    } else if (targetVmType === 'xrpl' && xrplAddrMatch) {
      const check = AddressChecker.validate(xrplAddrMatch[1], 'xrpl');
      if (check.isValid) {
        this.slots.targetAddress = check.normalizedAddress;
      }
    } else if (evmAddrMatch) {
      const check = AddressChecker.validate(evmAddrMatch[0], 'evm');
      if (check.isValid) {
        this.slots.targetAddress = evmAddrMatch[0];
      }
    }

    return null;
  }

  private computeMissingSlots(): string[] {
    const missing: string[] = [];
    if (!this.slots.sourceChain) missing.push('sourceChain');
    if (!this.slots.targetChain) missing.push('targetChain');
    if (!this.slots.token) missing.push('token');
    if (!this.slots.amount) missing.push('amount');
    if (!this.slots.targetAddress || this.slots.targetAddress.trim() === '') missing.push('targetAddress');
    return missing;
  }

  private generateClarifyingQuestion(missing: string[]): string {
    if (missing.includes('amount')) {
      return `How much ${this.slots.token || 'tokens'} would you like to bridge?`;
    }
    if (missing.includes('token')) {
      return `Which token would you like to bridge?`;
    }
    if (missing.includes('sourceChain')) {
      return `Which source network would you like to bridge from?`;
    }
    if (missing.includes('targetChain')) {
      const active = this.engine.registry.getSupportedChains().map(c => c.displayName).join(', ');
      return `Which destination network would you like to bridge to? (Supported: ${active || 'Base, Arbitrum, Polygon, Optimism'})`;
    }
    if (missing.includes('targetAddress')) {
      return `Please provide the destination wallet address on ${this.slots.targetChain || 'the target network'}.`;
    }
    return `Please specify additional transfer details.`;
  }
}
