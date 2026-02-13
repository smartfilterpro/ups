const { query } = require('./index');

/**
 * Log a rate quote request/response.
 */
async function insertQuote({
  quoteType, bubbleOrderId,
  shipFromPostal, shipFromState,
  shipToPostal, shipToState,
  filterCount, boxCount,
  serviceCode, totalCharges, currency,
  requestSummary, responseSummary,
}) {
  const { rows } = await query(
    `INSERT INTO rate_quotes (
      quote_type, bubble_order_id,
      ship_from_postal, ship_from_state,
      ship_to_postal, ship_to_state,
      filter_count, box_count,
      service_code, total_charges, currency,
      request_summary, response_summary
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
    RETURNING *`,
    [
      quoteType, bubbleOrderId || null,
      shipFromPostal || null, shipFromState || null,
      shipToPostal || null, shipToState || null,
      filterCount || null, boxCount || null,
      serviceCode || null, totalCharges || null, currency || 'USD',
      requestSummary ? JSON.stringify(requestSummary) : null,
      responseSummary ? JSON.stringify(responseSummary) : null,
    ]
  );
  return rows[0];
}

/**
 * Get rate quote analytics for a time period.
 */
async function getQuoteStats(days = 30) {
  const { rows } = await query(`
    SELECT
      quote_type,
      count(*) AS total_quotes,
      COALESCE(AVG(total_charges), 0) AS avg_charges,
      COALESCE(SUM(total_charges), 0) AS total_charges,
      MIN(created_at) AS earliest,
      MAX(created_at) AS latest
    FROM rate_quotes
    WHERE created_at > NOW() - interval '1 day' * $1
    GROUP BY quote_type
    ORDER BY quote_type
  `, [days]);
  return rows;
}

/**
 * Get recent quotes.
 */
async function getRecent(limit = 50) {
  const { rows } = await query(
    'SELECT * FROM rate_quotes ORDER BY created_at DESC LIMIT $1',
    [Math.min(limit, 100)]
  );
  return rows;
}

module.exports = { insertQuote, getQuoteStats, getRecent };
