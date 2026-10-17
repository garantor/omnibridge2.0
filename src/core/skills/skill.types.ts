export type VmType = 'evm' | 'stellar' | 'xrpl';

export interface TokenMetadata {
  symbol: string;
  name?: string;
  address: string; // Contract address or asset identifier
  decimals: number;
  chain: string;
  issuer?: string; // For Stellar / XRPL
}

export interface ChainMetadata {
  name: string;
  displayName: string;
  vmType: VmType;
  chainId: number;
  nativeToken: {
    symbol: string;
    name: string;
    decimals: number;
  };
  defaultRpc: string;
  blockExplorer: string;
  rpcEnvVar?: string;
  supportedTokens: TokenMetadata[];
}

export interface BridgeSkillMetadata {
  name: string;
  displayName: string;
  version: string;
  type: 'bridge';
  supportedChains: string[];
  supportedTokens: {
    symbol: string;
    decimals: number;
    addresses?: Record<string, string>;
  }[];
  capabilities: string[];
  api?: Record<string, any>;
  requirements?: Record<string, any>;
  contracts?: Record<string, any>;
  markdownRules: string;
}

export interface RouteRecipeHop {
  step: number;
  action: 'approve' | 'swap' | 'bridge' | 'claim';
  chain: string;
  protocol: string;
  details: string;
}

export interface RouteRecipe {
  id: string;
  sourceChain: string;
  targetChain: string;
  tokenSymbol: string;
  recommendedBridge: string;
  hops: RouteRecipeHop[];
  expectedSettlementTimeSec: number;
  notes?: string;
}

export interface AvailableRoute {
  sourceChain: string;
  targetChain: string;
  tokenSymbol: string;
  bridge: string;
  isDirect: boolean;
  estimatedSettlementSec: number;
  recipe?: RouteRecipe;
}
