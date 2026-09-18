/**
 * Replays and validates the hourly plan against the physical rules and directives,
 * then recalculates totals and produces a plan summary.
 * 
 * @param {object} scenario - Input scenario { scenario_id, hours, battery, ... }
 * @param {Array} directives - Validated directive interpretations
 * @param {Array} hourlyPlan - Generated hourly plan (24 entries)
 * @returns {object} Final validated response object
 */
function replayAndComputeMetrics(scenario, directives, hourlyPlan) {
  const { scenario_id, hours, battery } = scenario;

  if (!Array.isArray(hourlyPlan) || hourlyPlan.length !== 24) {
    throw new Error(`hourly_plan must contain exactly 24 entries, got ${hourlyPlan?.length}`);
  }

  // Pre-calculate effective solar and minimum battery reserves per hour
  const effectiveSolar = hours.map((h) => h.solar_kwh);
  const minBatteryReserve = hours.map(() => battery.minimum_energy_kwh);
  const noChargeHours = new Set();
  const noDischargeHours = new Set();
  const maxGridLimits = hours.map(() => Infinity);

  for (const d of directives) {
    if (!d.applies || !d.structured_adjustment) continue;
    const adj = d.structured_adjustment;

    if (d.directive_type === 'solar_reduction') {
      for (const h of adj.hours) {
        effectiveSolar[h] = hours[h].solar_kwh * adj.factor;
      }
    } else if (d.directive_type === 'minimum_battery_reserve') {
      for (const h of adj.hours) {
        minBatteryReserve[h] = Math.max(minBatteryReserve[h], adj.minimum_energy_kwh);
      }
    } else if (d.directive_type === 'no_charge_window') {
      for (const h of adj.hours) noChargeHours.add(h);
    } else if (d.directive_type === 'no_discharge_window') {
      for (const h of adj.hours) noDischargeHours.add(h);
    } else if (d.directive_type === 'max_grid_window') {
      for (const h of adj.hours) {
        maxGridLimits[h] = Math.min(maxGridLimits[h], adj.max_grid_kwh);
      }
    }
  }

  let totalGridKwh = 0;
  let totalCostBdt = 0;
  let peakGridKwh = 0;
  let simulatedBatteryEnergy = battery.initial_energy_kwh;

  for (let h = 0; h < 24; h++) {
    const plan = hourlyPlan[h];
    const hourData = hours[h];

    if (plan.hour !== h) {
      throw new Error(`Invalid plan hour index at position ${h}. Expected ${h}, got ${plan.hour}`);
    }

    const gridKwh = plan.grid_kwh;
    const solarUsedKwh = plan.solar_used_kwh;
    const action = plan.battery_action;
    const batteryKwh = plan.battery_kwh;
    const energyAfter = plan.battery_energy_after_kwh;

    // 1. Solar usage check (allow 0.01 tolerance)
    if (solarUsedKwh > effectiveSolar[h] + 0.01) {
      throw new Error(`Hour ${h}: solar_used_kwh (${solarUsedKwh}) exceeds effective solar (${effectiveSolar[h]})`);
    }

    // 2. Battery action check
    let chargeAmount = 0;
    let dischargeAmount = 0;

    if (action === 'charge') {
      chargeAmount = batteryKwh;
      if (noChargeHours.has(h) && batteryKwh > 0.01) {
        throw new Error(`Hour ${h}: battery charged during no_charge_window`);
      }
      if (batteryKwh > battery.max_charge_kwh_per_hour + 0.01) {
        throw new Error(`Hour ${h}: charge amount exceeds max_charge limit`);
      }
      simulatedBatteryEnergy += batteryKwh;
    } else if (action === 'discharge') {
      dischargeAmount = batteryKwh;
      if (noDischargeHours.has(h) && batteryKwh > 0.01) {
        throw new Error(`Hour ${h}: battery discharged during no_discharge_window`);
      }
      if (batteryKwh > battery.max_discharge_kwh_per_hour + 0.01) {
        throw new Error(`Hour ${h}: discharge amount exceeds max_discharge limit`);
      }
      simulatedBatteryEnergy -= batteryKwh;
    } else if (action === 'idle') {
      if (batteryKwh !== 0) {
        throw new Error(`Hour ${h}: battery_kwh must be 0 when idle`);
      }
    } else {
      throw new Error(`Hour ${h}: invalid battery_action "${action}"`);
    }

    // 3. Battery bounds check
    if (simulatedBatteryEnergy < minBatteryReserve[h] - 0.01) {
      throw new Error(`Hour ${h}: battery energy (${simulatedBatteryEnergy}) drops below required minimum (${minBatteryReserve[h]})`);
    }
    if (simulatedBatteryEnergy > battery.capacity_kwh + 0.01) {
      throw new Error(`Hour ${h}: battery energy (${simulatedBatteryEnergy}) exceeds capacity (${battery.capacity_kwh})`);
    }

    // 4. Max grid check
    if (gridKwh > maxGridLimits[h] + 0.01) {
      throw new Error(`Hour ${h}: grid_kwh (${gridKwh}) exceeds max_grid_window limit (${maxGridLimits[h]})`);
    }

    // 5. Energy balance check: grid + solar_used + discharge = demand + charge
    const energySupplied = gridKwh + solarUsedKwh + dischargeAmount;
    const energyRequired = hourData.demand_kwh + chargeAmount;
    if (Math.abs(energySupplied - energyRequired) > 0.05) {
      throw new Error(`Hour ${h}: Energy balance violation. Supplied: ${energySupplied}, Required: ${energyRequired}`);
    }

    // Accumulate metrics
    totalGridKwh += gridKwh;
    totalCostBdt += gridKwh * hourData.tariff_bdt_per_kwh;
    if (gridKwh > peakGridKwh) {
      peakGridKwh = gridKwh;
    }
  }

  // 6. End-of-day battery neutrality check
  if (Math.abs(simulatedBatteryEnergy - battery.initial_energy_kwh) > 0.05) {
    throw new Error(
      `End-of-day battery neutrality violation: Final energy (${simulatedBatteryEnergy}) does not equal initial energy (${battery.initial_energy_kwh})`
    );
  }

  // Round summary metrics
  const roundedTotalGrid = Math.round(totalGridKwh * 100) / 100;
  const roundedTotalCost = Math.round(totalCostBdt * 100) / 100;
  const roundedPeakGrid = Math.round(peakGridKwh * 100) / 100;

  // Build a concise human-readable summary
  const appliedDirectives = directives.filter((d) => d.applies);
  const directiveSummary = appliedDirectives.length > 0
    ? `Incorporates ${appliedDirectives.map((d) => d.directive_type).join(', ')} constraints.`
    : 'Operates under standard constraints.';
  const planSummary = `${directiveSummary} Shifts battery storage toward peak tariff hours while strictly maintaining end-of-day battery neutrality.`;

  return {
    scenario_id,
    directive_interpretation: directives,
    hourly_plan: hourlyPlan,
    total_grid_kwh: roundedTotalGrid,
    total_cost_bdt: roundedTotalCost,
    peak_grid_kwh: roundedPeakGrid,
    plan_summary: planSummary,
  };
}

module.exports = {
  replayAndComputeMetrics,
};
