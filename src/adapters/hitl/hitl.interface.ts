import { ExecutionStep } from '../../core/agent/route-planner.js';

export interface AuditPayload {
  intent: string;
  resolvedBy?: string;
  safetyScore: number; // 0 - 100
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  source: {
    chain: string;
    chainId?: number;
    walletAddress: string;
    tokenSymbol: string;
    tokenAddress: string;
    amount: string;
    availableBalance?: string;
  };
  destination: {
    chain: string;
    walletAddress: string;
    tokenSymbol: string;
    tokenAddress: string;
    estimatedOutput: string;
    minGuaranteedOutput: string;
    maxSlippagePercent: number;
    memo?: string;
  };
  bridge: {
    protocol: string;
    poolAddress?: string;
    estimatedBridgeFee: string;
    estimatedGasFee: string;
    estimatedSettlementSec: number;
  };
  simulation: {
    status: 'SUCCESS' | 'REVERT';
    gasUnitsUsed: number;
    astSecurityPassed: boolean;
    invariantsPassed: boolean;
  };
  steps: ExecutionStep[];
  generatedScriptPath: string;
  generatedCodePreview: string;
  warnings: string[];
  requiresPhraseConfirmation: boolean;
  confirmationPhrase?: string;
}

export interface HITLApprovalResponse {
  approved: boolean;
  rejectionReason?: string;
  userModifiedParameters?: Record<string, any>;
}

export interface IHITLHandler {
  requestApproval(payload: AuditPayload): Promise<HITLApprovalResponse>;
}
