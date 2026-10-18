import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { AvailableRoute, BridgeSkillMetadata, ChainMetadata, RouteRecipe, TokenMetadata } from './skill.types.js';
import { SeedCatalog } from '../registry/seed-catalog.js';

export class SkillRegistry {
  private chains: Map<string, ChainMetadata> = new Map();
  private bridgeSkills: Map<string, BridgeSkillMetadata> = new Map();
  private swapSkills: Map<string, BridgeSkillMetadata> = new Map();
  private routeRecipes: Map<string, RouteRecipe> = new Map();
  private initialized = false;

  constructor(private skillsRootDir: string = path.resolve(process.cwd(), 'skills')) {
    this.loadSkillsSync();
  }

  /**
   * Synchronously discovers and parses all local SKILL.md files on disk (<2ms)
   */
  private diagnostics: {
    excludedChains: { skill: string; chains: string[] }[];
    excludedTokens: { skill: string; tokens: string[] }[];
  } = { excludedChains: [], excludedTokens: [] };

  public loadSkillsSync(): void {
    this.chains.clear();
    this.bridgeSkills.clear();
    this.swapSkills.clear();
    this.routeRecipes.clear();
    this.diagnostics = { excludedChains: [], excludedTokens: [] };

    // 1. Initialize Tier 1 & Tier 2 Seed Catalog (Strict Gatekeepers)
    SeedCatalog.reset();
    SeedCatalog.init();
    for (const chain of SeedCatalog.getAllChains()) {
      this.chains.set(chain.name.toLowerCase(), chain);
    }

    // 2. Discover and parse skills (Tier 3)
    if (fs.existsSync(this.skillsRootDir)) {
      this.scanDirectorySync(this.skillsRootDir);
      this.buildDynamicRoutes();
    }
    this.initialized = true;
  }

  /**
   * Async alias for compatibility
   */
  public async loadSkills(): Promise<void> {
    this.loadSkillsSync();
  }

