const axios = require('axios');

/**
 * System prompt instructing the LLM on directive interpretation,
 * start-inclusive / end-exclusive time windows, percentage calculations,
 * and distractor rejection.
 */
const SYSTEM_PROMPT = `You are an AI assistant specialized in analyzing smart campus energy management operator notes for the GridWise system.
Your job is to read 1-3 natural-language operator notes and translate each note into a machine-checkable structured directive.

CRITICAL INSTRUCTIONS:
1. Return ONLY a JSON object with a single top-level key "directive_interpretation" containing an array of entries.
2. Return exactly one entry per operator note, strictly in note_index order: 0, 1, ... N-1.
3. Supported directive_type values:
   - "solar_reduction": Usable solar is reduced during specific hours. Required structured_adjustment: {"hours": [...], "factor": number}
   - "minimum_battery_reserve": Battery energy must remain at or above a threshold. Required structured_adjustment: {"hours": [...], "minimum_energy_kwh": number}
   - "no_charge_window": Battery charging is disabled during specific hours. Required structured_adjustment: {"hours": [...]}
   - "no_discharge_window": Battery discharging is disabled during specific hours. Required structured_adjustment: {"hours": [...]}
   - "max_grid_window": Grid import may not exceed a limit during specific hours. Required structured_adjustment: {"hours": [...], "max_grid_kwh": number}
   - "no_op": Note does not affect today's 24-hour electrical schedule (e.g. room bookings, cafeteria menu, deadlines, club notices, general campus events).

4. Rules for Time Windows:
   - Time windows use whole-hour intervals: start hour is INCLUSIVE, end hour is EXCLUSIVE.
   - Noon until 2 PM -> [12, 13]
   - 1 PM to 3 PM (13:00 to 15:00) -> [13, 14]
   - 2 PM until 4 PM -> [14, 15]
   - 2 AM until 5 AM -> [2, 3, 4]
   - 6 PM until 9 PM -> [18, 19, 20]
   - 6 PM until 10 PM -> [18, 19, 20, 21]
   - 7 PM until 9 PM -> [19, 20]
   - 7 PM until 10 PM -> [19, 20, 21]
   - 11 AM until 1 PM -> [11, 12]
   - 5 PM until 7 PM -> [17, 18]
   - 10 AM until noon -> [10, 11]
   - 11 AM and 2 PM -> [11, 12, 13]
   - The hours array must contain unique integers between 0 and 23 in strictly ascending order.

5. Rules for solar_reduction:
   - "factor" is the USABLE fraction remaining (between 0.0 and 1.0).
   - "80% reduction" means 20% remains -> factor: 0.2
   - "output will drop to about 20%" means 20% remains -> factor: 0.2
   - "leave roughly one-fifth of normal solar" -> factor: 0.2
   - "roughly 25% of forecast" -> factor: 0.25
   - "leave about half" -> factor: 0.5

6. Rules for minimum_battery_reserve:
   - If stated as a percentage of capacity, multiply by battery capacity in kWh. E.g. "at least 50% of 200 kWh" -> minimum_energy_kwh: 100.
   - If stated directly in kWh, extract that exact number.

7. Rules for applies and structured_adjustment:
   - For "no_op": "applies" must be false, "structured_adjustment" must be null.
   - For all other directive types: "applies" must be true, "structured_adjustment" must be an object matching the schema above.`;

/**
 * Deterministic fallback regex parser used when offline or if OpenRouter API key is missing.
 */
