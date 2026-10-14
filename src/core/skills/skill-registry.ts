import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { AvailableRoute, BridgeSkillMetadata, ChainMetadata, RouteRecipe, TokenMetadata } from './skill.types.js';

export class SkillRegistry {
  private chains: Map<string, ChainMetadata> = new Map();
  private bridgeSkills: Map<string, BridgeSkillMetadata> = new Map();
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
    this.routeRecipes.clear();

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

      if (frontmatter.type === 'chain') {
        const chainName = frontmatter.name.toLowerCase();
        const existing = this.chains.get(chainName) || {
          name: chainName,
          displayName: frontmatter.displayName || chainName,
          vmType: frontmatter.vmType || 'evm',
          chainId: frontmatter.chainId ?? 0,
          nativeToken: frontmatter.nativeToken || { symbol: 'ETH', name: 'Ether', decimals: 18 },
          defaultRpc: frontmatter.defaultRpc || '',
          blockExplorer: frontmatter.blockExplorer || '',
          rpcEnvVar: frontmatter.rpcEnvVar,
          supportedTokens: [] as TokenMetadata[],
        };

        if (Array.isArray(frontmatter.supportedTokens)) {
          for (const token of frontmatter.supportedTokens) {
            const tokenMeta: TokenMetadata = {
              symbol: token.symbol,
              name: token.name,
              address: token.address || 'native',
              decimals: token.decimals ?? 18,
              chain: chainName,
              issuer: token.issuer,
            };
            const idx = existing.supportedTokens.findIndex(t => t.symbol.toUpperCase() === token.symbol.toUpperCase());
            if (idx >= 0) existing.supportedTokens[idx] = tokenMeta;
            else existing.supportedTokens.push(tokenMeta);
          }
        }
        this.chains.set(chainName, existing);
      } else if (frontmatter.type === 'bridge') {
        const bridgeName = frontmatter.name.toLowerCase();
        this.bridgeSkills.set(bridgeName, {
          name: bridgeName,
          displayName: frontmatter.displayName || bridgeName,
          version: frontmatter.version || '1.0.0',
          type: 'bridge',
          supportedChains: (frontmatter.supportedChains || []).map((c: string) => c.toLowerCase()),
          supportedTokens: frontmatter.supportedTokens || [],
          capabilities: frontmatter.capabilities || [],
          contracts: frontmatter.contracts || {},
          markdownRules,
        });
      }
    } catch (err) {
      // Graceful parsing skip
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