  private scanDirectorySync(dir: string): void {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        this.scanDirectorySync(fullPath);
      } else if (entry.isFile() && (entry.name.toLowerCase() === 'skill.md' || entry.name.toLowerCase() === 'skills.md')) {
        this.parseSkillFile(fullPath);
      }
    }
  }

  private parseSkillFile(filePath: string): void {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const parts = content.split(/^---$/m);

      if (parts.length < 3) return; // No YAML frontmatter found

      const frontmatter = YAML.parse(parts[1].trim());
      const markdownRules = parts.slice(2).join('---').trim();

      if (!frontmatter || !frontmatter.name) return;

      const skillName = frontmatter.name.toLowerCase();

      // STRICT INTERSECTION (Tier 1 Authority):
      // Only retain chains that are enabled in Tier 1 (SeedCatalog / config/chains.json)
      const rawSupportedChains: string[] = (frontmatter.supportedChains || []).map((c: any) => 
        (typeof c === 'string' ? c : c.name).toLowerCase()
      );
      const supportedChains = rawSupportedChains.filter(chainName => this.chains.has(chainName));
      const excludedChains = rawSupportedChains.filter(chainName => !this.chains.has(chainName));
      if (excludedChains.length > 0) {
        this.diagnostics.excludedChains.push({ skill: skillName, chains: excludedChains });
      }

      // STRICT INTERSECTION (Tier 2 Authority):
      // Only tokens present in Tier 2 (SeedCatalog / config/tokens.json) and deployed on active enabled chains
      const rawTokens = frontmatter.supportedTokens || [];
      const normalizedTokens: { symbol: string; decimals: number; addresses: Record<string, string> }[] = [];
      const excludedTokens: string[] = [];

      for (const t of rawTokens) {
        const sym = (typeof t === 'string' ? t : t.symbol || '').toUpperCase();
        const canonical = SeedCatalog.getToken(sym);
        if (!canonical) {
          excludedTokens.push(sym);
          continue;
        }

        // Filter addresses to ONLY enabled chains for this skill
        const activeAddresses: Record<string, string> = {};
        for (const chainName of supportedChains) {
          const addr = (typeof t === 'object' && t.addresses?.[chainName]) || canonical.addresses[chainName];
          if (addr) {
            activeAddresses[chainName] = addr;
          }
        }

        const tokenDecimals = typeof t === 'object' && typeof t.decimals === 'number' ? t.decimals : canonical.decimals;
        if (Object.keys(activeAddresses).length > 0) {
          normalizedTokens.push({
            symbol: sym,
            decimals: tokenDecimals,
            addresses: activeAddresses,
          });
        }
      }
      if (excludedTokens.length > 0) {
        this.diagnostics.excludedTokens.push({ skill: skillName, tokens: excludedTokens });
      }

      const skillType = (frontmatter.type === 'swap') ? 'swap' : 'bridge';

      const skillMeta: BridgeSkillMetadata = {
        name: skillName,
        displayName: frontmatter.displayName || skillName,
        version: frontmatter.version || '1.0.0',
        type: skillType,
        supportedChains,
        supportedTokens: normalizedTokens,
        capabilities: frontmatter.capabilities || [],
        api: frontmatter.api || {},
        requirements: frontmatter.requirements || {},
        contracts: frontmatter.contracts || {},
        markdownRules,
      };

      // DEX Swaps (e.g. Uniswap, Jupiter) are same-chain primitives, NOT cross-chain bridges
      if (skillType === 'swap') {
        this.swapSkills.set(skillName, skillMeta);
        return;
      }

      // Register cross-chain protocol skill
      this.bridgeSkills.set(skillName, skillMeta);

      // Metadata enrichment: Merge overrides for active chains (never create phantom chains)
      for (const rawChain of (frontmatter.supportedChains || [])) {
        const isObj = typeof rawChain === 'object' && rawChain !== null;
        if (!isObj) continue;
        const chainName = rawChain.name.toLowerCase();
        const chain = this.chains.get(chainName);
        if (chain) {
          if (rawChain.displayName) chain.displayName = rawChain.displayName;
          if (rawChain.vmType) chain.vmType = rawChain.vmType;
          if (rawChain.chainId !== undefined) chain.chainId = rawChain.chainId;
          if (rawChain.nativeToken) chain.nativeToken = rawChain.nativeToken;
          if (rawChain.rpcUrl || rawChain.defaultRpc) chain.defaultRpc = rawChain.rpcUrl || rawChain.defaultRpc;
          if (rawChain.blockExplorer) chain.blockExplorer = rawChain.blockExplorer;
        }
      }

      // Register tokens defined or referenced in this bridge skill for each supported chain
      for (const chainName of supportedChains) {
        const chain = this.chains.get(chainName);
        if (!chain) continue;

        for (const token of normalizedTokens) {
          const tokenAddr = token.addresses[chainName];
          if (!tokenAddr) continue;

          const exists = chain.supportedTokens.some(t => t.symbol.toUpperCase() === token.symbol.toUpperCase());
          if (!exists) {
            chain.supportedTokens.push({
              symbol: token.symbol.toUpperCase(),
              name: SeedCatalog.getToken(token.symbol)?.name || token.symbol,
              address: tokenAddr,
              decimals: token.decimals,
              chain: chainName,
            });
          }
        }
      }
    } catch (err: any) {
      console.warn(`⚠️ [SkillRegistry] Failed to parse skill file ${filePath}: ${err?.message || err}`);
    }
  }

  private buildDynamicRoutes(): void {
    for (const bridge of this.bridgeSkills.values()) {
      for (const src of bridge.supportedChains) {
        if (!this.chains.has(src)) continue;
        for (const dst of bridge.supportedChains) {
          if (src === dst) continue;
          if (!this.chains.has(dst)) continue;
          for (const token of bridge.supportedTokens) {
            const srcAddr = token.addresses?.[src];
            const dstAddr = token.addresses?.[dst];
            if (!srcAddr || !dstAddr) continue;

            const recipeId = `${src}-to-${dst}-${token.symbol.toLowerCase()}`;
            if (!this.routeRecipes.has(recipeId)) {
              this.routeRecipes.set(recipeId, {
                id: recipeId,
                sourceChain: src,
                targetChain: dst,
                tokenSymbol: token.symbol.toUpperCase(),
                recommendedBridge: bridge.name,
                expectedSettlementTimeSec: 60,
                hops: [
                  { step: 1, action: 'approve', chain: src, protocol: 'token', details: `Approve ${bridge.displayName}` },
                  { step: 2, action: 'bridge', chain: src, protocol: bridge.name, details: `Execute cross-chain transfer to ${dst}` },
                  { step: 3, action: 'claim', chain: dst, protocol: bridge.name, details: `Receive/claim funds on ${dst}` },
                ],
              });
            }
          }
        }
      }
    }
  }

  public getDiagnostics(): {
    excludedChains: { skill: string; chains: string[] }[];
    excludedTokens: { skill: string; tokens: string[] }[];
  } {
    return this.diagnostics;
  }

  public getSupportedChains(): ChainMetadata[] {
    return Array.from(this.chains.values());
  }

  public getChain(name: string): ChainMetadata | undefined {
    return this.chains.get(name.toLowerCase());
  }

  public getSupportedTokens(chainName?: string): TokenMetadata[] {
    if (chainName) {
      const chain = this.chains.get(chainName.toLowerCase());
      return chain ? chain.supportedTokens : [];
    }
    const allTokens: TokenMetadata[] = [];
    for (const chain of this.chains.values()) {
      allTokens.push(...chain.supportedTokens);
    }
    return allTokens;
  }

  public getAvailableRoutes(sourceChain?: string, targetChain?: string, tokenSymbol?: string): AvailableRoute[] {
    const routes: AvailableRoute[] = [];
    const src = sourceChain?.toLowerCase();
    const dst = targetChain?.toLowerCase();
    const sym = tokenSymbol?.toUpperCase();

    for (const recipe of this.routeRecipes.values()) {
      if (src && recipe.sourceChain !== src) continue;
      if (dst && recipe.targetChain !== dst) continue;
      if (sym && recipe.tokenSymbol !== sym) continue;

      // Ensure the bridge protocol skill is actively installed
      if (!this.bridgeSkills.has(recipe.recommendedBridge.toLowerCase())) {
        continue;
      }

      routes.push({
        sourceChain: recipe.sourceChain,
        targetChain: recipe.targetChain,
        tokenSymbol: recipe.tokenSymbol,
        bridge: recipe.recommendedBridge,
        isDirect: true,
        estimatedSettlementSec: recipe.expectedSettlementTimeSec,
        recipe,
      });
    }
    return routes;
  }

  public getRecommendedRecipe(sourceChain: string, targetChain: string, tokenSymbol: string): RouteRecipe | null {
    const src = sourceChain.toLowerCase();
    const dst = targetChain.toLowerCase();
    const sym = tokenSymbol.toUpperCase();

    const directKey = `${src}-to-${dst}-${sym.toLowerCase()}`;
    if (this.routeRecipes.has(directKey)) {
      const recipe = this.routeRecipes.get(directKey)!;
      if (this.bridgeSkills.has(recipe.recommendedBridge.toLowerCase())) {
        return recipe;
      }
    }

    for (const recipe of this.routeRecipes.values()) {
      if (recipe.sourceChain === src && recipe.targetChain === dst && recipe.tokenSymbol === sym) {
        if (this.bridgeSkills.has(recipe.recommendedBridge.toLowerCase())) {
          return recipe;
        }
      }
    }
    return null;
  }

  public getBridgeSkill(name: string): BridgeSkillMetadata | undefined {
    return this.bridgeSkills.get(name.toLowerCase());
  }

  public getAllBridgeSkills(): BridgeSkillMetadata[] {
    return Array.from(this.bridgeSkills.values());
  }

  public getSwapSkill(name: string): BridgeSkillMetadata | undefined {
    return this.swapSkills.get(name.toLowerCase());
  }

  public getAllSwapSkills(): BridgeSkillMetadata[] {
    return Array.from(this.swapSkills.values());
  }

  public findMultiHopPath(sourceChain: string, targetChain: string, tokenSymbol: string): {
    intermediateChain: string;
    leg1Bridge: BridgeSkillMetadata;
    leg2Bridge: BridgeSkillMetadata;
    estimatedSettlementSec: number;
    estimatedBridgeFeePercent: number;
  } | null {
    const src = sourceChain.toLowerCase();
    const dst = targetChain.toLowerCase();
    const sym = tokenSymbol.toUpperCase();

    // Check all active chains as potential intermediate hubs
    for (const chain of this.chains.values()) {
      const hub = chain.name.toLowerCase();
      if (hub === src || hub === dst) continue;

      // Leg 1: bridge from src -> hub for sym
      const leg1Bridges = Array.from(this.bridgeSkills.values()).filter(b =>
        b.supportedChains.includes(src) &&
        b.supportedChains.includes(hub) &&
        b.supportedTokens.some(t => t.symbol.toUpperCase() === sym)
      );
      if (leg1Bridges.length === 0) continue;

      // Leg 2: bridge from hub -> dst for sym
      const leg2Bridges = Array.from(this.bridgeSkills.values()).filter(b =>
        b.supportedChains.includes(hub) &&
        b.supportedChains.includes(dst) &&
        b.supportedTokens.some(t => t.symbol.toUpperCase() === sym)
      );
      if (leg2Bridges.length === 0) continue;

      const leg1Bridge = leg1Bridges[0];
      const leg2Bridge = leg2Bridges[0];

      return {
        intermediateChain: hub,
        leg1Bridge,
        leg2Bridge,
        estimatedSettlementSec: 90,
        estimatedBridgeFeePercent: 0.005,
      };
    }

    return null;
  }

  public formatCapabilityContextForLLM(): string {
    const chainsSummary = this.getSupportedChains()
      .map(c => `- ${c.displayName} (${c.name}, VM: ${c.vmType}, Native: ${c.nativeToken.symbol}, Tokens: [${c.supportedTokens.map(t => t.symbol).join(', ')}])`)
      .join('\n');

    const bridgesSummary = this.getAllBridgeSkills()
      .map(b => `- ${b.displayName} (${b.name}): Connects [${b.supportedChains.join(', ')}], Tokens: [${b.supportedTokens.map(t => t.symbol).join(', ')}], Capabilities: [${b.capabilities.join(', ')}]`)
      .join('\n');

    const recipesSummary = Array.from(this.routeRecipes.values())
      .filter(r => this.bridgeSkills.has(r.recommendedBridge.toLowerCase()))
      .map(r => `  * ${r.sourceChain} -> ${r.targetChain} (${r.tokenSymbol}) via ${r.recommendedBridge} (~${r.expectedSettlementTimeSec}s)`)
      .join('\n');

    return `### SUPPORTED NETWORKS:\n${chainsSummary}\n\n### BRIDGES & PROTOCOLS:\n${bridgesSummary}\n\n### FAST PATH ROUTE RECIPES:\n${recipesSummary}`;
  }
}
