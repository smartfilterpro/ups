require('dotenv').config();
const express = require('express');
const cors = require('cors');
const upsRoutes = require('./routes/ups');
const shipmentsRoutes = require('./routes/shipments');
const db = require('./db/index');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    database: db.isConfigured() ? 'connected' : 'not configured',
  });
});

// UPS Routes
app.use('/api/ups', upsRoutes);

// Shipment data routes (requires database)
app.use('/api/shipments', shipmentsRoutes);

// Error handler
app.use((err, req, res, next) => {
  console.error('Error:', err.message);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error'
  });
});

async function start() {
  // Run database migrations if configured
  if (db.isConfigured()) {
    try {
      const { runMigrations } = require('./db/migrate');
      await runMigrations();
      console.log('[db] Database ready');

      // Start tracking poller
      const trackingPoller = require('./services/trackingPoller');
      trackingPoller.start();
    } catch (err) {
      console.error('[db] Database initialization failed:', err.message);
      console.log('[db] Continuing without database — shipment logging disabled');
    }
  } else {
    console.log('[db] DATABASE_URL not set — shipment logging disabled');
  }

  app.listen(PORT, () => {
    console.log(`UPS Rating API running on port ${PORT}`);
    console.log(`Environment: ${process.env.UPS_ENVIRONMENT || 'sandbox'}`);
  });
}

start();
