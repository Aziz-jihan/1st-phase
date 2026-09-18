require('dotenv').config();
const app = require('./app');

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`[GridWise Server] Service successfully running on port ${PORT}`);
  console.log(`[GridWise Server] Health endpoint: http://localhost:${PORT}/health`);
  console.log(`[GridWise Server] Main endpoint:   http://localhost:${PORT}/optimize-energy`);
});
