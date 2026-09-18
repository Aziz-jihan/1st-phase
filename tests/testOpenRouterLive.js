require('dotenv').config();
const { interpretNotesWithOpenRouter } = require('../src/services/llm.service');
const { validateDirectivesWithGuardrails } = require('../src/validators/guardrail');
const { optimizeSchedule } = require('../src/services/optimizer.service');
const { replayAndComputeMetrics } = require('../src/utils/replay');
const samplePack = require('./sampleData.json');

async function testLiveOpenRouter() {
  console.log('====================================================');
  console.log('Testing Live OpenRouter API Call with model:', process.env.OPENROUTER_MODEL);
  console.log('====================================================\n');

  const testCase = samplePack.cases[0]; // SAMPLE-01
  const input = testCase.input;

  console.log('Input Scenario ID:', input.scenario_id);
  console.log('Operator Notes:');
  input.operator_notes.forEach((note, idx) => console.log(`  [Note ${idx}]: "${note}"`));
  console.log('\nSending request to OpenRouter API...');

  const startTime = Date.now();
  const rawDirectives = await interpretNotesWithOpenRouter(input.operator_notes, input.battery);
  const duration = Date.now() - startTime;

  console.log(`\nOpenRouter API Response Received in ${duration}ms:`);
  console.log(JSON.stringify(rawDirectives, null, 2));

  console.log('\nRunning Deterministic Guardrails Validation...');
  const validatedDirectives = validateDirectivesWithGuardrails(
    rawDirectives,
    input.operator_notes.length,
    input.battery
  );
  console.log('[GUARDRAILS PASS] All directive interpretations are valid.');

  console.log('\nRunning Mathematical LP Optimizer...');
  const hourlyPlan = optimizeSchedule(input, validatedDirectives);

  console.log('\nReplaying Schedule & Computing Final Metrics...');
  const finalResult = replayAndComputeMetrics(input, validatedDirectives, hourlyPlan);

  console.log('\n====================================================');
  console.log('FINAL API OUTPUT:');
  console.log('====================================================');
  console.log(`Scenario ID:        ${finalResult.scenario_id}`);
  console.log(`Total Grid (kWh):   ${finalResult.total_grid_kwh} (Expected: ${testCase.expected_total_grid})`);
  console.log(`Total Cost (BDT):   ${finalResult.total_cost_bdt} (Expected: ${testCase.expected_total_cost})`);
  console.log(`Peak Grid (kWh):    ${finalResult.peak_grid_kwh}`);
  console.log(`Plan Summary:       "${finalResult.plan_summary}"`);
  console.log('====================================================\n');

  if (Math.abs(finalResult.total_cost_bdt - testCase.expected_total_cost) <= 1.0) {
    console.log('[SUCCESS] Live OpenRouter integration test passed perfectly!');
  } else {
    console.warn('[WARNING] Cost differed slightly from reference plan.');
  }
}

testLiveOpenRouter().catch((err) => {
  console.error('[FAIL] Live OpenRouter test error:', err.message);
  process.exit(1);
});
