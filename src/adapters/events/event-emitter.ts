import { EventEmitter } from 'node:events';

export type OmnibridgeEventType =
  | 'intent:parsed'
  | 'route:planned'
  | 'script:synthesized'
  | 'simulation:complete'
  | 'hitl:requested'
  | 'hitl:approved'
  | 'hitl:rejected'
  | 'execution:step'
  | 'execution:complete'
  | 'execution:error';

export interface OmnibridgeEvent<T = any> {
  type: OmnibridgeEventType;
  timestamp: number;
  data: T;
}

export class OmnibridgeEventEmitter extends EventEmitter {
  public emitEvent<T>(type: OmnibridgeEventType, data: T): void {
    const event: OmnibridgeEvent<T> = {
      type,
      timestamp: Date.now(),
      data,
    };
    this.emit(type, event);
    this.emit('*', event);
  }
}
