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
      shipFromStateCode,
      shipToPostalCode,
      shipToStateCode,
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
    if (!shipFromStateCode || !shipToStateCode) {
      return res.status(400).json({ error: 'Origin and destination state codes required (e.g., "MD", "CA")' });
    }
    if (!weight || !length || !width || !height) {
      return res.status(400).json({ error: 'Package weight and dimensions required' });
    }

    const result = await upsService.getRate({
      shipFromPostalCode,
      shipFromStateCode,
      shipToPostalCode,
      shipToStateCode,
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
      shipFromStateCode,
      shipToPostalCode,
      shipToStateCode,
      weight,
      length,
      width,
      height
    } = req.body;

    // Validation
    if (!shipFromPostalCode || !shipToPostalCode) {
      return res.status(400).json({ error: 'Origin and destination postal codes required' });
    }
    if (!shipFromStateCode || !shipToStateCode) {
      return res.status(400).json({ error: 'Origin and destination state codes required (e.g., "MD", "CA")' });
    }
    if (!weight || !length || !width || !height) {
      return res.status(400).json({ error: 'Package weight and dimensions required' });
    }

    const result = await upsService.shopRates({
      shipFromPostalCode,
      shipFromStateCode,
      shipToPostalCode,
      shipToStateCode,
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
      environment: process.env.UPS_ENVIRONMENT || 'sandbox',
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
 * Estimate filter weight based on dimensions (in lbs)
 * Air filters are mostly cardboard frame and pleated material
 */
function estimateFilterWeight(length, width, depth) {
  const volume = length * width * depth;
  // Base weight + volume factor (approx 0.002 lbs per cubic inch)
  return Math.round((0.3 + volume * 0.002) * 100) / 100;
}

/**
 * Pack filters into boxes with max 4" depth per box
 * Returns array of boxes with dimensions and weight
 */
function packFiltersIntoBoxes(filters) {
  const MAX_DEPTH = 4;
  const BOX_WEIGHT = 0.5; // Weight of cardboard box

  // Sort filters by depth descending (best-fit decreasing)
  const sorted = [...filters].sort((a, b) => b.depth - a.depth);

  const boxes = [];

  for (const filter of sorted) {
    // Try to fit in existing box
    let placed = false;
    for (const box of boxes) {
      if (box.currentDepth + filter.depth <= MAX_DEPTH) {
        box.filters.push(filter);
        box.currentDepth += filter.depth;
        box.length = Math.max(box.length, filter.length);
        box.width = Math.max(box.width, filter.width);
        box.weight += estimateFilterWeight(filter.length, filter.width, filter.depth);
        placed = true;
        break;
      }
    }

    // Create new box if doesn't fit
    if (!placed) {
      boxes.push({
        filters: [filter],
        length: filter.length,
        width: filter.width,
        currentDepth: filter.depth,
        weight: BOX_WEIGHT + estimateFilterWeight(filter.length, filter.width, filter.depth)
      });
    }
  }

  // Finalize box dimensions
  return boxes.map(box => ({
    dimensions: `${box.length}x${box.width}x${box.currentDepth}`,
    length: box.length,
    width: box.width,
    height: box.currentDepth,
    filterCount: box.filters.length,
    weight: Math.round(box.weight * 10) / 10
  }));
}

/**
 * POST /api/ups/quote
 * Get shipping quotes for multiple addresses with filter packing optimization
 */
router.post('/quote', async (req, res, next) => {
  try {
    const { shipments } = req.body;

    // Get ship-from from environment
    const shipFromPostalCode = process.env.SHIP_FROM_POSTAL_CODE;
    const shipFromStateCode = process.env.SHIP_FROM_STATE_CODE;

    if (!shipFromPostalCode || !shipFromStateCode) {
      return res.status(500).json({
        error: 'Ship-from address not configured. Set SHIP_FROM_POSTAL_CODE and SHIP_FROM_STATE_CODE environment variables.'
      });
    }

    if (!shipments || !Array.isArray(shipments) || shipments.length === 0) {
      return res.status(400).json({ error: 'shipments array is required' });
    }

    const results = [];
    const serviceTotals = {};

    for (const shipment of shipments) {
      const { address, filters } = shipment;

      if (!address?.postalCode || !address?.stateCode) {
        return res.status(400).json({ error: 'Each shipment requires address with postalCode and stateCode' });
      }

      if (!filters || !Array.isArray(filters) || filters.length === 0) {
        return res.status(400).json({ error: 'Each shipment requires a filters array' });
      }

      // Pack filters into boxes
      const boxes = packFiltersIntoBoxes(filters);

      // Get rates for each box
      const boxRates = [];
      for (const box of boxes) {
        const result = await upsService.shopRates({
          shipFromPostalCode,
          shipFromStateCode,
          shipToPostalCode: address.postalCode,
          shipToStateCode: address.stateCode,
          weight: box.weight,
          length: box.length,
          width: box.width,
          height: box.height
        });

        const ratedShipments = result.RateResponse?.RatedShipment;
        if (!ratedShipments) {
          boxRates.push({ box, error: 'No rates returned', raw: result });
          continue;
        }

        const shipmentArray = Array.isArray(ratedShipments) ? ratedShipments : [ratedShipments];
        const rates = {};

        for (const s of shipmentArray) {
          const code = s.Service?.Code;
          const serviceName = SERVICE_CODES[code] || `Service ${code}`;
          const negotiated = s.NegotiatedRateCharges?.TotalCharge?.MonetaryValue;
          const published = s.TotalCharges?.MonetaryValue;
          const cost = parseFloat(negotiated || published);

          rates[serviceName] = cost;
        }

        boxRates.push({ box, rates });
      }

      // Aggregate rates across all boxes for this address
      const addressRates = {};
      for (const br of boxRates) {
        if (br.rates) {
          for (const [service, cost] of Object.entries(br.rates)) {
            addressRates[service] = (addressRates[service] || 0) + cost;
          }
        }
      }

      // Round to 2 decimal places
      for (const service of Object.keys(addressRates)) {
        addressRates[service] = Math.round(addressRates[service] * 100) / 100;

        // Add to grand totals
        serviceTotals[service] = (serviceTotals[service] || 0) + addressRates[service];
      }

      results.push({
        address,
        boxes: boxes.map(b => ({ dimensions: b.dimensions, filterCount: b.filterCount, weight: b.weight })),
        rates: addressRates
      });
    }

    // Round grand totals
    for (const service of Object.keys(serviceTotals)) {
      serviceTotals[service] = Math.round(serviceTotals[service] * 100) / 100;
    }

    res.json({
      environment: process.env.UPS_ENVIRONMENT || 'sandbox',
      shipFrom: { postalCode: shipFromPostalCode, stateCode: shipFromStateCode },
      shipments: results,
      totalsByService: serviceTotals
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

/**
 * GET /api/ups/debug
 * Show current environment configuration
 */
router.get('/debug', (req, res) => {
  const env = process.env.UPS_ENVIRONMENT || 'sandbox';
  const baseUrl = env === 'production'
    ? 'https://onlinetools.ups.com'
    : 'https://wwwcie.ups.com';

  res.json({
    environment: env,
    baseUrl: baseUrl,
    accountNumber: process.env.UPS_ACCOUNT_NUMBER ? '***' + process.env.UPS_ACCOUNT_NUMBER.slice(-4) : 'NOT SET',
    clientIdSet: !!process.env.UPS_CLIENT_ID,
    clientSecretSet: !!process.env.UPS_CLIENT_SECRET
  });
});

module.exports = router;
