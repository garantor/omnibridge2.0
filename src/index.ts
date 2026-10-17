// Core Engine
export { OmnibridgeEngine, type OmnibridgeEngineOptions, type ExecutionResult } from './core/engine.js';

// Skills & Capabilities
export { SkillRegistry } from './core/skills/skill-registry.js';
export { SeedCatalog, type CanonicalToken } from './core/registry/seed-catalog.js';
export type {
  VmType,
  TokenMetadata,
  ChainMetadata,
  BridgeSkillMetadata,
  RouteRecipe,
  RouteRecipeHop,
  AvailableRoute,
} from './core/skills/skill.types.js';

// Agent Modules
export { IntentParser, ParsedIntentSchema, type ParsedIntent } from './core/agent/intent-parser.js';
export { RoutePlanner, type ExecutionPlan, type ExecutionStep } from './core/agent/route-planner.js';
export { ChatSession, type ChatSlots, type ChatResponse } from './core/agent/chat-session.js';

// Synthesis & Simulation
export { CodeSynthesizer, type SynthesizedScript } from './core/synthesizer/code-synthesizer.js';
export { AstSecurityValidator, type AstValidationResult } from './core/synthesizer/ast-validator.js';
export { PreflightSimulator, type SimulationResult } from './core/simulation/preflight-simulator.js';

// Security
export { AddressChecker, type AddressValidationResult } from './core/security/address-checker.js';

// Model-Agnostic LLM
export type { ILanguageModel, ModelMessage, StructuredGenerationOptions } from './core/llm/model.interface.js';
export { createLanguageModel, OpenAICompatibleModel, DeterministicMockModel } from './core/llm/model-provider.js';

// Presentation Adapters
export type { AuditPayload, HITLApprovalResponse, IHITLHandler } from './adapters/hitl/hitl.interface.js';
export { CliHITLHandler } from './adapters/hitl/cli-hitl.js';
export { WebsocketHITLHandler } from './adapters/hitl/ws-hitl.js';
export { OmnibridgeEventEmitter, type OmnibridgeEvent, type OmnibridgeEventType } from './adapters/events/event-emitter.js';
