const express = require('express');
const router = express.Router();
const db = require('../db/index');
const shipmentsDb = require('../db/shipments');
const trackingEventsDb = require('../db/trackingEvents');
const rateQuotesDb = require('../db/rateQuotes');
const { pollSingleShipment } = require('../services/trackingPoller');

// Middleware: require database
router.use((req, res, next) => {
  if (!db.isConfigured()) {
    return res.status(503).json({ error: 'Database not configured. Set DATABASE_URL.' });
  }
  next();
});

/**
 * GET /api/shipments — List shipments with optional filters
 * Query params: status, limit, offset, orderId
 */
router.get('/', async (req, res, next) => {
  try {
    const { status, limit, offset, orderId } = req.query;
    const shipments = await shipmentsDb.getShipments({
      status,
      limit: parseInt(limit) || 50,
      offset: parseInt(offset) || 0,
      bubbleOrderId: orderId,
    });
    res.json({ count: shipments.length, shipments });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/shipments/stats — Shipment summary statistics
 */
router.get('/stats', async (req, res, next) => {
  try {
    const stats = await shipmentsDb.getStats();
    res.json(stats);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/shipments/tracking/:trackingNumber — Get shipment + tracking history
 */
router.get('/tracking/:trackingNumber', async (req, res, next) => {
  try {
    const { trackingNumber } = req.params;
    const shipment = await shipmentsDb.getByTrackingNumber(trackingNumber);
    if (!shipment) {
      return res.status(404).json({ error: `Shipment ${trackingNumber} not found` });
    }

    const events = await trackingEventsDb.getByTrackingNumber(trackingNumber);
    res.json({ shipment, trackingEvents: events });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/shipments/tracking/:trackingNumber/poll — Force a tracking update
 */
router.post('/tracking/:trackingNumber/poll', async (req, res, next) => {
  try {
    const { trackingNumber } = req.params;
    const shipment = await shipmentsDb.getByTrackingNumber(trackingNumber);
    if (!shipment) {
      return res.status(404).json({ error: `Shipment ${trackingNumber} not found` });
    }

    await pollSingleShipment(shipment);

    // Return updated shipment + events
    const updated = await shipmentsDb.getByTrackingNumber(trackingNumber);
    const events = await trackingEventsDb.getByTrackingNumber(trackingNumber);
    res.json({ shipment: updated, trackingEvents: events });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/shipments/tracking-events/recent — Recent tracking events across all shipments
 */
router.get('/tracking-events/recent', async (req, res, next) => {
  try {
    const events = await trackingEventsDb.getRecent(parseInt(req.query.limit) || 50);
    res.json({ count: events.length, events });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/shipments/quotes — Recent rate quotes
 */
router.get('/quotes', async (req, res, next) => {
  try {
    const quotes = await rateQuotesDb.getRecent(parseInt(req.query.limit) || 50);
    res.json({ count: quotes.length, quotes });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/shipments/quotes/stats — Rate quote analytics
 */
router.get('/quotes/stats', async (req, res, next) => {
  try {
    const stats = await rateQuotesDb.getQuoteStats(parseInt(req.query.days) || 30);
    res.json(stats);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
