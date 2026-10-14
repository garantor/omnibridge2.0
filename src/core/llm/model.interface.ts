import { z } from 'zod';

export interface ModelMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface StructuredGenerationOptions<T> {
  messages: ModelMessage[];
  schema: z.ZodType<T>;
  schemaName: string;
  temperature?: number;
}

export interface ILanguageModel {
  readonly providerName: string;
  readonly modelId: string;

  /**
   * Generates a strongly typed object validated strictly against a Zod schema
   */
  generateStructured<T>(options: StructuredGenerationOptions<T>): Promise<T>;

  /**
   * Generates clean, raw executable code without conversational fluff or markdown formatting
   */
  generateCode(options: { messages: ModelMessage[]; temperature?: number }): Promise<string>;
}
