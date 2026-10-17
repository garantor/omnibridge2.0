import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  OmnibridgeEngine,
  SkillRegistry,
  AddressChecker,
  IntentParser,
  RoutePlanner,
  AstSecurityValidator,
  DeterministicMockModel,
} from '../src/index.js';
import { LiveExecutor } from '../src/core/execution/live-executor.js';

// ============================================================================
// MASTER TDD EVALUATION HARNESS: COMPLETE EDGE CASES & ACTIVE CODEBASE AUDIT
// ============================================================================

async function runEvaluationSuite() {
  console.log('================================================================================');
  console.log('   OMNIBRIDGE 2.0 TDD EVALUATION HARNESS: ALL SCENARIOS & EDGE CASES');
  console.log('================================================================================\n');

  let passed = 0;
  let failed = 0;
  const failureDetails: string[] = [];

  async function runCase(name: string, fn: () => void | Promise<void>) {
    try {
      await fn();
      console.log(`  ✔ [PASS] ${name}`);
      passed++;
    } catch (err: any) {
      console.error(`  ✖ [FAIL] ${name}\n     ${err.message}`);
      failed++;
      failureDetails.push(`${name} -> ${err.message}`);
    }
  }

  // --------------------------------------------------------------------------
  // SUITE 1: DEEP ZERO-HARDCODING SOURCE AUDIT (Entire src/core/ tree)
  // --------------------------------------------------------------------------
  console.log('📋 Suite 1: Deep Zero-Hardcoding Source Audit (Entire src/core/)');

  await runCase('1.1: Entire src/core/ tree must contain zero hardcoded protocol conditionals or dispatchers', () => {
    const srcCoreDir = path.resolve(process.cwd(), 'src', 'core');
    const violations: string[] = [];

    function scanFile(filePath: string) {
      const relativePath = path.relative(process.cwd(), filePath);
      const code = fs.readFileSync(filePath, 'utf-8');
      const lines = code.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Match protocol-specific branching: if (protocol === 'across-v3') or switch(protocol) { case 'across': ... }
        if (
          /if\s*\(\s*.*(?:bridgeProtocol|protocol)\s*===?\s*['"](across|across-v3|lifi|stargate|cctp|allbridge)/i.test(line) ||
          /case\s*['"](across|across-v3|lifi|stargate|cctp|allbridge)['"]\s*:/i.test(line)
        ) {
          violations.push(`${relativePath}:${i + 1} -> "${line.trim()}"`);
        }
      }
    }

    function scanDir(dir: string) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) scanDir(full);
        else if (e.name.endsWith('.ts')) scanFile(full);
      }
    }

    scanDir(srcCoreDir);

    assert.equal(
      violations.length,
      0,
      `Core engine MUST be 100% protocol-agnostic. Found ${violations.length} hardcoded check(s) in src/core/:\n${violations.map(v => '       - ' + v).join('\n')}`
    );
  });

  // --------------------------------------------------------------------------
  // SUITE 2: CONVERSATIONAL AGENT & MULTI-TURN EDGE CASES (Active Engine)
  // --------------------------------------------------------------------------
  console.log('\n📋 Suite 2: Conversational Dialogue & Multi-Turn Edge Cases');

  await runCase('2.1: Out-of-scope query handled gracefully without throwing Zod errors', async () => {
    const mockModel = new DeterministicMockModel();
    const engine = new OmnibridgeEngine({ llm: mockModel });
    await engine.init();

    assert(
      typeof (engine as any).chat === 'function' || typeof (engine as any).createChatSession === 'function',
      'Engine must expose conversational interface (.chat or .createChatSession)'
    );

    const reply = await (engine as any).chat('What is the weather in Paris today?');
    assert.equal(reply.scope, 'OUT_OF_SCOPE');
    assert(reply.message.toLowerCase().includes('cross-chain') || reply.message.toLowerCase().includes('bridge'));
  });

  await runCase('2.2: Partial intent must NOT inject dummy 0x000 address; must request destination address', async () => {
    const mockModel = new DeterministicMockModel();
    const engine = new OmnibridgeEngine({ llm: mockModel });
    await engine.init();

    if (typeof (engine as any).chat === 'function') {
      const reply = await (engine as any).chat('Bridge 100 USDC from Base to Arbitrum');
      assert.equal(reply.isComplete, false, 'Intent without target address must be marked incomplete');
      assert(reply.missingSlots.includes('targetAddress'), 'Must require targetAddress slot');
      assert(!reply.targetAddress || reply.targetAddress === '', 'Must NOT inject synthetic 0x000 address');
    } else {
      const parser = new IntentParser(engine.registry, mockModel);
      const parsed = await parser.parse('Bridge 100 USDC from Base to Arbitrum');
      assert.notEqual(
        parsed.targetAddress,
        '0x0000000000000000000000000000000000000000',
        'IntentParser currently silently injects 0x0000000000000000000000000000000000000000. It must request address.'
      );
    }
  });

  await runCase('2.3: Multi-turn conversation retains prior slots across turns', async () => {
    const mockModel = new DeterministicMockModel();
    const engine = new OmnibridgeEngine({ llm: mockModel });
    await engine.init();

    assert(
      typeof (engine as any).createChatSession === 'function',
      'Engine must provide .createChatSession() for stateful multi-turn interactions'
    );

    const session = (engine as any).createChatSession();
    const turn1 = await session.sendMessage('Bridge 100 USDC from Base to Arbitrum');
    assert.equal(turn1.slots.sourceChain, 'base');
    assert.equal(turn1.slots.targetChain, 'arbitrum');
    assert.equal(turn1.slots.amount, '100');
    assert.equal(turn1.isComplete, false);

    const turn2 = await session.sendMessage('to 0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359');
    assert.equal(turn2.isComplete, true);
    assert.equal(turn2.slots.sourceChain, 'base', 'Turn 2 must retain sourceChain from Turn 1');
    assert.equal(turn2.slots.targetAddress, '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359');
  });

  await runCase('2.4: Mid-dialogue slot correction updates slot without corrupting prior slots', async () => {
    const mockModel = new DeterministicMockModel();
    const engine = new OmnibridgeEngine({ llm: mockModel });
    await engine.init();

    assert(typeof (engine as any).createChatSession === 'function', 'Chat session interface required');
    const session = (engine as any).createChatSession();

    await session.sendMessage('Bridge 100 USDC from Base to Arbitrum');
    // User corrects amount mid-dialogue
    const turn2 = await session.sendMessage('Actually, make that 250 USDC instead');
    assert.equal(turn2.slots.amount, '250', 'Amount must be updated to 250');
    assert.equal(turn2.slots.sourceChain, 'base', 'sourceChain must be preserved');
    assert.equal(turn2.slots.targetChain, 'arbitrum', 'targetChain must be preserved');
    assert.equal(turn2.slots.token, 'USDC', 'token must be preserved');
  });

  await runCase('2.5: Dialogue cancellation cleanly resets session state', async () => {
    const mockModel = new DeterministicMockModel();
    const engine = new OmnibridgeEngine({ llm: mockModel });
    await engine.init();

    assert(typeof (engine as any).createChatSession === 'function', 'Chat session interface required');
    const session = (engine as any).createChatSession();

    await session.sendMessage('Bridge 500 USDC from Polygon');
    const cancelReply = await session.sendMessage('Cancel that, start over');
    assert.equal(cancelReply.isReset, true, 'Cancellation should reset state');
    assert.deepEqual(session.getSlots(), {}, 'Slots must be cleared on cancellation');
  });

  await runCase('2.6: Chain vs Token ambiguity resolution (Ethereum network vs ETH token)', async () => {
    const mockModel = new DeterministicMockModel();
    const engine = new OmnibridgeEngine({ llm: mockModel });
    await engine.init();

    assert(typeof (engine as any).createChatSession === 'function', 'Chat session interface required');
    const session = (engine as any).createChatSession();

    // "Send ETH to Arbitrum" -> token is ETH, targetChain is arbitrum
    const reply = await session.sendMessage('Send 1 ETH to Arbitrum');
    assert.equal(reply.slots.token, 'ETH');
    assert.equal(reply.slots.targetChain, 'arbitrum');
  });

  await runCase('2.7: Cross-VM address mismatch caught in conversational context', async () => {
    const mockModel = new DeterministicMockModel();
    const engine = new OmnibridgeEngine({ llm: mockModel });
    await engine.init();

    assert(typeof (engine as any).createChatSession === 'function', 'Chat session interface required');
    const session = (engine as any).createChatSession();

    // Target chain is Stellar, but user provides an EVM hex address
    const reply = await session.sendMessage('Bridge 50 USDC from Polygon to Stellar wallet 0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359');
    assert.equal(reply.isComplete, false);
    assert(
      reply.message.toLowerCase().includes('stellar') && reply.message.toLowerCase().includes('0x'),
      'Must explain VM address format mismatch (EVM address on Stellar)'
    );
  });

  await runCase('2.8: Stellar/XRPL custodial exchange memo / destination tag capture & warning', async () => {
    const mockModel = new DeterministicMockModel();
    const engine = new OmnibridgeEngine({ llm: mockModel });
    await engine.init();

    assert(typeof (engine as any).createChatSession === 'function', 'Chat session interface required');
    const session = (engine as any).createChatSession();

    // Case A: Memo is provided
    const withMemo = await session.sendMessage('Send 50 USDC to Stellar GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN with memo 987654');
    assert.equal(withMemo.slots.memo, '987654');

    // Case B: No memo provided for Stellar -> Engine must include a warning in plan/response
    const noMemo = await session.sendMessage('Send 50 USDC from Base to Stellar GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN');
    assert(noMemo.warnings && noMemo.warnings.some((w: string) => w.toLowerCase().includes('memo')), 'Must include custodial memo advisory');
  });

  // --------------------------------------------------------------------------
  // SUITE 3: FINANCIAL & NUMERIC VALIDATION EDGE CASES
  // --------------------------------------------------------------------------
  console.log('\n📋 Suite 3: Financial & Numeric Validation Edge Cases');

  await runCase('3.1: Negative transfer amount rejected', () => {
    const registry = new SkillRegistry();
    const planner = new RoutePlanner(registry);

    assert.throws(() => {
      planner.plan({
        sourceChain: 'polygon',
        targetChain: 'arbitrum',
        token: 'USDC',
        amount: '-50',
        targetAddress: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
        maxSlippagePercent: 0.5,
      });
    }, /amount must be greater than zero|positive|invalid amount/i);
  });

  await runCase('3.2: Zero transfer amount rejected', () => {
    const registry = new SkillRegistry();
    const planner = new RoutePlanner(registry);

    assert.throws(() => {
      planner.plan({
        sourceChain: 'polygon',
        targetChain: 'arbitrum',
        token: 'USDC',
        amount: '0',
        targetAddress: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
        maxSlippagePercent: 0.5,
      });
    }, /amount must be greater than zero|positive|invalid amount/i);
  });

  await runCase('3.3: Extreme or negative slippage percentages rejected', () => {
    const registry = new SkillRegistry();
    const planner = new RoutePlanner(registry);

    // Negative slippage
    assert.throws(() => {
      planner.plan({
        sourceChain: 'polygon',
        targetChain: 'arbitrum',
        token: 'USDC',
        amount: '100',
        targetAddress: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
        maxSlippagePercent: -0.5,
      });
    }, /slippage/i);

    // Extreme slippage (50%)
    assert.throws(() => {
      planner.plan({
        sourceChain: 'polygon',
        targetChain: 'arbitrum',
        token: 'USDC',
        amount: '100',
        targetAddress: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
        maxSlippagePercent: 50.0,
      });
    }, /slippage/i);
  });

  await runCase('3.4: Guaranteed minimum output strictly respects slippage bounds', async () => {
    const registry = new SkillRegistry();
    await registry.loadSkills();
    const planner = new RoutePlanner(registry);
    const plan = planner.plan({
      sourceChain: 'polygon',
      targetChain: 'arbitrum',
      token: 'USDC',
      amount: '1000',
      targetAddress: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
      maxSlippagePercent: 1.0, // 1%
    });

    const estOut = parseFloat(plan.amounts.estimatedOutput);
    const minOut = parseFloat(plan.amounts.minGuaranteedOutput);
    assert(estOut > 0, 'Estimated output must be positive');
    assert(minOut > 0, 'Min output must be positive');
    assert(minOut < estOut, 'Min guaranteed output must be less than estimated output by slippage margin');

    const expectedMin = estOut * 0.99;
    assert(Math.abs(minOut - expectedMin) < 0.01, `Min out ${minOut} did not match expected slippage math ${expectedMin}`);
  });

  // --------------------------------------------------------------------------
  // SUITE 4: DYNAMIC SKILL DISCOVERY & ROUTING EDGE CASES
  // --------------------------------------------------------------------------
  console.log('\n📋 Suite 4: Dynamic Skill Discovery & Routing Edge Cases');

  await runCase('4.1: Unsupported route returns clear actionable error listing installed skills', async () => {
    const registry = new SkillRegistry();
    await registry.loadSkills();
    const planner = new RoutePlanner(registry);

    assert.throws(
      () => {
        planner.plan({
          sourceChain: 'solana',
          targetChain: 'stellar',
          token: 'SOL',
          amount: '10',
          targetAddress: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
          maxSlippagePercent: 0.5,
        });
      },
      /No active bridge skill currently supports|supported chains/i
    );
  });

  await runCase('4.2: Malformed SKILL.md resilience (corrupted skill does not crash registry)', () => {
    const tempSkillDir = path.resolve(process.cwd(), 'skills', '_malformed_test_skill');
    try {
      fs.mkdirSync(tempSkillDir, { recursive: true });
      fs.writeFileSync(path.join(tempSkillDir, 'SKILL.md'), '--- INVALID YAML FRONTMATTER ::: [[[');

      const registry = new SkillRegistry();
      // Should not throw; must skip malformed skill gracefully
      registry.loadSkillsSync();
      assert(registry.getAllBridgeSkills().length >= 1, 'Registry must load other valid skills');
    } finally {
      if (fs.existsSync(tempSkillDir)) {
        fs.rmSync(tempSkillDir, { recursive: true, force: true });
      }
    }
  });

  await runCase('4.3: Dynamic JIT synthesis for installed skills other than across-v3 (e.g. lifi)', async () => {
    const registry = new SkillRegistry();
    await registry.loadSkills();

    const lifiSkill = registry.getAllBridgeSkills().find(b => b.name === 'lifi');
    assert(lifiSkill, 'skills/lifi/SKILL.md must be loaded in registry');

    const planner = new RoutePlanner(registry);
    const plan = planner.plan({
      sourceChain: 'arbitrum',
      targetChain: 'optimism',
      token: 'USDC',
      amount: '100',
      targetAddress: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
      maxSlippagePercent: 0.5,
    });

    const engine = new OmnibridgeEngine();
    await engine.init();
    const script = await engine.synthesizer.synthesize(plan);

    assert(script.code.length > 200);
    assert(
      !script.code.includes('Math.random()'),
      'Synthesis for lifi should not fall back to generic Math.random() mock template; it must synthesize dynamically from the skill.'
    );
  });

  await runCase('4.4: Execution runtime must execute non-Across protocols (e.g. lifi) without "Unsupported live protocol" error', async () => {
    const registry = new SkillRegistry();
    await registry.loadSkills();

    const planner = new RoutePlanner(registry);
    const plan = planner.plan({
      sourceChain: 'arbitrum',
      targetChain: 'optimism',
      token: 'USDC',
      amount: '100',
      targetAddress: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
      maxSlippagePercent: 0.5,
    });
    plan.bridgeProtocol = 'lifi';

    const srcChain = registry.getChain(plan.intent.sourceChain)!;
    const dstChain = registry.getChain(plan.intent.targetChain)!;

    const prevKey = process.env.PRIVATE_KEY;
    process.env.PRIVATE_KEY = '0x0123456789012345678901234567890123456789012345678901234567890123';
    try {
      const liveRes = await LiveExecutor.execute(plan, srcChain, dstChain);
      assert.notEqual(
        liveRes.error,
        'Unsupported live protocol: lifi',
        'LiveExecutor must be protocol-agnostic and support any installed skill (e.g. lifi), not just across-v3.'
      );
    } finally {
      process.env.PRIVATE_KEY = prevKey;
    }
  });

  // --------------------------------------------------------------------------
  // SUITE 5: MULTI-VM ADDRESS & CHECKSUM EDGE CASES
  // --------------------------------------------------------------------------
  console.log('\n📋 Suite 5: Multi-VM Address & Checksum Edge Cases');

  await runCase('5.1: Valid EVM address passes checksum validation', () => {
    const res = AddressChecker.validate('0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', 'evm');
    assert.equal(res.isValid, true);
    assert.equal(res.normalizedAddress.toLowerCase(), '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359');
  });

  await runCase('5.2: Malformed EVM address rejected (invalid length and non-hex)', () => {
    const tooShort = AddressChecker.validate('0x123', 'evm');
    assert.equal(tooShort.isValid, false);

    const nonHex = AddressChecker.validate('0xZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ', 'evm');
    assert.equal(nonHex.isValid, false);
  });

  await runCase('5.3: Valid Stellar StrKey passes validation', () => {
    const res = AddressChecker.validate('GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN', 'stellar');
    assert.equal(res.isValid, true);
  });

  await runCase('5.4: Malformed Stellar address rejected', () => {
    const invalid = AddressChecker.validate('GA5Z_INVALID_STRKEY', 'stellar');
    assert.equal(invalid.isValid, false);
  });

  await runCase('5.5: Stellar Secret Key (S...) rejected with alert not to enter private keys', () => {
    const secretKeyInput = 'SA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
    const res = AddressChecker.validate(secretKeyInput, 'stellar');
    assert.equal(res.isValid, false);
    assert(
      res.error?.toLowerCase().includes('secret') || res.error?.toLowerCase().includes('private'),
      'Must warn user that input is a private/secret key'
    );
  });

  await runCase('5.6: Valid XRPL Classic address passes Base58Check', () => {
    const res = AddressChecker.validate('rN7n7otQDd6FczFgLdSqtcsAUxDkw6fzRH', 'xrpl');
    assert.equal(res.isValid, true);
  });

  await runCase('5.7: Malformed XRPL address rejected', () => {
    const invalid = AddressChecker.validate('notAnXrplAddress', 'xrpl');
    assert.equal(invalid.isValid, false);
  });

  // --------------------------------------------------------------------------
  // SUITE 6: AST SECURITY SANDBOX COMPLIANCE
  // --------------------------------------------------------------------------
  console.log('\n📋 Suite 6: AST Security Sandbox Compliance');

  await runCase('6.1: AST Linter permits safe Viem script execution', () => {
    const safeScript = `
      import { createPublicClient, http } from 'viem';
      const client = createPublicClient({ transport: http('https://mainnet.base.org') });
      console.log('Simulating safely');
    `;
    const res = AstSecurityValidator.validate(safeScript);
    assert.equal(res.passed, true);
    assert.equal(res.violations.length, 0);
  });

  await runCase('6.2: AST Linter blocks prohibited child_process execution', () => {
    const maliciousScript = `
      import child_process from 'child_process';
      child_process.execSync('rm -rf /');
    `;
    const res = AstSecurityValidator.validate(maliciousScript);
    assert.equal(res.passed, false);
    assert(res.violations.some(v => v.includes('child process')), 'Should report child process violation');
  });

  await runCase('6.3: AST Linter blocks prohibited file deletion (fs.unlink)', () => {
    const maliciousScript = `
      import fs from 'node:fs';
      fs.unlinkSync('/etc/passwd');
    `;
    const res = AstSecurityValidator.validate(maliciousScript);
    assert.equal(res.passed, false);
    assert(res.violations.some(v => v.includes('File deletion') || v.includes('filesystem')), 'Should report filesystem violation');
  });

  await runCase('6.4: AST Linter blocks eval and dynamic Function construction', () => {
    const maliciousEval = `eval("console.log('injected')");`;
    const res = AstSecurityValidator.validate(maliciousEval);
    assert.equal(res.passed, false);
    assert(res.violations.some(v => v.includes('Dynamic code execution') || v.includes('eval')));
  });

  await runCase('6.5: AST Linter blocks credential file references (.ssh, .bash_history)', () => {
    const maliciousAccess = `const key = fs.readFileSync('/root/.ssh/id_rsa');`;
    const res = AstSecurityValidator.validate(maliciousAccess);
    assert.equal(res.passed, false);
    assert(res.violations.some(v => v.includes('sensitive operating system credentials')));
  });

  // --------------------------------------------------------------------------
  // SUITE 7: PRE-FLIGHT SIMULATION, DRY-RUN & HITL GATE
  // --------------------------------------------------------------------------
  console.log('\n📋 Suite 7: Pre-Flight Simulation, Dry-Run & HITL Gate');

  await runCase('7.1: Dry-run execution generates script and simulation without broadcasting', async () => {
    const mockModel = new DeterministicMockModel();
    const engine = new OmnibridgeEngine({
      llm: mockModel,
      autoApprove: true,
      simulateBroadcast: false,
    });

    const result = await engine.execute('Bridge 50 USDC from Polygon to Base', {
      dryRun: true,
      targetAddress: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
    });

    assert.equal(result.success, true);
    assert.equal(result.txHash, undefined, 'Dry run must never produce a broadcast txHash');
    assert(result.script.filePath.length > 0, 'Dry run must generate script file');
    assert.equal(result.approval.approved, false, 'Approval must be false in dry run');
  });

  await runCase('7.2: High-value transfers trigger phrase confirmation requirement', async () => {
    const mockModel = new DeterministicMockModel();
    const engine = new OmnibridgeEngine({ llm: mockModel });
    await engine.init();

    const plan = engine.planRoute({
      sourceChain: 'polygon',
      targetChain: 'arbitrum',
      token: 'USDC',
      amount: '5000', // High value >= 1000
      targetAddress: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
      maxSlippagePercent: 0.5,
    });

    const script = await engine.synthesizer.synthesize(plan);
    const sim = await engine.simulate(plan);
    const audit = await engine.prepareAuditPayload(plan, sim, script);

    assert.equal(audit.requiresPhraseConfirmation, true);
    assert.equal(audit.riskLevel, 'MEDIUM');
    assert.equal(audit.confirmationPhrase, 'CONFIRM 5000 USDC TO ARBITRUM');
  });

  await runCase('7.3: User rejection in HITL gate cleanly halts execution with error message', async () => {
    const mockModel = new DeterministicMockModel();
    const rejectHandler = {
      async requestApproval() {
        return { approved: false, rejectionReason: 'Aborted by operator via [a]' };
      },
    };

    const engine = new OmnibridgeEngine({
      llm: mockModel,
      hitlHandler: rejectHandler,
    });

    const result = await engine.execute('Bridge 100 USDC from Base to Arbitrum', {
      targetAddress: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
    });

    assert.equal(result.success, false);
    assert.equal(result.approval.approved, false);
    assert.equal(result.error, 'Aborted by operator via [a]');
    assert.equal(result.txHash, undefined, 'Rejected transaction must never broadcast');
  });

  await runCase('7.4: Ephemeral script execution in sandbox runner streams telemetry events', async () => {
    const mockModel = new DeterministicMockModel();
    const engine = new OmnibridgeEngine({
      llm: mockModel,
      autoApprove: true,
      simulateBroadcast: true,
    });
    await engine.init();

    const eventsEmitted: string[] = [];
    engine.events.on('execution:step', () => eventsEmitted.push('execution:step'));
    engine.events.on('execution:complete', () => eventsEmitted.push('execution:complete'));

    const result = await engine.execute('Bridge 50 USDC from Polygon to Base', {
      targetAddress: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
    });

    assert.equal(result.success, true);
    assert(eventsEmitted.includes('execution:complete'), 'Execution must emit execution:complete event');
    assert(eventsEmitted.includes('execution:step'), 'Execution must emit execution:step events');
    assert(result.script.filePath.endsWith('.ts'), 'Must synthesize an ephemeral TypeScript script');
    assert(fs.existsSync(result.script.filePath), 'Ephemeral script file must exist on disk during execution');
  });

  console.log('\n================================================================================');
  console.log(`   EVALUATION SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================================\n');

  if (failed > 0) {
    console.log('🔴 TDD RED STATE: The following edge cases failed as expected against the active codebase:');
    for (const d of failureDetails) {
      console.log(`   ✖ ${d}`);
    }
    console.log('\nThese failures precisely define the complete specification needed for the implementation.');
    process.exitCode = 1;
  } else {
    console.log('🟢 TDD GREEN STATE: All active codebase requirements passed!');
  }
}

runEvaluationSuite().catch(err => {
  console.error('\n❌ Evaluation Harness Error:', err);
  process.exit(1);
});
