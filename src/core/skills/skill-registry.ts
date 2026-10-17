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
  public loadSkillsSync(): void {
    this.chains.clear();
    this.bridgeSkills.clear();
    this.swapSkills.clear();
    this.routeRecipes.clear();

    // 1. Initialize Tier 1 & Tier 2 Seed Catalog
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
      const supportedChains: string[] = (frontmatter.supportedChains || []).map((c: any) => 
        (typeof c === 'string' ? c : c.name).toLowerCase()
      );

      // Normalize tokens supporting both simple string symbols (['USDC']) and rich objects
      const normalizedTokens = (frontmatter.supportedTokens || []).map((t: any) => {
        if (typeof t === 'string') {
          const canonical = SeedCatalog.getToken(t);
          return {
            symbol: t.toUpperCase(),
            decimals: canonical?.decimals ?? 6,
            addresses: canonical?.addresses || {},
          };
        }
        const sym = (t.symbol || '').toUpperCase();
        const canonical = SeedCatalog.getToken(sym);
        return {
          symbol: sym,
          decimals: t.decimals ?? canonical?.decimals ?? 6,
          addresses: t.addresses || canonical?.addresses || {},
        };
      });

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

      // Automatically discover and register/merge all chains mentioned in this skill
      for (const rawChain of (frontmatter.supportedChains || [])) {
        const isObj = typeof rawChain === 'object' && rawChain !== null;
        const chainName = (isObj ? rawChain.name : rawChain).toLowerCase();
        let chain = this.chains.get(chainName);

        if (!chain) {
          const canonical = SeedCatalog.getChain(chainName);
          chain = canonical || {
            name: chainName,
            displayName: (isObj && rawChain.displayName) || chainName.charAt(0).toUpperCase() + chainName.slice(1),
            vmType: (isObj && rawChain.vmType) || 'evm',
            chainId: (isObj && rawChain.chainId !== undefined) ? rawChain.chainId : 0,
            nativeToken: (isObj && rawChain.nativeToken) || { symbol: 'GAS', name: `${chainName.toUpperCase()} Native Gas`, decimals: 18 },
            defaultRpc: (isObj && (rawChain.rpcUrl || rawChain.defaultRpc)) || '',
            blockExplorer: (isObj && rawChain.blockExplorer) || '',
            supportedTokens: [],
          };
          this.chains.set(chainName, chain);
        } else if (isObj) {
          // Merge metadata if overrides provided
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
          const resolved = SeedCatalog.resolveTokenForChain(token.symbol, chainName);
          const isNative = chain.nativeToken?.symbol?.toUpperCase() === token.symbol.toUpperCase();
          const tokenAddr = token.addresses?.[chainName] || resolved?.address || (isNative ? 'native' : undefined);
          if (!tokenAddr) continue; // Skip token if it is not deployed or supported on this chain

          const exists = chain.supportedTokens.some(t => t.symbol.toUpperCase() === token.symbol.toUpperCase());
          if (!exists) {
            chain.supportedTokens.push({
              symbol: token.symbol.toUpperCase(),
              name: resolved?.name || token.symbol,
              address: tokenAddr,
              decimals: token.decimals ?? resolved?.decimals ?? 6,
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
        for (const dst of bridge.supportedChains) {
          if (src === dst) continue;
          for (const token of bridge.supportedTokens) {
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

  public formatCapabilityContextForLLM(): string {
    const chainsSummary = this.getSupportedChains()
      .map(c => `- ${c.displayName} (${c.name}, VM: ${c.vmType}, Native: ${c.nativeToken.symbol}, Tokens: [${c.supportedTokens.map(t => t.symbol).join(', ')}])`)
      .join('\n');

    const bridgesSummary = this.getAllBridgeSkills()
      .map(b => `- ${b.displayName} (${b.name}): Connects [${b.supportedChains.join(', ')}], Tokens: [${b.supportedTokens.map(t => t.symbol).join(', ')}]`)
      .join('\n');

    const recipesSummary = Array.from(this.routeRecipes.values())
      .filter(r => this.bridgeSkills.has(r.recommendedBridge.toLowerCase()))
      .map(r => `  * ${r.sourceChain} -> ${r.targetChain} (${r.tokenSymbol}) via ${r.recommendedBridge} (~${r.expectedSettlementTimeSec}s)`)
      .join('\n');

    return `### SUPPORTED NETWORKS:\n${chainsSummary}\n\n### BRIDGES:\n${bridgesSummary}\n\n### FAST PATH ROUTE RECIPES:\n${recipesSummary}`;
  }
}
