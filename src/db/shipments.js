const { query } = require('./index');

/**
 * Insert a new shipment record after UPS label creation.
 */
async function insertShipment({
  trackingNumber, serviceCode, serviceName, bubbleOrderId,
  shipToName, shipToPhone, shipToAddress, shipToCity, shipToState, shipToPostalCode, shipToCountryCode,
  shipFromPostalCode,
  boxLength, boxWidth, boxHeight, boxWeight,
  filterCount, filterIds, chargesAmount, chargesCurrency, labelFormat,
  estimatedDeliveryDate,
}) {
  const { rows } = await query(
    `INSERT INTO shipments (
      tracking_number, service_code, service_name, bubble_order_id,
      ship_to_name, ship_to_phone, ship_to_address, ship_to_city, ship_to_state, ship_to_postal_code, ship_to_country_code,
      ship_from_postal_code,
      box_length, box_width, box_height, box_weight,
      filter_count, filter_ids, charges_amount, charges_currency, label_format,
      estimated_delivery_date
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
    RETURNING *`,
    [
      trackingNumber, serviceCode, serviceName, bubbleOrderId || null,
      shipToName, shipToPhone || null, shipToAddress, shipToCity, shipToState, shipToPostalCode, shipToCountryCode || 'US',
      shipFromPostalCode,
      boxLength, boxWidth, boxHeight, boxWeight,
      filterCount, filterIds || null, chargesAmount, chargesCurrency || 'USD', labelFormat || 'GIF',
      estimatedDeliveryDate || null,
    ]
  );
  return rows[0];
}

/**
 * Update shipment status (e.g., in_transit, delivered, exception, voided).
 */
async function updateShipmentStatus(trackingNumber, status, extra = {}) {
  const sets = ['status = $2', 'updated_at = NOW()'];
  const params = [trackingNumber, status];
  let idx = 3;

  if (extra.deliveredAt) {
    sets.push(`delivered_at = $${idx++}`);
    params.push(extra.deliveredAt);
  }
  if (extra.voidedAt) {
    sets.push(`voided_at = $${idx++}`);
    params.push(extra.voidedAt);
  }

  const { rows } = await query(
    `UPDATE shipments SET ${sets.join(', ')} WHERE tracking_number = $1 RETURNING *`,
    params
  );
  return rows[0];
}

/**
 * Get a shipment by tracking number.
 */
async function getByTrackingNumber(trackingNumber) {
  const { rows } = await query('SELECT * FROM shipments WHERE tracking_number = $1', [trackingNumber]);
  return rows[0] || null;
}

/**
 * Get shipments that need tracking updates.
 * Excludes delivered, voided, and returned shipments.
 */
async function getActiveShipments() {
  const { rows } = await query(
    `SELECT * FROM shipments
     WHERE status NOT IN ('delivered', 'voided', 'returned', 'exception_resolved')
     ORDER BY created_at DESC`
  );
  return rows;
}

/**
 * Get recent shipments with optional filters.
 */
async function getShipments({ status, limit = 50, offset = 0, bubbleOrderId } = {}) {
  const conditions = [];
  const params = [];
  let idx = 1;

  if (status) {
    conditions.push(`status = $${idx++}`);
    params.push(status);
  }
  if (bubbleOrderId) {
    conditions.push(`bubble_order_id = $${idx++}`);
    params.push(bubbleOrderId);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(Math.min(limit, 100), offset);

  const { rows } = await query(
    `SELECT * FROM shipments ${where} ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx}`,
    params
  );
  return rows;
}

/**
 * Get shipment summary stats.
 */
async function getStats() {
  const { rows } = await query(`
    SELECT
      count(*) AS total_shipments,
      count(*) FILTER (WHERE status = 'created') AS pending,
      count(*) FILTER (WHERE status = 'in_transit') AS in_transit,
      count(*) FILTER (WHERE status = 'out_for_delivery') AS out_for_delivery,
      count(*) FILTER (WHERE status = 'delivered') AS delivered,
      count(*) FILTER (WHERE status = 'voided') AS voided,
      count(*) FILTER (WHERE status = 'exception') AS exceptions,
      COALESCE(SUM(charges_amount), 0) AS total_charges,
      count(*) FILTER (WHERE created_at > NOW() - interval '24 hours') AS created_last_24h,
      count(*) FILTER (WHERE delivered_at > NOW() - interval '24 hours') AS delivered_last_24h,
      COALESCE(SUM(charges_amount) FILTER (WHERE created_at > NOW() - interval '30 days'), 0) AS charges_last_30d
    FROM shipments
  `);
  return rows[0];
}

module.exports = {
  insertShipment,
  updateShipmentStatus,
  getByTrackingNumber,
  getActiveShipments,
  getShipments,
  getStats,
};
