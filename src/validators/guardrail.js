const ALLOWED_DIRECTIVE_TYPES = [
  'solar_reduction',
  'minimum_battery_reserve',
  'no_charge_window',
  'no_discharge_window',
  'max_grid_window',
  'no_op',
];

/**
 * Validates and cleans hours array:
 * - Must be array of integers in range [0..23]
 * - Unique values, sorted ascending
 */
function validateHoursArray(hours) {
  if (!Array.isArray(hours) || hours.length === 0) {
    throw new Error('Hours must be a non-empty array of integers');
  }

  for (let i = 0; i < hours.length; i++) {
    const h = hours[i];
    if (!Number.isInteger(h) || h < 0 || h > 23) {
      throw new Error(`Hour values must be integers between 0 and 23. Got: ${h}`);
    }
  }

  // Check unique and ascending
  for (let i = 1; i < hours.length; i++) {
    if (hours[i] <= hours[i - 1]) {
      throw new Error('Hours array must contain unique integers in strictly ascending order');
    }
  }

  return [...hours];
}

/**
 * Validates and sanitizes the raw output of the LLM against the challenge guardrails.
 * @param {Array} rawInterpretations - Array from LLM output
 * @param {number} noteCount - Expected number of notes
 * @param {object} battery - Battery specifications { capacity_kwh, ... }
 * @returns {Array} Validated, machine-checkable directive_interpretation array
 */
function validateDirectivesWithGuardrails(rawInterpretations, noteCount, battery) {
  if (!Array.isArray(rawInterpretations)) {
    throw new Error('LLM output directive_interpretation must be an array');
  }

  if (rawInterpretations.length !== noteCount) {
    throw new Error(`Expected exactly ${noteCount} directive interpretation entries, got ${rawInterpretations.length}`);
  }

  const validatedEntries = [];

  for (let idx = 0; idx < noteCount; idx++) {
    const entry = rawInterpretations[idx];
    if (!entry || typeof entry !== 'object') {
      throw new Error(`Entry at index ${idx} is not a valid object`);
    }

    const note_index = entry.note_index;
    if (note_index !== idx) {
      throw new Error(`Entry at position ${idx} must have note_index ${idx}, found ${note_index}`);
    }

    const directive_type = entry.directive_type;
    if (!ALLOWED_DIRECTIVE_TYPES.includes(directive_type)) {
      throw new Error(`Invalid directive_type: ${directive_type}`);
    }

    const explanation = typeof entry.explanation === 'string' && entry.explanation.trim().length > 0
      ? entry.explanation.trim()
      : 'Operator note interpretation.';

    if (directive_type === 'no_op') {
      validatedEntries.push({
        note_index: idx,
        applies: false,
        directive_type: 'no_op',
        structured_adjustment: null,
        explanation,
      });
      continue;
    }

    // Non no_op directives MUST have applies: true
    if (entry.applies !== true) {
      throw new Error(`Non-no_op directive "${directive_type}" must have applies: true`);
    }

    const adj = entry.structured_adjustment;
    if (!adj || typeof adj !== 'object') {
      throw new Error(`Directive "${directive_type}" must have a structured_adjustment object`);
    }

    const cleanHours = validateHoursArray(adj.hours);
    let structured_adjustment = {};

    switch (directive_type) {
      case 'solar_reduction': {
        const factor = Number(adj.factor);
        if (isNaN(factor) || factor < 0 || factor > 1) {
          throw new Error(`solar_reduction factor must be a number between 0 and 1. Got: ${adj.factor}`);
        }
        structured_adjustment = {
          hours: cleanHours,
          factor: Number(factor.toFixed(4)),
        };
        break;
      }

      case 'minimum_battery_reserve': {
        const minEnergy = Number(adj.minimum_energy_kwh);
        if (isNaN(minEnergy) || minEnergy < 0) {
          throw new Error(`minimum_energy_kwh must be a non-negative number. Got: ${adj.minimum_energy_kwh}`);
        }
        if (minEnergy > battery.capacity_kwh) {
          throw new Error(`minimum_energy_kwh (${minEnergy}) exceeds battery capacity (${battery.capacity_kwh})`);
        }
        structured_adjustment = {
          hours: cleanHours,
          minimum_energy_kwh: Number(minEnergy.toFixed(2)),
        };
        break;
      }

      case 'no_charge_window': {
        structured_adjustment = {
          hours: cleanHours,
        };
        break;
      }

      case 'no_discharge_window': {
        structured_adjustment = {
          hours: cleanHours,
        };
        break;
      }

      case 'max_grid_window': {
        const maxGrid = Number(adj.max_grid_kwh);
        if (isNaN(maxGrid) || maxGrid < 0) {
          throw new Error(`max_grid_kwh must be a non-negative number. Got: ${adj.max_grid_kwh}`);
        }
        structured_adjustment = {
          hours: cleanHours,
          max_grid_kwh: Number(maxGrid.toFixed(2)),
        };
        break;
      }

      default:
        throw new Error(`Unsupported directive_type: ${directive_type}`);
    }

    validatedEntries.push({
      note_index: idx,
      applies: true,
      directive_type,
      structured_adjustment,
      explanation,
    });
  }

  return validatedEntries;
}

module.exports = {
  ALLOWED_DIRECTIVE_TYPES,
  validateDirectivesWithGuardrails,
  validateHoursArray,
};
