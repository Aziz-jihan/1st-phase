const { optimizeEnergyRequestSchema } = require('../validators/request.schema');
const { validateDirectivesWithGuardrails } = require('../validators/guardrail');
const { interpretNotesWithOpenRouter } = require('../services/llm.service');
const { optimizeSchedule } = require('../services/optimizer.service');
const { replayAndComputeMetrics } = require('../utils/replay');

/**
 * Health check handler
 * GET /health -> 200 { "status": "ok" }
 */
function getHealth(req, res) {
  return res.status(200).json({ status: 'ok' });
}

/**
 * Optimization endpoint handler
 * POST /optimize-energy
 */
async function postOptimizeEnergy(req, res) {
  try {
    // 1. Structural request validation
    const validationResult = optimizeEnergyRequestSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({
        error: 'Invalid request payload',
        details: validationResult.error.errors.map((e) => ({
          path: e.path.join('.'),
          message: e.message,
        })),
      });
    }

    const scenario = validationResult.data;

    // 2. Interpret operator notes with OpenRouter
    const rawDirectives = await interpretNotesWithOpenRouter(
      scenario.operator_notes,
      scenario.battery
    );

    // 3. Deterministic Guardrail Validation
    let validatedDirectives;
    try {
      validatedDirectives = validateDirectivesWithGuardrails(
        rawDirectives,
        scenario.operator_notes.length,
        scenario.battery
      );
    } catch (guardrailErr) {
      return res.status(422).json({
        error: 'Directive guardrail validation failed',
        message: guardrailErr.message,
      });
    }

    // 4. Mathematical LP Optimization
    let hourlyPlan;
    try {
      hourlyPlan = optimizeSchedule(scenario, validatedDirectives);
    } catch (optErr) {
      return res.status(422).json({
        error: 'Optimization failed to find a feasible schedule',
        message: optErr.message,
      });
    }

    // 5. Final Replay, Metric Computation & Plan Assembly
    const responsePayload = replayAndComputeMetrics(
      scenario,
      validatedDirectives,
      hourlyPlan
    );

    return res.status(200).json(responsePayload);
  } catch (err) {
    console.error('[EnergyController] Internal processing error:', err.message);
    return res.status(500).json({
      error: 'An unexpected internal error occurred during optimization processing.',
    });
  }
}

module.exports = {
  getHealth,
  postOptimizeEnergy,
};
