const express = require('express');
const router = express.Router();
const upsService = require('../services/ups');

// Service code reference
const SERVICE_CODES = {
  '01': 'Next Day Air',
  '02': '2nd Day Air',
  '03': 'Ground',
  '12': '3 Day Select',
  '13': 'Next Day Air Saver',
  '14': 'UPS Next Day Air Early',
  '59': '2nd Day Air A.M.',
  '65': 'UPS Saver'
};

/**
 * POST /api/ups/rate
 * Get rate for a specific service (defaults to Ground)
 */
router.post('/rate', async (req, res, next) => {
  try {
    const {
      shipFromPostalCode,
      shipToPostalCode,
      weight,
      length,
      width,
      height,
      serviceCode = '03' // Default to Ground
    } = req.body;

    // Validation
    if (!shipFromPostalCode || !shipToPostalCode) {
      return res.status(400).json({ error: 'Origin and destination postal codes required' });
    }
    if (!weight || !length || !width || !height) {
      return res.status(400).json({ error: 'Package weight and dimensions required' });
    }

    const result = await upsService.getRate({
      shipFromPostalCode,
      shipToPostalCode,
      weight,
      length,
      width,
      height,
      serviceCode
    });

    // Parse and simplify response
    const ratedShipment = result.RateResponse?.RatedShipment;
    if (!ratedShipment) {
      return res.status(400).json({ error: 'No rates returned', raw: result });
    }

    res.json({
      service: SERVICE_CODES[serviceCode] || serviceCode,
      serviceCode,
      totalCharges: ratedShipment.TotalCharges?.MonetaryValue,
      currency: ratedShipment.TotalCharges?.CurrencyCode,
      billingWeight: ratedShipment.BillingWeight?.Weight,
      billingWeightUnit: ratedShipment.BillingWeight?.UnitOfMeasurement?.Code,
      raw: result
    });

  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/ups/shop
 * Get rates for ALL available services
 */
router.post('/shop', async (req, res, next) => {
  try {
    const {
      shipFromPostalCode,
      shipToPostalCode,
      weight,
      length,
      width,
      height
    } = req.body;

    // Validation
    if (!shipFromPostalCode || !shipToPostalCode) {
      return res.status(400).json({ error: 'Origin and destination postal codes required' });
    }
    if (!weight || !length || !width || !height) {
      return res.status(400).json({ error: 'Package weight and dimensions required' });
    }

    const result = await upsService.shopRates({
      shipFromPostalCode,
      shipToPostalCode,
      weight,
      length,
      width,
      height
    });

    // Parse and simplify response
    const ratedShipments = result.RateResponse?.RatedShipment;
    if (!ratedShipments) {
      return res.status(400).json({ error: 'No rates returned', raw: result });
    }

    // Normalize to array
    const shipments = Array.isArray(ratedShipments) ? ratedShipments : [ratedShipments];

    const rates = shipments.map(shipment => {
      const code = shipment.Service?.Code;
      const negotiated = shipment.NegotiatedRateCharges?.TotalCharge?.MonetaryValue;
      const published = shipment.TotalCharges?.MonetaryValue;
      return {
        service: SERVICE_CODES[code] || `Service ${code}`,
        serviceCode: code,
        totalCharges: negotiated || published,
        publishedCharges: published,
        negotiatedCharges: negotiated || null,
        currency: shipment.TotalCharges?.CurrencyCode,
        billingWeight: shipment.BillingWeight?.Weight,
        guaranteedDays: shipment.GuaranteedDelivery?.BusinessDaysInTransit || null
      };
    });

    // Sort by price (use negotiated if available)
    rates.sort((a, b) => parseFloat(a.totalCharges) - parseFloat(b.totalCharges));

    res.json({
      shipFrom: shipFromPostalCode,
      shipTo: shipToPostalCode,
      package: { weight, length, width, height },
      rates,
      rateCount: rates.length
    });

  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/ups/services
 * List available service codes
 */
router.get('/services', (req, res) => {
  res.json(SERVICE_CODES);
});

module.exports = router;
