const express = require('express');
const cors = require('cors');
const healthRoutes = require('./routes/health.routes');
const energyRoutes = require('./routes/energy.routes');

const app = express();

// Middlewares
app.use(cors());
app.use(express.json({ limit: '2mb' }));

// Handle malformed JSON error
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ error: 'Malformed JSON payload' });
  }
  next(err);
});

// Routes
app.use('/', healthRoutes);
app.use('/', energyRoutes);

// Catch 404
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

module.exports = app;
