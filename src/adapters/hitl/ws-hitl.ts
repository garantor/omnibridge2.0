import { AuditPayload, HITLApprovalResponse, IHITLHandler } from './hitl.interface.js';

export type AuditRequestListener = (auditId: string, payload: AuditPayload) => void;

export class WebsocketHITLHandler implements IHITLHandler {
  private pendingResolvers = new Map<string, (resp: HITLApprovalResponse) => void>();
  private listeners: AuditRequestListener[] = [];

  public onAuditRequest(listener: AuditRequestListener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  public async requestApproval(payload: AuditPayload): Promise<HITLApprovalResponse> {
    const auditId = `audit-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

    return new Promise<HITLApprovalResponse>((resolve) => {
      this.pendingResolvers.set(auditId, resolve);

      // Notify external WebSocket / Web UI subscribers
      for (const listener of this.listeners) {
        listener(auditId, payload);
      }
    });
  }

  /**
   * Called by Web UI / WebSocket gateway when user signs or clicks Approve in UI modal
   */
  public resolveApproval(auditId: string, approved: boolean, rejectionReason?: string): boolean {
    const resolver = this.pendingResolvers.get(auditId);
    if (!resolver) return false;

    this.pendingResolvers.delete(auditId);
    resolver({ approved, rejectionReason });
    return true;
  }
}
