const app = require('../src/app');
const http = require('http');
const axios = require('axios');
const samplePack = require('./sampleData.json');

const server = http.createServer(app);

server.listen(3005, async () => {
  console.log('Test server started on http://localhost:3005');
  try {
    // 1. Test GET /health
    const healthRes = await axios.get('http://localhost:3005/health');
    console.log('GET /health response:', healthRes.status, healthRes.data);
    if (healthRes.status !== 200 || healthRes.data.status !== 'ok') {
      throw new Error('Health check failed');
    }

    // 2. Test POST /optimize-energy with SAMPLE-01
    const sampleInput = samplePack.cases[0].input;
    const optimizeRes = await axios.post('http://localhost:3005/optimize-energy', sampleInput);
    console.log('POST /optimize-energy status:', optimizeRes.status);
    console.log('Response Scenario ID:', optimizeRes.data.scenario_id);
    console.log('Directive count:', optimizeRes.data.directive_interpretation.length);
    console.log('Hourly plan entries:', optimizeRes.data.hourly_plan.length);
    console.log('Total Grid kWh:', optimizeRes.data.total_grid_kwh);
    console.log('Total Cost BDT:', optimizeRes.data.total_cost_bdt);
    console.log('Plan summary:', optimizeRes.data.plan_summary);

    if (optimizeRes.data.hourly_plan.length !== 24) {
      throw new Error('Hourly plan should contain 24 entries');
    }

    // 3. Test Invalid Request (e.g. missing hours) -> Expect 400
    try {
      await axios.post('http://localhost:3005/optimize-energy', { scenario_id: 'INVALID' });
      throw new Error('Expected 400 error for invalid request, but succeeded');
    } catch (err) {
      if (err.response && err.response.status === 400) {
        console.log('Invalid request successfully returned 400 Bad Request:', err.response.data);
      } else {
        throw err;
      }
    }

    console.log('\n[SUCCESS] All HTTP endpoints verified successfully!');
    server.close();
    process.exit(0);
  } catch (error) {
    console.error('[FAIL] HTTP API test error:', error.message);
    server.close();
    process.exit(1);
  }
});
