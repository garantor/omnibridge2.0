import { ILanguageModel, ModelMessage, StructuredGenerationOptions } from './model.interface.js';

/**
 * Universal OpenAI-compatible adapter (OpenAI, DeepSeek, OpenRouter, Ollama, Groq, etc.)
 */
export class OpenAICompatibleModel implements ILanguageModel {
  readonly providerName: string;
  readonly modelId: string;
  private apiKey: string;
  private baseUrl: string;

  constructor(options: { providerName?: string; modelId?: string; apiKey?: string; baseUrl?: string } = {}) {
    this.providerName = options.providerName || 'universal-llm';
    this.modelId = options.modelId || process.env.LLM_MODEL || 'gpt-4o';
    this.apiKey = options.apiKey || process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY || '';
    
    let base = (options.baseUrl || process.env.LLM_BASE_URL || 'https://api.openai.com/v1').trim();
    // Auto-strip accidental repeated env var name prefix like LLM_BASE_URL=
    if (base.startsWith('LLM_BASE_URL=')) {
      base = base.replace(/^LLM_BASE_URL=/, '').trim();
    }
    // Auto-strip surrounding quotes if present
    base = base.replace(/^["']|["']$/g, '').trim().replace(/\/+$/, '');
    // Auto-normalize if user provided full endpoint instead of base
    if (base.endsWith('/chat/completions')) {
      base = base.replace(/\/chat\/completions$/, '');
    }
    // Auto-normalize Gemini URLs to official OpenAI-compatible endpoint
    if (base.includes('generativelanguage.googleapis.com') && !base.includes('/openai')) {
      base = 'https://generativelanguage.googleapis.com/v1beta/openai';
    }
    this.baseUrl = base;
  }

  async generateStructured<T>(options: StructuredGenerationOptions<T>): Promise<T> {
    const systemPrompt = options.messages.find(m => m.role === 'system')?.content || '';
    const userPrompt = options.messages.filter(m => m.role !== 'system').map(m => `${m.role}: ${m.content}`).join('\n\n');

    const schemaShape = (options.schema as any)?.shape;
    let schemaDescription = '';
    if (schemaShape) {
      const fields: Record<string, string> = {};
      for (const [key, val] of Object.entries(schemaShape)) {
        fields[key] = (val as any)?.description || 'string';
      }
      schemaDescription = JSON.stringify(fields, null, 2);
    } else {
      schemaDescription = JSON.stringify(options.schema);
    }

    const payload = {
      model: this.modelId,
      temperature: options.temperature ?? 0.1,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `${systemPrompt}\n\nYou MUST respond with ONLY a valid JSON object strictly complying with the following schema:\n${schemaDescription}`,
        },
        { role: 'user', content: userPrompt },
      ],
    };

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errText = await res.text();
      let msg = errText;
      try {
        const parsedErr = JSON.parse(errText);
        msg = parsedErr.error?.message || (Array.isArray(parsedErr) && parsedErr[0]?.error?.message) || errText;
      } catch {}
      throw new Error(`LLM API request failed (${res.status}): ${msg}`);
    }

    const json = await res.json() as any;
    const content = json.choices?.[0]?.message?.content || '{}';
    let cleanContent = content.trim();
    if (cleanContent.startsWith('```')) {
      cleanContent = cleanContent.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    }
    let parsed = JSON.parse(cleanContent);
    if (parsed && typeof parsed === 'object') {
      if (parsed.def && typeof parsed.def === 'object') {
        parsed = parsed.def;
      } else if (parsed.intent && typeof parsed.intent === 'object') {
        parsed = parsed.intent;
      }
      for (const key of Object.keys(parsed)) {
        if (parsed[key] === null) {
          delete parsed[key];
        }
      }
    }
    return options.schema.parse(parsed);
  }

  async generateCode(options: { messages: ModelMessage[]; temperature?: number }): Promise<string> {
    const payload = {
      model: this.modelId,
      temperature: options.temperature ?? 0.0,
      messages: options.messages,
    };

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errText = await res.text();
      let msg = errText;
      try {
        const parsedErr = JSON.parse(errText);
        msg = parsedErr.error?.message || (Array.isArray(parsedErr) && parsedErr[0]?.error?.message) || errText;
      } catch {}
      throw new Error(`LLM API request failed (${res.status}): ${msg}`);
    }

    const json = await res.json() as any;
    let code = json.choices?.[0]?.message?.content || '';
    // Strip markdown code fences if model returned them
    code = code.replace(/^```[a-z]*\n/i, '').replace(/\n```$/, '').trim();
    return code;
  }
}

/**
 * Deterministic Mock Provider for offline testing, local dev without keys, and CI/CD
 */
export class DeterministicMockModel implements ILanguageModel {
  readonly providerName = 'mock';
  readonly modelId = 'deterministic-mock';

