const { query } = require('./index');

/**
 * Insert a tracking event from UPS polling.
 * Deduplicates by tracking_number + activity_timestamp + status_code.
 */
async function insertEvent({
  shipmentId, trackingNumber,
  statusCode, statusType, statusDescription,
  locationCity, locationState, locationCountry,
  activityTimestamp,
}) {
  // Skip if we already have this exact event
  const { rows: existing } = await query(
    `SELECT id FROM tracking_events
     WHERE tracking_number = $1 AND activity_timestamp = $2 AND status_code = $3
     LIMIT 1`,
    [trackingNumber, activityTimestamp, statusCode]
  );
  if (existing.length > 0) return null;

  const { rows } = await query(
    `INSERT INTO tracking_events (
      shipment_id, tracking_number,
      status_code, status_type, status_description,
      location_city, location_state, location_country,
      activity_timestamp
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    RETURNING *`,
    [
      shipmentId, trackingNumber,
      statusCode || null, statusType || null, statusDescription || null,
      locationCity || null, locationState || null, locationCountry || null,
      activityTimestamp || null,
    ]
  );
  return rows[0];
}

/**
 * Get tracking history for a shipment.
 */
async function getByTrackingNumber(trackingNumber) {
  const { rows } = await query(
    `SELECT * FROM tracking_events
     WHERE tracking_number = $1
     ORDER BY activity_timestamp DESC`,
    [trackingNumber]
  );
  return rows;
}

/**
 * Get recent tracking events across all shipments.
 */
async function getRecent(limit = 50) {
  const { rows } = await query(
    `SELECT te.*, s.ship_to_name, s.ship_to_city, s.ship_to_state
     FROM tracking_events te
     LEFT JOIN shipments s ON s.id = te.shipment_id
     ORDER BY te.polled_at DESC
     LIMIT $1`,
    [Math.min(limit, 100)]
  );
  return rows;
}

module.exports = { insertEvent, getByTrackingNumber, getRecent };
