const express = require('express');
const router = express.Router();
const upsService = require('../services/ups');
const receiptService = require('../services/receipt');

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
 * Parse address string to extract full address components
 * Format: "Street, City, ST, ZIPCODE" or "Street, City, ST, ZIPCODE-XXXX"
 * Returns: { street, city, state, postalCode, raw }
 */
function parseAddress(addressStr) {
  // Match: Street, City, ST, ZIPCODE
  // Example: "934 South Clinton Street,  Baltimore, MD, 21224-5023"
  const match = addressStr.match(/^(.+),\s*(.+),\s*([A-Z]{2}),\s*(\d{5}(?:-\d{4})?)$/);
  if (match) {
    return {
      street: match[1].trim(),
      city: match[2].trim(),
      state: match[3],
      postalCode: match[4].substring(0, 5), // Use 5-digit zip
      raw: addressStr
    };
  }
  return null;
}

/**
 * Split concatenated addresses string into individual addresses
 * Addresses are separated by the pattern: zip code followed by comma and space
 */
function splitAddresses(addressesStr) {
  // Find all zip codes with their positions
  const zipPattern = /(\d{5}(?:-\d{4})?)/g;
  const matches = [...addressesStr.matchAll(zipPattern)];

  if (matches.length === 0) return [];
  if (matches.length === 1) return [addressesStr];

  // Split after each zip code (except the last one)
  const addresses = [];
  let lastEnd = 0;

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const zipEnd = match.index + match[0].length;

    // Check if there's a comma after this zip (indicating another address follows)
    const afterZip = addressesStr.substring(zipEnd, zipEnd + 2);
    if (afterZip.startsWith(',') && i < matches.length - 1) {
      // This zip ends an address
      addresses.push(addressesStr.substring(lastEnd, zipEnd).trim());
      // Skip the comma and space
      lastEnd = zipEnd + 1;
      while (lastEnd < addressesStr.length && addressesStr[lastEnd] === ' ') {
        lastEnd++;
      }
    }
  }

  // Add the last address
  if (lastEnd < addressesStr.length) {
    addresses.push(addressesStr.substring(lastEnd).trim());
  }

  return addresses;
}

/**
 * Parse filters string and group by address using (N) numbering
 * When number restarts at (1) or HVAC ID changes, it's a new address group
 */
function parseFilters(filtersStr) {
  const filterParts = filtersStr.split(/,\s*(?=\(\d+\))/);
  const groups = [];
  let currentGroup = [];
  let lastNumber = 0;
  let lastHvacId = null;

  for (const part of filterParts) {
    // Extract number and HVAC ID
    const numMatch = part.match(/^\s*\((\d+)\)/);
    const hvacMatch = part.match(/HVAC ID:\s*([A-Z0-9-]+)/i);

    const num = numMatch ? parseInt(numMatch[1]) : 0;
    const hvacId = hvacMatch ? hvacMatch[1] : null;

    // Check if this is a new address group (fix operator precedence)
    const isNewGroup = currentGroup.length > 0 &&
      ((num === 1 && lastNumber >= 1) || (hvacId && lastHvacId && hvacId !== lastHvacId));

    if (isNewGroup) {
      groups.push(currentGroup);
      currentGroup = [];
    }

    currentGroup.push({ raw: part, number: num, hvacId });
    lastNumber = num;
    lastHvacId = hvacId;
  }

  if (currentGroup.length > 0) {
    groups.push(currentGroup);
  }

  return groups;
}

/**
 * Parse filter size string (e.g., "16x20x1")
 * Returns: { length, width, depth }
 */
function parseFilterSize(sizeStr) {
  const parts = sizeStr.trim().split('x').map(s => parseFloat(s));
  if (parts.length === 3) {
    return { length: parts[0], width: parts[1], depth: parts[2] };
  }
  return null;
}

/**
 * POST /api/ups/quote
 * Get shipping quotes for multiple addresses with filter packing optimization
 *
 * Accepts three formats:
 *
 * Format 1 - Combined filter string (recommended for Bubble):
 * {
 *   "filters": "(1)ID - HVAC ID: xxx - Address: 123 Main St, City, ST, 12345 - size: 16x24x1;;(2)ID - HVAC ID: xxx - Address: 123 Main St, City, ST, 12345 - size: 16x20x1"
 * }
 *
 * Format 2 - Delimited strings:
 * {
 *   "addresses": "addr1 ;; addr1 ;; addr2",
 *   "sizes": "16x20x1, 16x20x2, 20x25x1"
 * }
 *
 * Format 3 - Arrays:
 * {
 *   "addresses": ["addr1", "addr1", "addr2"],
 *   "sizes": ["16x20x1", "16x20x2", "20x25x1"]
 * }
 *
 * - The API groups filters by address automatically
 */