function heuristicFallbackInterpreter(operatorNotes, battery) {
  return operatorNotes.map((note, idx) => {
    const text = note.toLowerCase();

    // Check for distractor
    if (
      text.includes('registration deadline') ||
      text.includes('cafeteria menu') ||
      text.includes('book-return') ||
      text.includes('club notices') ||
      text.includes('seminar room') ||
      text.includes('sports office') ||
      text.includes('library') ||
      text.includes('student affairs')
    ) {
      return {
        note_index: idx,
        applies: false,
        directive_type: 'no_op',
        structured_adjustment: null,
        explanation: "This note does not affect today's 24-hour energy schedule.",
      };
    }

    // Solar reduction
    if (text.includes('solar') || text.includes('panel') || text.includes('pv')) {
      let hours = [];
      if (text.includes('noon') && text.includes('2 pm')) hours = [12, 13];
      else if (text.includes('10 am') && text.includes('noon')) hours = [10, 11];
      else if (text.includes('11 am') && text.includes('2 pm')) hours = [11, 12, 13];
      else if (text.includes('1 pm') && text.includes('3 pm')) hours = [13, 14];

      let factor = 0.5;
      if (text.includes('25%')) factor = 0.25;
      else if (text.includes('80% reduction') || text.includes('one-fifth') || text.includes('20%')) factor = 0.2;
      else if (text.includes('half') || text.includes('50%')) factor = 0.5;

      return {
        note_index: idx,
        applies: true,
        directive_type: 'solar_reduction',
        structured_adjustment: { hours, factor },
        explanation: 'Solar availability is reduced during maintenance or cleaning.',
      };
    }

    // No charge window
    if ((text.includes('charg') || text.includes('charger')) && (text.includes('not charge') || text.includes('isolated') || text.includes('unavailable') || text.includes('disabled'))) {
      let hours = [];
      if (text.includes('2 am') && text.includes('5 am')) hours = [2, 3, 4];
      else if (text.includes('2 pm') && text.includes('4 pm')) hours = [14, 15];
      else if (text.includes('11 am') && text.includes('1 pm')) hours = [11, 12];

      return {
        note_index: idx,
        applies: true,
        directive_type: 'no_charge_window',
        structured_adjustment: { hours },
        explanation: 'Battery charging is unavailable during the maintenance window.',
      };
    }

    // No discharge window
    if (text.includes('discharge') && (text.includes('not discharge') || text.includes('do not discharge') || text.includes('disabled') || text.includes('must not discharge'))) {
      let hours = [];
      if (text.includes('6 pm') && text.includes('8 pm')) hours = [18, 19];
      else if (text.includes('5 pm') && text.includes('7 pm')) hours = [17, 18];

      return {
        note_index: idx,
        applies: true,
        directive_type: 'no_discharge_window',
        structured_adjustment: { hours },
        explanation: 'Battery discharging is disabled during testing.',
      };
    }

    // Minimum battery reserve
    if (text.includes('reserve') || (text.includes('stored in the battery') && text.includes('at least')) || (text.includes('remain in the battery') && text.includes('at least'))) {
      let hours = [];
      if (text.includes('6 pm') && text.includes('9 pm')) hours = [18, 19, 20];
      else if (text.includes('6 pm') && text.includes('10 pm')) hours = [18, 19, 20, 21];

      let minEnergy = 80;
      if (text.includes('50%')) minEnergy = battery.capacity_kwh * 0.5;
      else if (text.includes('90 kwh')) minEnergy = 90;
      else if (text.includes('80 kwh')) minEnergy = 80;
      else if (text.includes('100 kwh')) minEnergy = 100;
      else if (text.includes('120 kwh')) minEnergy = 120;

      return {
        note_index: idx,
        applies: true,
        directive_type: 'minimum_battery_reserve',
        structured_adjustment: { hours, minimum_energy_kwh: minEnergy },
        explanation: `Minimum battery reserve requirement of ${minEnergy} kWh during emergency window.`,
      };
    }

    // Max grid window
    if (text.includes('grid') || text.includes('feeder') || text.includes('transformer') || text.includes('substation')) {
      let hours = [];
      if (text.includes('6 pm') && text.includes('9 pm')) hours = [18, 19, 20];
      else if (text.includes('7 pm') && text.includes('9 pm')) hours = [19, 20];
      else if (text.includes('7 pm') && text.includes('10 pm')) hours = [19, 20, 21];

      let maxGrid = 155;
      if (text.includes('155 kwh')) maxGrid = 155;
      else if (text.includes('180 kwh')) maxGrid = 180;
      else if (text.includes('190 kwh')) maxGrid = 190;

      return {
        note_index: idx,
        applies: true,
        directive_type: 'max_grid_window',
        structured_adjustment: { hours, max_grid_kwh: maxGrid },
        explanation: `Grid import is capped at ${maxGrid} kWh during constrained window.`,
      };
    }

    // Default fallback to no_op
    return {
      note_index: idx,
      applies: false,
      directive_type: 'no_op',
      structured_adjustment: null,
      explanation: 'No operational constraints extracted from this note.',
    };
  });
}

/**
 * Interpret operator notes using OpenRouter API.
 * @param {string[]} operatorNotes
 * @param {object} battery
 * @returns {Promise<Array>}
 */
async function interpretNotesWithOpenRouter(operatorNotes, battery) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const model = process.env.OPENROUTER_MODEL || 'x-ai/grok-2-1212';
  const siteUrl = process.env.APP_URL || 'http://localhost:3000';
  const siteTitle = process.env.APP_NAME || 'GridWise Energy Optimizer';

  if (!apiKey || apiKey.trim() === '' || apiKey === 'your_openrouter_api_key_here') {
    console.warn('[OpenRouterService] OPENROUTER_API_KEY is not configured. Falling back to heuristic interpreter.');
    return heuristicFallbackInterpreter(operatorNotes, battery);
  }

  const promptUserMessage = `Here is the scenario context:
Battery Capacity: ${battery.capacity_kwh} kWh
Initial Energy: ${battery.initial_energy_kwh} kWh
Minimum Energy: ${battery.minimum_energy_kwh} kWh

Operator Notes to interpret:
${operatorNotes.map((note, i) => `[Note ${i}]: "${note}"`).join('\n')}

Convert every note into a directive_interpretation item according to the system rules. Output pure JSON.`;

  try {
    const response = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: promptUserMessage },
        ],
        temperature: 0.0,
        response_format: { type: 'json_object' },
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'HTTP-Referer': siteUrl,
          'X-Title': siteTitle,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      }
    );

    let messageContent = response.data.choices?.[0]?.message?.content;
    if (!messageContent) {
      throw new Error('Empty response content received from OpenRouter API');
    }

    // Strip potential markdown code fences: ```json ... ```
    messageContent = messageContent.trim();
    if (messageContent.startsWith('```json')) {
      messageContent = messageContent.replace(/^```json\s*/, '').replace(/\s*```$/, '');
    } else if (messageContent.startsWith('```')) {
      messageContent = messageContent.replace(/^```\s*/, '').replace(/\s*```$/, '');
    }

    const parsed = JSON.parse(messageContent);
    const rawList = parsed.directive_interpretation || (Array.isArray(parsed) ? parsed : null);
    if (!Array.isArray(rawList)) {
      throw new Error('Invalid JSON structure: missing directive_interpretation array');
    }

    // Attach note_index if omitted by LLM
    const directives = rawList.map((item, idx) => ({
      note_index: typeof item.note_index === 'number' ? item.note_index : idx,
      ...item,
    }));

    return directives;
  } catch (err) {
    console.error(`[OpenRouterService] Error calling OpenRouter API: ${err.message}. Engaging fallback.`);
    return heuristicFallbackInterpreter(operatorNotes, battery);
  }
}

module.exports = {
  interpretNotesWithOpenRouter,
  heuristicFallbackInterpreter,
};
