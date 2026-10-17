import fs from 'node:fs';
import path from 'node:path';
import { ChainMetadata, TokenMetadata, VmType } from '../skills/skill.types.js';

export interface CanonicalToken {
  symbol: string;
  name: string;
  decimals: number;
  addresses: Record<string, string>;
}

export class SeedCatalog {
  private static chains: Map<string, ChainMetadata> = new Map();
  private static tokens: Map<string, CanonicalToken> = new Map();
  private static loaded = false;

  public static init(customConfigDir?: string): void {
    if (this.loaded) return;

    const configDir = customConfigDir || path.resolve(process.cwd(), 'config');
    const chainsPath = path.join(configDir, 'chains.json');
    const tokensPath = path.join(configDir, 'tokens.json');

    // 1. Load Tier 1: Global Chains Registry
    if (fs.existsSync(chainsPath)) {
      try {
        const raw = JSON.parse(fs.readFileSync(chainsPath, 'utf-8'));
        for (const [key, val] of Object.entries(raw as Record<string, any>)) {
          this.chains.set(key.toLowerCase(), {
            name: val.name || key.toLowerCase(),
            displayName: val.displayName || key,
            chainId: val.chainId ?? 0,
            vmType: (val.vmType as VmType) || 'evm',
            nativeToken: val.nativeToken || { symbol: 'GAS', name: 'Native Gas', decimals: 18 },
            defaultRpc: val.defaultRpc || '',
            blockExplorer: val.blockExplorer || '',
            supportedTokens: [],
          });
        }
      } catch (err) {
        // Fallback to built-in defaults
      }
    }

    // Built-in fallback if chains.json is missing
    if (this.chains.size === 0) {
      this.loadDefaultChains();
    }

    // 2. Load Tier 2: Global Multichain Token Registry
    if (fs.existsSync(tokensPath)) {
      try {
        const raw = JSON.parse(fs.readFileSync(tokensPath, 'utf-8'));
        for (const [key, val] of Object.entries(raw as Record<string, any>)) {
          this.tokens.set(key.toUpperCase(), {
            symbol: val.symbol || key.toUpperCase(),
            name: val.name || key,
            decimals: val.decimals ?? 6,
            addresses: val.addresses || {},
          });
        }
      } catch (err) {
        // Fallback to built-in defaults
      }
    }

    // Built-in fallback if tokens.json is missing
    if (this.tokens.size === 0) {
      this.loadDefaultTokens();
    }

    this.loaded = true;
  }

  public static reset(): void {
    this.chains.clear();
    this.tokens.clear();
    this.loaded = false;
  }

  public static isChainSupported(name: string): boolean {
    this.ensureLoaded();
    return this.chains.has(name.toLowerCase());
  }

  public static getChain(name: string): ChainMetadata | undefined {
    this.ensureLoaded();
    const c = this.chains.get(name.toLowerCase());
    return c ? { ...c, supportedTokens: [...c.supportedTokens] } : undefined;
  }

  public static getAllChains(): ChainMetadata[] {
    this.ensureLoaded();
    return Array.from(this.chains.values()).map(c => ({
      ...c,
      supportedTokens: [...c.supportedTokens],
    }));
  }

  public static getToken(symbol: string): CanonicalToken | undefined {
    this.ensureLoaded();
    const t = this.tokens.get(symbol.toUpperCase());
    if (!t) return undefined;
    const activeAddresses: Record<string, string> = {};
    for (const [chain, addr] of Object.entries(t.addresses)) {
      if (this.chains.has(chain.toLowerCase())) {
        activeAddresses[chain.toLowerCase()] = addr;
      }
    }
    return {
      ...t,
      addresses: activeAddresses,
    };
  }

  public static getAllTokens(): CanonicalToken[] {
    this.ensureLoaded();
    return Array.from(this.tokens.values()).map(t => {
      const activeAddresses: Record<string, string> = {};
      for (const [chain, addr] of Object.entries(t.addresses)) {
        if (this.chains.has(chain.toLowerCase())) {
          activeAddresses[chain.toLowerCase()] = addr;
        }
      }
      return {
        ...t,
        addresses: activeAddresses,
      };
    });
  }

  public static resolveTokenForChain(tokenSymbol: string, chainName: string): TokenMetadata | null {
    this.ensureLoaded();
    const chainKey = chainName.toLowerCase();
    // Tier 1 Invariant: Chain MUST be an active configured network
    if (!this.chains.has(chainKey)) return null;

    const token = this.tokens.get(tokenSymbol.toUpperCase());
    if (!token) return null;

    const address = token.addresses[chainKey];
    if (!address) return null;

    return {
      symbol: token.symbol,
      name: token.name,
      address,
      decimals: token.decimals,
      chain: chainKey,
    };
  }

  private static ensureLoaded(): void {
    if (!this.loaded) {
      this.init();
    }
  }

  private static loadDefaultChains(): void {
    const defaults: Record<string, Partial<ChainMetadata>> = {
      polygon: {
        displayName: 'Polygon PoS',
        chainId: 137,
        vmType: 'evm',
        nativeToken: { symbol: 'POL', name: 'Polygon', decimals: 18 },
        defaultRpc: 'https://polygon-rpc.com',
        blockExplorer: 'https://polygonscan.com',
      },
      base: {
        displayName: 'Base',
        chainId: 8453,
        vmType: 'evm',
        nativeToken: { symbol: 'ETH', name: 'Ether', decimals: 18 },
        defaultRpc: 'https://mainnet.base.org',
        blockExplorer: 'https://basescan.org',
      },
      arbitrum: {
        displayName: 'Arbitrum One',
        chainId: 42161,
        vmType: 'evm',
        nativeToken: { symbol: 'ETH', name: 'Ether', decimals: 18 },
        defaultRpc: 'https://arb1.arbitrum.io/rpc',
        blockExplorer: 'https://arbiscan.io',
      },
      stellar: {
        displayName: 'Stellar',
        chainId: 0,
        vmType: 'stellar',
        nativeToken: { symbol: 'XLM', name: 'Lumen', decimals: 7 },
        defaultRpc: 'https://horizon.stellar.org',
        blockExplorer: 'https://stellar.expert/explorer/public',
      },
      xrpl: {
        displayName: 'XRP Ledger',
        chainId: 0,
        vmType: 'xrpl',
        nativeToken: { symbol: 'XRP', name: 'XRP', decimals: 6 },
        defaultRpc: 'https://s1.ripple.com:51234',
        blockExplorer: 'https://livenet.xrpl.org',
      },
    };

    for (const [key, val] of Object.entries(defaults)) {
      this.chains.set(key, {
        name: key,
        displayName: val.displayName || key,
        chainId: val.chainId ?? 0,
        vmType: (val.vmType as VmType) || 'evm',
        nativeToken: val.nativeToken || { symbol: 'GAS', name: 'Native Gas', decimals: 18 },
        defaultRpc: val.defaultRpc || '',
        blockExplorer: val.blockExplorer || '',
        supportedTokens: [],
      });
    }
  }

  private static loadDefaultTokens(): void {
    this.tokens.set('USDC', {
      symbol: 'USDC',
      name: 'USD Coin',
      decimals: 6,
      addresses: {
        polygon: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
        base: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        arbitrum: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
        ethereum: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        optimism: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
        stellar: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
      },
    });
  }
}
