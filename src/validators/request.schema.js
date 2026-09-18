const { z } = require('zod');

const hourSchema = z.object({
  hour: z.number().int().min(0).max(23),
  demand_kwh: z.number().nonnegative(),
  solar_kwh: z.number().nonnegative(),
  tariff_bdt_per_kwh: z.number().nonnegative(),
});

const batterySchema = z.object({
  capacity_kwh: z.number().positive(),
  initial_energy_kwh: z.number().nonnegative(),
  minimum_energy_kwh: z.number().nonnegative(),
  max_charge_kwh_per_hour: z.number().nonnegative(),
  max_discharge_kwh_per_hour: z.number().nonnegative(),
});

const optimizeEnergyRequestSchema = z.object({
  scenario_id: z.string().min(1),
  operator_notes: z.array(z.string().min(1)).min(1).max(3),
  hours: z.array(hourSchema).length(24).refine((hours) => {
    const hourSet = new Set(hours.map((h) => h.hour));
    return hourSet.size === 24 && hours.every((h, idx) => h.hour === idx);
  }, {
    message: 'hours array must contain exactly 24 unique entries for hours 0 through 23 in order',
  }),
  battery: batterySchema.refine((b) => b.initial_energy_kwh <= b.capacity_kwh, {
    message: 'initial_energy_kwh cannot exceed capacity_kwh',
  }).refine((b) => b.minimum_energy_kwh <= b.capacity_kwh, {
    message: 'minimum_energy_kwh cannot exceed capacity_kwh',
  }),
});

module.exports = {
  optimizeEnergyRequestSchema,
};
