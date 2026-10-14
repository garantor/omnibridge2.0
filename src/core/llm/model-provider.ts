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
    this.providerName = options.providerName || 'openai-compatible';
    this.modelId = options.modelId || process.env.LLM_MODEL || 'gpt-4o';
    this.apiKey = options.apiKey || process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || '';
    this.baseUrl = (options.baseUrl || process.env.LLM_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
  }

  async generateStructured<T>(options: StructuredGenerationOptions<T>): Promise<T> {
    const systemPrompt = options.messages.find(m => m.role === 'system')?.content || '';
    const userPrompt = options.messages.filter(m => m.role !== 'system').map(m => `${m.role}: ${m.content}`).join('\n\n');

    const schemaDescription = JSON.stringify(options.schema);

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
      throw new Error(`LLM API request failed (${res.status}): ${errText}`);
    }

    const json = await res.json() as any;
    const content = json.choices?.[0]?.message?.content || '{}';
    const parsed = JSON.parse(content);
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
      throw new Error(`LLM API request failed (${res.status}): ${errText}`);
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
    let targetChain = 'stellar';
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
  const provider = options?.provider || process.env.LLM_PROVIDER || (process.env.OPENAI_API_KEY ? 'openai-compatible' : 'mock');

  if (provider === 'mock') {
    return new DeterministicMockModel();
  }

  return new OpenAICompatibleModel({
    providerName: provider,
    modelId: options?.model,
    apiKey: options?.apiKey,
    baseUrl: options?.baseUrl,
  });
}
