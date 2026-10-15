import { z } from 'zod';
import { ILanguageModel } from '../llm/model.interface.js';
import { SkillRegistry } from '../skills/skill-registry.js';
import { AddressChecker } from '../security/address-checker.js';

export const ParsedIntentSchema = z.object({
  sourceChain: z.string().describe('Source blockchain network (e.g. polygon, base, arbitrum, stellar, xrpl)'),
  targetChain: z.string().describe('Target/destination blockchain network'),
  token: z.string().describe('Token/coin symbol to transfer (e.g. USDC, ETH, XLM, XRP)'),
  amount: z.union([z.string(), z.number().transform(v => v.toString())]).describe('Exact decimal amount to transfer (e.g. "100", "250.5")'),
  targetAddress: z.string().describe('Destination wallet address on target chain'),
  maxSlippagePercent: z.union([z.number(), z.string().transform(v => parseFloat(v.replace('%', '')))]).default(0.5).describe('Maximum allowable slippage percentage'),
  memo: z.string().optional().describe('Optional memo text or destination tag for Stellar or XRPL'),
  resolvedBy: z.string().optional().describe('Method used to resolve intent (regex, LLM, or mock)'),
});

export type ParsedIntent = z.infer<typeof ParsedIntentSchema>;

export class IntentParser {
  constructor(
    private registry: SkillRegistry,
    private llm: ILanguageModel
  ) { }

  /**
   * Parses natural language intent into structured validated intent
   */
  public async parse(input: string, defaultTargetAddress?: string): Promise<ParsedIntent> {
    const trimmed = input.trim();
    if (!trimmed) {
      throw new Error('Intent string cannot be empty');
    }

    // 1. Try fast-path regex parsing for rapid CLI execution (<1ms)
    const fastParsed = this.tryFastPathRegex(trimmed, defaultTargetAddress);
    if (fastParsed) {
      const normalized = this.validateAndNormalize(fastParsed);
      normalized.resolvedBy = 'Fast-Path Regex (<1ms)';
      return normalized;
    }

    // 2. Use Model-Agnostic LLM for natural language decomposition
    const capabilityContext = this.registry.formatCapabilityContextForLLM();
    const systemPrompt = `You are the Omnibridge Intent Extraction Engine.
Extract the structured cross-chain intent from the user's message.
Return JSON strictly adhering to the schema.

Current System Capabilities:
${capabilityContext}

Rules:
- Standardize chain names to lowercase (e.g. 'Polygon' -> 'polygon', 'Stellar' -> 'stellar', 'Base' -> 'base').
- Extract amount as a clean numeric string (e.g. "500").
- If the user did not specify a destination address, use "${defaultTargetAddress || '0x0000000000000000000000000000000000000000'}".
- Default maxSlippagePercent is 0.5.`;

    try {
      const result = await this.llm.generateStructured<ParsedIntent>({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: trimmed },
        ],
        schema: ParsedIntentSchema,
        schemaName: 'ParsedIntent',
        temperature: 0.0,
      });

      const normalized = this.validateAndNormalize(result);
      if (this.llm.providerName === 'mock') {
        normalized.resolvedBy = 'Offline Mock Fallback (DeterministicMockModel)';
      } else {
        normalized.resolvedBy = `LLM (${this.llm.providerName} / ${this.llm.modelId})`;
      }
      return normalized;
    } catch (err: any) {
      if (err.name === 'ZodError' || Array.isArray(err.issues) || (typeof err.message === 'string' && err.message.includes('invalid_type'))) {
        throw new Error(`Could not extract a cross-chain bridge intent from: "${trimmed}".\nPlease provide an intent like: "Bridge 10 USDC from Base to Arbitrum".`);
      }
      throw err;
    }
  }

  private tryFastPathRegex(text: string, defaultAddress?: string): ParsedIntent | null {
    // Matches patterns like "Bridge 250 USDC from Polygon to Stellar [address]"
    // or "Send 50 USDC from base to arbitrum"
    const match = text.match(/(?:bridge|send|transfer|move)\s+([\d.]+)\s+([a-zA-Z0-9]+)\s+(?:from\s+)?([a-zA-Z0-9_-]+)\s+to\s+([a-zA-Z0-9_-]+)(?:\s+(?:wallet\s+|address\s+)?([a-zA-Z0-9]+))?/i);

    if (!match) return null;

    const amount = match[1];
    const token = match[2].toUpperCase();
    const sourceChain = match[3].toLowerCase();
    const targetChain = match[4].toLowerCase();
    let targetAddress = match[5] || defaultAddress;

    if (!targetAddress) {
      targetAddress = defaultAddress || '0x0000000000000000000000000000000000000000';
    }

    return {
      sourceChain,
      targetChain,
      token,
      amount,
      targetAddress,
      maxSlippagePercent: 0.5,
    };
  }

  private validateAndNormalize(intent: ParsedIntent): ParsedIntent {
    const srcChain = this.registry.getChain(intent.sourceChain);
    if (!srcChain) {
      throw new Error(`Unsupported source chain: "${intent.sourceChain}". Supported chains: [${this.registry.getSupportedChains().map(c => c.name).join(', ')}]`);
    }

    const dstChain = this.registry.getChain(intent.targetChain);
    if (!dstChain) {
      throw new Error(`Unsupported destination chain: "${intent.targetChain}". Supported chains: [${this.registry.getSupportedChains().map(c => c.name).join(', ')}]`);
    }

    // Verify destination address syntax
    const addrValidation = AddressChecker.validate(intent.targetAddress, dstChain.vmType);
    if (!addrValidation.isValid) {
      throw new Error(`Target address validation error on ${dstChain.displayName}: ${addrValidation.error}`);
    }

    return {
      ...intent,
      sourceChain: srcChain.name,
      targetChain: dstChain.name,
      token: intent.token.toUpperCase(),
      targetAddress: addrValidation.normalizedAddress,
    };
  }
}
