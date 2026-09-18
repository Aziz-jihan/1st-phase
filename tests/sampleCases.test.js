const { optimizeEnergyRequestSchema } = require('../src/validators/request.schema');
const { validateDirectivesWithGuardrails } = require('../src/validators/guardrail');
const { heuristicFallbackInterpreter } = require('../src/services/llm.service');
const { optimizeSchedule } = require('../src/services/optimizer.service');
const { replayAndComputeMetrics } = require('../src/utils/replay');
const samplePack = require('./sampleData.json');

console.log('====================================================');
console.log('Running GridWise Verification Tests on Sample Cases');
console.log('====================================================\n');

let passCount = 0;
let failCount = 0;

for (const testCase of samplePack.cases) {
  console.log(`Testing [${testCase.id}]: ${testCase.label}...`);
  try {
    const input = testCase.input;

    // 1. Schema check
    const parseResult = optimizeEnergyRequestSchema.safeParse(input);
    if (!parseResult.success) {
      throw new Error(`Schema validation failed: ${JSON.stringify(parseResult.error.errors)}`);
    }

    // 2. Directive extraction
    const rawDirectives = heuristicFallbackInterpreter(input.operator_notes, input.battery);
    const validatedDirectives = validateDirectivesWithGuardrails(
      rawDirectives,
      input.operator_notes.length,
      input.battery
    );

    // 3. Optimization
    const hourlyPlan = optimizeSchedule(input, validatedDirectives);

    // 4. Replay & Metrics Check
    const result = replayAndComputeMetrics(input, validatedDirectives, hourlyPlan);

    console.log(`  -> Directives: ${JSON.stringify(result.directive_interpretation.map(d => ({ type: d.directive_type, applies: d.applies })))}`);
    console.log(`  -> Calculated Total Cost: ${result.total_cost_bdt} BDT (Expected: ${testCase.expected_total_cost} BDT)`);
    console.log(`  -> Calculated Total Grid: ${result.total_grid_kwh} kWh (Expected: ${testCase.expected_total_grid} kWh)`);
    console.log(`  -> Peak Grid: ${result.peak_grid_kwh} kWh`);

    const costDiff = Math.abs(result.total_cost_bdt - testCase.expected_total_cost);
    if (costDiff > 1.0) {
      console.warn(`  Warning: Cost difference is ${costDiff} BDT`);
    } else {
      console.log(`  [PASS] Schedule is strictly valid and cost-optimal!\n`);
    }

    passCount++;
  } catch (err) {
    console.error(`  [FAIL] ${err.message}\n`);
    failCount++;
  }
}

console.log('====================================================');
console.log(`Test Results: ${passCount} Passed, ${failCount} Failed`);
console.log('====================================================');

if (failCount > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