  async generateStructured<T>(options: StructuredGenerationOptions<T>): Promise<T> {
    const lastUserMsg = options.messages.filter(m => m.role === 'user').pop()?.content || '';
    
    // Heuristic parsing for common test cases
    const amountMatch = lastUserMsg.match(/(\d+(\.\d+)?)/);
    const amount = amountMatch ? amountMatch[1] : '100';

    let sourceChain = 'polygon';
    let targetChain = 'base';
    let token = 'USDC';

    const lower = lastUserMsg.toLowerCase();
    if (lower.includes('base')) {
      if (lower.includes('arbitrum')) {
        sourceChain = 'base';
        targetChain = 'arbitrum';
      } else {
        sourceChain = 'polygon';
        targetChain = 'base';
      }
    } else if (lower.includes('stellar')) {
      sourceChain = 'polygon';
      targetChain = 'stellar';
    } else if (lower.includes('xrpl') || lower.includes('xrp')) {
      sourceChain = 'xrpl';
      targetChain = 'arbitrum';
      token = 'XRP';
    }

    if (options.schemaName === 'LLMRouteDecision') {
      const isMultiHop = lower.includes('multi-hop') || lower.includes('solana to base') || lower.includes('stellar to arbitrum') || (sourceChain === 'stellar' && targetChain === 'arbitrum');
      const mockDecision = {
        reasoning: isMultiHop
          ? `Dynamically routed via intermediate hub polygon connecting bridge skills to complete multi-hop route.`
          : `Selected optimal bridge based on registered protocol skills for ${sourceChain} -> ${targetChain}.`,
        isMultiHop,
        primaryProtocol: isMultiHop ? 'allbridge-core + across-v3' : 'across-v3',
        intermediateChains: isMultiHop ? ['polygon'] : [],
        estimatedSettlementSec: isMultiHop ? 62 : 60,
        estimatedBridgeFeePercent: isMultiHop ? 0.005 : 0.0025,
        steps: isMultiHop
          ? [
              { index: 1, title: 'APPROVE on ' + sourceChain, description: 'Approve bridge contract on ' + sourceChain, chain: sourceChain, protocol: 'allbridge-core', action: 'approve' },
              { index: 2, title: 'BRIDGE to polygon', description: 'Cross-chain transfer to intermediate hub polygon', chain: sourceChain, protocol: 'allbridge-core', action: 'bridge' },
              { index: 3, title: 'APPROVE on polygon', description: 'Approve across-v3 router on polygon', chain: 'polygon', protocol: 'across-v3', action: 'approve' },
              { index: 4, title: 'BRIDGE to ' + targetChain, description: 'Cross-chain transfer from polygon to ' + targetChain, chain: 'polygon', protocol: 'across-v3', action: 'bridge' },
              { index: 5, title: 'CLAIM on ' + targetChain, description: 'Settlement on destination network', chain: targetChain, protocol: 'across-v3', action: 'claim' },
            ]
          : [
              { index: 1, title: `APPROVE on ${sourceChain}`, description: `Approve router contract`, chain: sourceChain, protocol: 'token', action: 'approve' },
              { index: 2, title: `BRIDGE on ${sourceChain}`, description: `Deposit into cross-chain bridge`, chain: sourceChain, protocol: 'across-v3', action: 'bridge' },
              { index: 3, title: `CLAIM on ${targetChain}`, description: `Attestation settlement`, chain: targetChain, protocol: 'across-v3', action: 'claim' },
            ],
        warnings: isMultiHop ? ['Multi-hop transfer: intermediate chain gas required on polygon.'] : [],
      };
      return options.schema.parse(mockDecision);
    }

    // Default mock response conforming to intent schema
    const mockIntent = {
      sourceChain,
      targetChain,
      token,
      amount,
      targetAddress: targetChain === 'stellar' 
        ? 'GAYST7Q6N4YQZ54L76A4L5PGBKHK6T3M5Z3Y7C2M9K2L1P0' 
        : '0x1234567890123456789012345678901234567890',
      maxSlippagePercent: 0.5,
      requiresMemo: false,
    };

    return options.schema.parse(mockIntent);
  }

  async generateCode(options: { messages: ModelMessage[]; temperature?: number }): Promise<string> {
    return `// Auto-generated JIT Execution Script
import { createPublicClient, http } from 'viem';
import { polygon } from 'viem/chains';

export async function executeBridge() {
  console.log('[JIT RUNNER] Starting simulated cross-chain bridge execution...');
  return { status: 'SUCCESS', txHash: '0xmocktxhash123456789' };
}

executeBridge().then(console.log).catch(console.error);
`;
  }
}

export function createLanguageModel(options?: {
  provider?: string;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
}): ILanguageModel {
  const hasKey = !!(options?.apiKey || process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY);
  const provider = options?.provider || process.env.LLM_PROVIDER || (hasKey || options?.model ? 'universal-llm' : 'mock');

  if (provider === 'mock') {
    return new DeterministicMockModel();
  }

  const apiKey = options?.apiKey || process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY || '';
  const baseUrl = options?.baseUrl || process.env.LLM_BASE_URL || 'https://api.openai.com/v1';
  const modelId = options?.model || process.env.LLM_MODEL || 'gpt-4o';

  return new OpenAICompatibleModel({
    providerName: provider,
    modelId,
    apiKey,
    baseUrl,
  });
}
