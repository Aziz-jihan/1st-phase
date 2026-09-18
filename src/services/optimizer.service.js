const solver = require('javascript-lp-solver');

/**
 * Optimizes the 24-hour campus energy schedule given the base scenario and validated directives.
 * 
 * @param {object} scenario
 * @param {Array} directives - Validated directive_interpretation array
 * @returns {Array} 24 hourly plan entries
 */
function optimizeSchedule(scenario, directives) {
  const { hours, battery } = scenario;

  // 1. Prepare 24-hour arrays with directive overrides
  const effectiveSolar = hours.map((h) => h.solar_kwh);
  const minBatteryReserve = hours.map(() => battery.minimum_energy_kwh);
  const noCharge = hours.map(() => false);
  const noDischarge = hours.map(() => false);
  const maxGrid = hours.map(() => Infinity);

  for (const directive of directives) {
    if (!directive.applies || !directive.structured_adjustment) continue;

    const { directive_type, structured_adjustment: adj } = directive;

    switch (directive_type) {
      case 'solar_reduction':
        for (const h of adj.hours) {
          effectiveSolar[h] = Math.max(0, hours[h].solar_kwh * adj.factor);
        }
        break;

      case 'minimum_battery_reserve':
        for (const h of adj.hours) {
          minBatteryReserve[h] = Math.max(minBatteryReserve[h], adj.minimum_energy_kwh);
        }
        break;

      case 'no_charge_window':
        for (const h of adj.hours) {
          noCharge[h] = true;
        }
        break;

      case 'no_discharge_window':
        for (const h of adj.hours) {
          noDischarge[h] = true;
        }
        break;

      case 'max_grid_window':
        for (const h of adj.hours) {
          maxGrid[h] = Math.min(maxGrid[h], adj.max_grid_kwh);
        }
        break;
    }
  }

  // 2. Formulate Linear Program for javascript-lp-solver
  const constraints = {};
  const variables = {};

  // For each hour h:
  // Balance: grid[h] + solar_used[h] + discharge[h] - charge[h] = demand[h]
  for (let h = 0; h < 24; h++) {
    constraints[`balance_${h}`] = {
      min: hours[h].demand_kwh,
      max: hours[h].demand_kwh,
    };

    // Solar usage limit: solar_used[h] <= effectiveSolar[h]
    constraints[`solar_limit_${h}`] = {
      max: effectiveSolar[h],
    };

    // Charge rate limit
    constraints[`charge_rate_${h}`] = {
      max: noCharge[h] ? 0 : battery.max_charge_kwh_per_hour,
    };

    // Discharge rate limit
    constraints[`discharge_rate_${h}`] = {
      max: noDischarge[h] ? 0 : battery.max_discharge_kwh_per_hour,
    };

    // Max grid limit if active
    if (Number.isFinite(maxGrid[h])) {
      constraints[`grid_limit_${h}`] = {
        max: maxGrid[h],
      };
    }
  }

  // Battery Energy constraints:
  // E[h] = initial_energy + sum_{i=0..h} (charge[i] - discharge[i])
  // minBatteryReserve[h] <= E[h] <= capacity_kwh
  // => minBatteryReserve[h] - initial_energy <= sum(charge[i] - discharge[i]) <= capacity_kwh - initial_energy
  for (let h = 0; h < 24; h++) {
    constraints[`batt_energy_${h}`] = {
      min: minBatteryReserve[h] - battery.initial_energy_kwh,
      max: battery.capacity_kwh - battery.initial_energy_kwh,
    };
  }

  // End-of-day battery neutrality:
  // E[23] = initial_energy => sum_{i=0..23} (charge[i] - discharge[i]) = 0
  constraints['end_of_day_neutrality'] = {
    min: 0,
    max: 0,
  };

  // Populate decision variables
  for (let h = 0; h < 24; h++) {
    const tariff = hours[h].tariff_bdt_per_kwh;

    // Grid variable: grid_h
    const gridCoeffs = {
      cost: tariff,
      [`balance_${h}`]: 1,
    };
    if (Number.isFinite(maxGrid[h])) {
      gridCoeffs[`grid_limit_${h}`] = 1;
    }
    variables[`grid_${h}`] = gridCoeffs;

    // Solar used variable: solar_used_h (cost = 0)
    variables[`solar_${h}`] = {
      cost: 0,
      [`balance_${h}`]: 1,
      [`solar_limit_${h}`]: 1,
    };

    // Battery charge variable: charge_h
    // Negligible tie-breaker cost prevents unnecessary cycling
    const chargeCoeffs = {
      cost: 0.00001,
      [`balance_${h}`]: -1,
      [`charge_rate_${h}`]: 1,
    };
    for (let k = h; k < 24; k++) {
      chargeCoeffs[`batt_energy_${k}`] = 1;
    }
    chargeCoeffs['end_of_day_neutrality'] = 1;
    variables[`charge_${h}`] = chargeCoeffs;

    // Battery discharge variable: discharge_h
    const dischargeCoeffs = {
      cost: 0,
      [`balance_${h}`]: 1,
      [`discharge_rate_${h}`]: 1,
    };
    for (let k = h; k < 24; k++) {
      dischargeCoeffs[`batt_energy_${k}`] = -1;
    }
    dischargeCoeffs['end_of_day_neutrality'] = -1;
    variables[`discharge_${h}`] = dischargeCoeffs;
  }

  const model = {
    optimize: 'cost',
    opType: 'min',
    constraints,
    variables,
  };

  const solution = solver.Solve(model);

  if (!solution || !solution.feasible) {
    throw new Error('LP solver failed to find a feasible energy schedule');
  }

  // 3. Extract and construct clean 24-hour plan
  let currentEnergy = battery.initial_energy_kwh;
  const hourlyPlan = [];

  for (let h = 0; h < 24; h++) {
    const rawGrid = solution[`grid_${h}`] || 0;
    const rawSolar = solution[`solar_${h}`] || 0;
    const rawCharge = solution[`charge_${h}`] || 0;
    const rawDischarge = solution[`discharge_${h}`] || 0;

    // Net battery operation for hour h
    const netBattery = rawCharge - rawDischarge;
    let batteryAction = 'idle';
    let batteryKwh = 0;

    if (netBattery > 1e-6) {
      batteryAction = 'charge';
      batteryKwh = Math.round(netBattery * 100) / 100;
      currentEnergy += batteryKwh;
    } else if (netBattery < -1e-6) {
      batteryAction = 'discharge';
      batteryKwh = Math.round(-netBattery * 100) / 100;
      currentEnergy -= batteryKwh;
    } else {
      batteryAction = 'idle';
      batteryKwh = 0;
    }

    const solarUsed = Math.round(rawSolar * 100) / 100;
    const gridKwh = Math.round(rawGrid * 100) / 100;
    const energyAfter = Math.round(currentEnergy * 100) / 100;

    hourlyPlan.push({
      hour: h,
      grid_kwh: Math.max(0, gridKwh),
      solar_used_kwh: Math.max(0, solarUsed),
      battery_action: batteryAction,
      battery_kwh: batteryKwh,
      battery_energy_after_kwh: energyAfter,
    });
  }

  return hourlyPlan;
}

module.exports = {
  optimizeSchedule,
};
