import assert from 'node:assert/strict';
import {
  OmnibridgeEngine,
  SkillRegistry,
  AddressChecker,
  IntentParser,
  RoutePlanner,
  AstSecurityValidator,
  DeterministicMockModel,
} from '../src/index.js';

async function runTests() {
  console.log('🧪 Starting Omnibridge Core & Agent Test Suite...\n');

  // Test 1: Skill Registry & Dynamic File Discovery
  console.log('▶ Test 1: SkillRegistry Dynamic File Discovery');
  const registry = new SkillRegistry();
  await registry.loadSkills();
  const chains = registry.getSupportedChains();
  assert(chains.length >= 3, `Expected at least 3 chains from across-v3, found ${chains.length}`);
  assert(chains.some(c => c.name === 'polygon'), 'Polygon chain missing');
  assert(chains.some(c => c.name === 'base'), 'Base chain missing');
  assert(chains.some(c => c.name === 'arbitrum'), 'Arbitrum chain missing');
  console.log('  ✔ SkillRegistry correctly loaded and indexed chains dynamically from skills');

  // Test 2: Address Checker
  console.log('▶ Test 2: Multi-VM Address Validator');
  const validEvm = AddressChecker.validate('0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', 'evm');
  assert(validEvm.isValid, 'Valid EVM address should pass');

  const invalidEvm = AddressChecker.validate('0xinvalid', 'evm');
  assert(!invalidEvm.isValid, 'Invalid EVM address should fail');

  const validStellar = AddressChecker.validate('GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN', 'stellar');
  assert(validStellar.isValid, 'Valid Stellar StrKey should pass');

  const validXrpl = AddressChecker.validate('rN7n7otQDd6FczFgLdSqtcsAUxDkw6fzRH', 'xrpl');
  assert(validXrpl.isValid, 'Valid XRPL classic address should pass');
  console.log('  ✔ Multi-VM AddressChecker verified across EVM, Stellar, and XRPL');

  // Test 3: Intent Parser
  console.log('▶ Test 3: Natural Language Intent Parsing');
  const mockModel = new DeterministicMockModel();
  const parser = new IntentParser(registry, mockModel);
  const intent1 = await parser.parse('Bridge 250 USDC from Polygon to Arbitrum');
  assert.equal(intent1.sourceChain, 'polygon');
  assert.equal(intent1.targetChain, 'arbitrum');
  assert.equal(intent1.amount, '250');
  assert.equal(intent1.token, 'USDC');
  console.log('  ✔ IntentParser correctly extracted source, target, amount, and token');

  // Test 4: Route Planner
  console.log('▶ Test 4: Route Planner & Deterministic Fast Recipe');
  const planner = new RoutePlanner(registry);
  const plan = planner.plan(intent1);
  assert.equal(plan.bridgeProtocol, 'across-v3');
  assert(plan.steps.length >= 3, 'Expected at least 3 execution steps');
  assert(parseFloat(plan.amounts.minGuaranteedOutput) > 0, 'Min guaranteed output must be calculated');
  console.log(`  ✔ RoutePlanner bound intent to recipe "${plan.recipe?.id}" with ${plan.steps.length} steps`);

  // Test 5: AST Security Validator
  console.log('▶ Test 5: AST Security Validator');
  const safeCode = `console.log("Safe bridge script");`;
  const safeResult = AstSecurityValidator.validate(safeCode);
  assert(safeResult.passed, 'Safe script should pass AST validation');

  const maliciousCode = `import child_process from 'child_process'; child_process.exec('rm -rf /');`;
  const maliciousResult = AstSecurityValidator.validate(maliciousCode);
  assert(!maliciousResult.passed, 'Malicious code with child_process execution must fail');
  console.log('  ✔ AstSecurityValidator blocked prohibited system calls');

  // Test 6: Full Omnibridge Engine End-to-End Execution
  console.log('▶ Test 6: OmnibridgeEngine Full Lifecycle (Simulation & Auto-Approval)');
  const engine = new OmnibridgeEngine({
    llm: mockModel,
    autoApprove: true,
  });

  const result = await engine.execute('Bridge 100 USDC from Base to Arbitrum');
  assert(result.success, 'Engine execution should succeed');
  assert(result.txHash, 'Transaction hash should be generated upon approval');
  assert.equal(result.plan.bridgeProtocol, 'across-v3');
  console.log(`  ✔ Full execution cycle completed. Broadcast Tx: ${result.txHash}`);

  // Test 7: Dry-Run Mode
  console.log('▶ Test 7: Dry-Run Execution Mode');
  const dryRunResult = await engine.execute('Bridge 50 USDC from Polygon to Base', { dryRun: true });
  assert(dryRunResult.success, 'Dry run should succeed');
  assert(!dryRunResult.txHash, 'Dry run must NOT broadcast transaction');
  console.log('  ✔ Dry-run generated code and simulated without transaction broadcast');

  console.log('\n🎉 ALL 7 TESTS PASSED SUCCESSFULLY!');
}

runTests().catch(err => {
  console.error('\n❌ Test Suite Failed:', err);
  process.exit(1);
});
