const { query } = require('./index');

/**
 * Log a void attempt.
 */
async function insertVoid({ shipmentId, trackingNumber, success, reason, upsResponse }) {
  const { rows } = await query(
    `INSERT INTO shipment_voids (shipment_id, tracking_number, success, reason, ups_response)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [shipmentId || null, trackingNumber, success, reason || null, upsResponse ? JSON.stringify(upsResponse) : null]
  );
  return rows[0];
}

/**
 * Get void history for a tracking number.
 */
async function getByTrackingNumber(trackingNumber) {
  const { rows } = await query(
    'SELECT * FROM shipment_voids WHERE tracking_number = $1 ORDER BY created_at DESC',
    [trackingNumber]
  );
  return rows;
}

module.exports = { insertVoid, getByTrackingNumber };