router.post('/quote', async (req, res, next) => {
  try {
    let { addresses, sizes, filters } = req.body;

    // Get ship-from from environment
    const shipFromPostalCode = process.env.SHIP_FROM_POSTAL_CODE;
    const shipFromStateCode = process.env.SHIP_FROM_STATE_CODE;

    if (!shipFromPostalCode || !shipFromStateCode) {
      return res.status(500).json({
        error: 'Ship-from address not configured. Set SHIP_FROM_POSTAL_CODE and SHIP_FROM_STATE_CODE environment variables.'
      });
    }

    let addressList = [];
    let sizeList = [];

    // Format 1: Combined filter string with embedded address and size
    // Example: "(1)ID - HVAC ID: xxx - Address: 123 Main, City, ST, 12345 - size: 16x24x1;;(2)..."
    if (filters && typeof filters === 'string' && filters.trim() !== '') {
      const filterEntries = filters.split(';;').map(f => f.trim()).filter(f => f.length > 0);

      for (const entry of filterEntries) {
        // Extract address: look for "Address: " followed by content until " - size:"
        const addressMatch = entry.match(/Address:\s*(.+?)\s*-\s*size:/i);
        // Extract size: look for "size: " followed by dimensions like "16x24x1"
        const sizeMatch = entry.match(/size:\s*(\d+x\d+x\d+)/i);

        if (!addressMatch) {
          return res.status(400).json({
            error: 'Could not parse address from filter entry',
            invalidEntry: entry,
            hint: 'Expected format: ... Address: Street, City, ST, ZIP - size: LxWxD'
          });
        }
        if (!sizeMatch) {
          return res.status(400).json({
            error: 'Could not parse size from filter entry',
            invalidEntry: entry,
            hint: 'Expected format: ... - size: LxWxD (e.g., 16x20x1)'
          });
        }

        addressList.push(addressMatch[1].trim());
        sizeList.push(sizeMatch[1].trim());
      }
    }
    // Format 2 & 3: Separate addresses and sizes (array or string)
    else {
      // Handle both array and string inputs for addresses
      if (Array.isArray(addresses)) {
        addressList = addresses.map(a => String(a).trim()).filter(a => a.length > 0);
      } else if (typeof addresses === 'string' && addresses.trim() !== '') {
        addressList = addresses.split(';;').map(a => a.trim()).filter(a => a.length > 0);
      } else {
        return res.status(400).json({
          error: 'Either "filters" string or "addresses" + "sizes" are required',
          hint: 'Use filters param with combined string, or addresses/sizes params separately'
        });
      }

      // Handle both array and string inputs for sizes
      if (Array.isArray(sizes)) {
        sizeList = sizes.map(s => String(s).trim()).filter(s => s.length > 0);
      } else if (typeof sizes === 'string' && sizes.trim() !== '') {
        sizeList = sizes.split(',').map(s => s.trim()).filter(s => s.length > 0);
      } else {
        return res.status(400).json({ error: 'sizes is required when using addresses param (accepts string with , separator or array)' });
      }
    }

    if (addressList.length === 0) {
      return res.status(400).json({ error: 'No valid addresses provided' });
    }
    if (sizeList.length === 0) {
      return res.status(400).json({ error: 'No valid filter sizes provided' });
    }

    if (addressList.length !== sizeList.length) {
      return res.status(400).json({
        error: `Address count (${addressList.length}) doesn't match size count (${sizeList.length})`,
        debug: { addressCount: addressList.length, sizeCount: sizeList.length, addresses: addressList, sizes: sizeList }
      });
    }

    // Group filters by address
    const addressGroups = {};
    for (let i = 0; i < addressList.length; i++) {
      const addr = addressList[i];
      const size = parseFilterSize(sizeList[i]);

      if (!size) {
        return res.status(400).json({
          error: `Invalid filter size at position ${i}`,
          invalidSize: sizeList[i]
        });
      }

      if (!addressGroups[addr]) {
        addressGroups[addr] = [];
      }
      addressGroups[addr].push(size);
    }

    const results = [];
    const serviceTotals = {};

    for (const [addressStr, filterSizes] of Object.entries(addressGroups)) {
      // Parse address to get state and zip
      const address = parseAddress(addressStr);
      if (!address) {
        return res.status(400).json({
          error: 'Could not parse address. Expected format: Street, City, ST, ZIPCODE',
          invalidAddress: addressStr
        });
      }

      // Pack filters into boxes
      const boxes = packFiltersIntoBoxes(filterSizes);

      // Get rates for each box
      const boxRates = [];
      for (const box of boxes) {
        const result = await upsService.shopRates({
          shipFromPostalCode,
          shipFromStateCode,
          shipToPostalCode: address.postalCode,
          shipToStateCode: address.state,
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

          rates[serviceName] = {
            serviceCode: code,
            cost: cost
          };
        }

        boxRates.push({ box, rates });
      }

      // Aggregate rates across all boxes for this address
      const addressRates = {};
      for (const br of boxRates) {
        if (br.rates) {
          for (const [service, rateInfo] of Object.entries(br.rates)) {
            if (!addressRates[service]) {
              addressRates[service] = { serviceCode: rateInfo.serviceCode, cost: 0 };
            }
            addressRates[service].cost += rateInfo.cost;
          }
        }
      }

      // Round to 2 decimal places
      for (const service of Object.keys(addressRates)) {
        addressRates[service].cost = Math.round(addressRates[service].cost * 100) / 100;

        // Add to grand totals
        if (!serviceTotals[service]) {
          serviceTotals[service] = { serviceCode: addressRates[service].serviceCode, cost: 0 };
        }
        serviceTotals[service].cost += addressRates[service].cost;
      }

      results.push({
        address,
        filterCount: filterSizes.length,
        boxCount: boxes.length,
        boxes: boxes.map(b => ({
          dimensions: b.dimensions,
          length: b.length,
          width: b.width,
          height: b.height,
          filterCount: b.filterCount,
          weight: b.weight
        })),
        rates: addressRates
      });
    }

    // Round grand totals
    for (const service of Object.keys(serviceTotals)) {
      serviceTotals[service].cost = Math.round(serviceTotals[service].cost * 100) / 100;
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

/**
 * POST /api/ups/ship
 * Create shipments and get shipping labels
 *
 * Supports multiple addresses - filters are grouped by address automatically.
 *
 * REQUEST FORMAT:
 * {
 *   "shipToName": "John Doe",
 *   "shipToPhone": "5551234567",
 *   "filters": "(1)123x456 - HVAC ID: ... - Address: 934 South Clinton Street, Baltimore, MD, 21224-5023 - size: 16x24x1;;(2)..."
 * }
 *
 * RESPONSE FORMAT:
 * {
 *   "success": true,
 *   "totalAddresses": 2,
 *   "totalBoxes": 5,
 *   "totalCharges": { "amount": 45.00, "currency": "USD" },
 *   "addresses": [
 *     {
 *       "address": { "street": "...", "city": "...", "state": "...", "postalCode": "..." },
 *       "filterCount": 3,
 *       "boxCount": 2,
 *       "charges": { "amount": 25.00, "currency": "USD" },
 *       "shipments": [
 *         { "trackingNumber": "1Z...", "box": {...}, "label": {...} }
 *       ]
 *     }
 *   ]
 * }
 */
router.post('/ship', async (req, res, next) => {
  try {
    const {
      // Filters string (from Bubble)
      filters,

      // Ship To (required)
      shipToName,
      shipToPhone,
      shipToCountryCode = 'US',

      // Ship From (optional - use env vars as defaults)
      shipFromName = process.env.SHIP_FROM_NAME || 'SmartFilterPro',
      shipFromCompany = process.env.SHIP_FROM_COMPANY || 'SmartFilterPro',
      shipFromPhone = process.env.SHIP_FROM_PHONE || '0000000000',
      shipFromAddress = process.env.SHIP_FROM_ADDRESS,
      shipFromCity = process.env.SHIP_FROM_CITY,
      shipFromStateCode = process.env.SHIP_FROM_STATE_CODE,
      shipFromPostalCode = process.env.SHIP_FROM_POSTAL_CODE,
      shipFromCountryCode = 'US',

      // Label
      labelFormat = 'GIF'
    } = req.body;

    // Always use Ground shipping
    const serviceCode = '03';

    // Validate ship-from
    if (!shipFromAddress || !shipFromCity || !shipFromStateCode || !shipFromPostalCode) {
      return res.status(400).json({
        error: 'Ship-from address not configured. Set SHIP_FROM_ADDRESS, SHIP_FROM_CITY, SHIP_FROM_STATE_CODE, SHIP_FROM_POSTAL_CODE environment variables.'
      });
    }

    // Validate recipient info
    if (!shipToName || !shipToPhone) {
      return res.status(400).json({
        error: 'Recipient details required: shipToName, shipToPhone'
      });
    }

    // Validate filters
    if (!filters) {
      return res.status(400).json({
        error: 'filters field is required'
      });
    }

    // Parse filters string to extract addresses and sizes
    // Format: "(1)ID - HVAC ID: ... - Address: Street, City, ST, ZIP - size: LxWxH;;(2)..."
    const filterEntries = filters.split(';;').map(f => f.trim()).filter(f => f.length > 0);

    if (filterEntries.length === 0) {
      return res.status(400).json({ error: 'No filters found in filters string' });
    }

    // Group filters by address
    const filtersByAddress = {};

    for (const entry of filterEntries) {
      // Extract address: look for "- Address: " followed by the address until " - size:"
      const addressMatch = entry.match(/- Address:\s*(.+?)\s*- size:/i);
      // Extract size: look for "- size: " followed by dimensions
      const sizeMatch = entry.match(/- size:\s*(\d+x\d+x\d+)/i);

      if (addressMatch && sizeMatch) {
        const addressRaw = addressMatch[1].trim();
        const size = sizeMatch[1];

        if (!filtersByAddress[addressRaw]) {
          filtersByAddress[addressRaw] = [];
        }
        filtersByAddress[addressRaw].push(size);
      }
    }

    const addressKeys = Object.keys(filtersByAddress);
    if (addressKeys.length === 0) {
      return res.status(400).json({
        error: 'Could not parse addresses/sizes from filters string',
        hint: 'Expected format: "- Address: Street, City, ST, ZIP - size: LxWxH"'
      });
    }

    // Process each address
    const addressResults = [];
    let totalBoxCount = 0;
    let grandTotalCharges = 0;

    for (const addressRaw of addressKeys) {
      const sizes = filtersByAddress[addressRaw];

      // Parse the address
      const parsedAddress = parseAddress(addressRaw);
      if (!parsedAddress) {
        addressResults.push({
          error: 'Could not parse address',
          invalidAddress: addressRaw
        });
        continue;
      }

      // Parse filter sizes for this address
      const filterSizes = sizes.map(s => parseFilterSize(s)).filter(s => s !== null);
      if (filterSizes.length === 0) {
        addressResults.push({
          error: 'No valid filter sizes found',
          address: addressRaw
        });
        continue;
      }

      // Pack filters into boxes
      const boxesToShip = packFiltersIntoBoxes(filterSizes);
      totalBoxCount += boxesToShip.length;

      // Create shipments for each box at this address
      const shipmentResults = [];
      let addressCharges = 0;

      for (const box of boxesToShip) {
        const result = await upsService.createShipment({
          shipFromName,
          shipFromCompany,
          shipFromPhone,
          shipFromAddress,
          shipFromCity,
          shipFromStateCode,
          shipFromPostalCode,
          shipFromCountryCode,
          shipToName,
          shipToPhone,
          shipToAddress: parsedAddress.street,
          shipToCity: parsedAddress.city,
          shipToStateCode: parsedAddress.state,
          shipToPostalCode: parsedAddress.postalCode,
          shipToCountryCode,
          weight: box.weight,
          weightUnit: 'LBS',
          length: box.length,
          width: box.width,
          height: box.height,
          dimensionUnit: 'IN',
          serviceCode,
          labelFormat
        });

        const shipmentResponse = result.ShipmentResponse?.ShipmentResults;
        if (!shipmentResponse) {
          shipmentResults.push({ error: 'Shipment creation failed', raw: result });
          continue;
        }

        const packageResults = shipmentResponse.PackageResults;
        const firstPackage = Array.isArray(packageResults) ? packageResults[0] : packageResults;
        const chargeAmount = parseFloat(shipmentResponse.ShipmentCharges?.TotalCharges?.MonetaryValue || 0);
        addressCharges += chargeAmount;

        shipmentResults.push({
          trackingNumber: firstPackage?.TrackingNumber,
          box: {
            dimensions: `${box.length}x${box.width}x${box.height}`,
            weight: box.weight,
            filterCount: box.filterCount
          },
          charges: {
            amount: chargeAmount,
            currency: shipmentResponse.ShipmentCharges?.TotalCharges?.CurrencyCode || 'USD'
          },
          label: {
            format: labelFormat,
            image: firstPackage?.ShippingLabel?.GraphicImage
          }
        });
      }

      grandTotalCharges += addressCharges;

      addressResults.push({
        address: {
          street: parsedAddress.street,
          city: parsedAddress.city,
          state: parsedAddress.state,
          postalCode: parsedAddress.postalCode,
          raw: addressRaw
        },
        filterCount: filterSizes.length,
        boxCount: boxesToShip.length,
        charges: {
          amount: Math.round(addressCharges * 100) / 100,
          currency: 'USD'
        },
        shipments: shipmentResults
      });
    }

    res.json({
      success: true,
      service: SERVICE_CODES[serviceCode] || serviceCode,
      serviceCode,
      shipToName,
      shipToPhone,
      totalAddresses: addressKeys.length,
      totalBoxes: totalBoxCount,
      totalCharges: {
        amount: Math.round(grandTotalCharges * 100) / 100,
        currency: 'USD'
      },
      addresses: addressResults
    });

  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/ups/void
 * Void/cancel a shipment by tracking number
 *
 * Can void single or multiple tracking numbers.
 * Shipments can only be voided within 24 hours of creation (before pickup).
 *
 * REQUEST FORMAT (single):
 * { "trackingNumber": "1Z..." }
 *
 * REQUEST FORMAT (multiple):
 * { "trackingNumbers": ["1Z...", "1Z...", "1Z..."] }
 *
 * RESPONSE FORMAT:
 * {
 *   "success": true,
 *   "voided": [
 *     { "trackingNumber": "1Z...", "status": "Voided" }
 *   ],
 *   "failed": []
 * }
 */
router.post('/void', async (req, res, next) => {
  try {
    const { trackingNumber, trackingNumbers } = req.body;

    // Build list of tracking numbers to void
    let numbersToVoid = [];
    if (trackingNumbers && Array.isArray(trackingNumbers)) {
      numbersToVoid = trackingNumbers;
    } else if (trackingNumber) {
      numbersToVoid = [trackingNumber];
    }

    if (numbersToVoid.length === 0) {
      return res.status(400).json({
        error: 'trackingNumber or trackingNumbers required'
      });
    }

    const voided = [];
    const failed = [];

    for (const tn of numbersToVoid) {
      try {
        const result = await upsService.voidShipment(tn);

        // Check if void was successful
        const voidResponse = result.VoidShipmentResponse;
        const status = voidResponse?.SummaryResult?.Status?.Description || 'Voided';

        voided.push({
          trackingNumber: tn,
          status: status
        });
      } catch (error) {
        failed.push({
          trackingNumber: tn,
          error: error.message
        });
      }
    }

    res.json({
      success: failed.length === 0,
      totalRequested: numbersToVoid.length,
      totalVoided: voided.length,
      totalFailed: failed.length,
      voided,
      failed
    });

  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/ups/receipt
 * Generate a packing slip receipt image (4x6 thermal label size)
 *
 * REQUEST FORMAT:
 * {
 *   "shipToName": "John Doe",
 *   "shipToAddress": "934 South Clinton Street",
 *   "shipToCity": "Baltimore",
 *   "shipToState": "MD",
 *   "shipToZip": "21224",
 *   "items": [
 *     { "filter": "MERV 8 Standard", "qty": 2 },
 *     { "filter": "MERV 11 Allergen", "qty": 1 }
 *   ],
 *   "boxNumber": 1,
 *   "totalBoxes": 2,
 *   "orderDate": "01/15/2024",
 *   "orderNumber": "ORD-12345"
 * }
 *
 * RESPONSE FORMAT:
 * {
 *   "success": true,
 *   "receipt": {
 *     "format": "SVG",
 *     "image": "base64..."
 *   }
 * }
 *
 * Display in Bubble: data:image/svg+xml;base64,{image}
 */
router.post('/receipt', async (req, res, next) => {
  try {
    const {
      shipToName,
      shipToAddress,
      shipToCity,
      shipToState,
      shipToZip,
      items = [],
      boxNumber,
      totalBoxes,
      orderDate,
      orderNumber
    } = req.body;

    // Validate required fields
    if (!shipToName) {
      return res.status(400).json({ error: 'shipToName is required' });
    }

    // Generate receipt SVG
    const result = await receiptService.generateReceipt({
      shipToName,
      shipToAddress,
      shipToCity,
      shipToState,
      shipToZip,
      items,
      boxNumber,
      totalBoxes,
      orderDate,
      orderNumber
    });

    res.json({
      success: true,
      receipt: {
        format: 'SVG',
        image: result.svg
      }
    });

  } catch (error) {
    next(error);
  }
});

module.exports = router;
