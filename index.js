require('dotenv').config();
const express = require('express');
const cors = require('cors');
const upsRoutes = require('./routes/ups');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// UPS Routes
app.use('/api/ups', upsRoutes);

// Error handler
app.use((err, req, res, next) => {
  console.error('Error:', err.message);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error'
  });
});

app.listen(PORT, () => {
  console.log(`UPS Rating API running on port ${PORT}`);
  console.log(`Environment: ${process.env.UPS_ENVIRONMENT || 'sandbox'}`);
});
