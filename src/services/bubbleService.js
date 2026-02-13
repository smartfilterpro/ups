/**
 * Bubble.io integration service.
 * Posts tracking status updates to a Bubble Backend Workflow endpoint
 * whenever a shipment status changes.
 *
 * Required env vars:
 *   BUBBLE_API_URL  — Base URL, e.g. https://yourapp.bubbleapps.io/api/1.1/wf
 *   BUBBLE_API_KEY  — Bubble API key for authentication
 *
 * Optional:
 *   BUBBLE_WEBHOOK_PATH — Workflow endpoint name (default: "tracking-update")
 */

const BUBBLE_API_URL = () => process.env.BUBBLE_API_URL;
const BUBBLE_API_KEY = () => process.env.BUBBLE_API_KEY;
const BUBBLE_WEBHOOK_PATH = () => process.env.BUBBLE_WEBHOOK_PATH || 'tracking-update';

function isConfigured() {
  return !!(BUBBLE_API_URL() && BUBBLE_API_KEY());
}

/**
 * Post a tracking status update to Bubble.
 *
 * @param {object} shipment       — The shipment row from the database
 * @param {string} newStatus      — The new status value
 * @param {object|null} latestEvent — The most recent UPS tracking activity (optional)
 * @returns {object} — { success, statusCode, body } or { success: false, error }
 */
async function postTrackingUpdate(shipment, newStatus, latestEvent) {
  if (!isConfigured()) {
    console.log('[bubble] Not configured — skipping status post');
    return { success: false, error: 'Bubble not configured' };
  }

  const url = `${BUBBLE_API_URL().replace(/\/+$/, '')}/${BUBBLE_WEBHOOK_PATH()}`;

  const payload = {
    tracking_number: shipment.tracking_number,
    status: newStatus,
    previous_status: shipment.status,
    bubble_order_id: shipment.bubble_order_id || null,
    service_name: shipment.service_name,
    ship_to_name: shipment.ship_to_name,
    ship_to_city: shipment.ship_to_city,
    ship_to_state: shipment.ship_to_state,
    estimated_delivery_date: shipment.estimated_delivery_date || null,
    delivered_at: newStatus === 'delivered' ? new Date().toISOString() : (shipment.delivered_at || null),
  };

  // Include latest tracking event details if available
  if (latestEvent) {
    payload.latest_event = {
      description: latestEvent.description || null,
      location_city: latestEvent.locationCity || null,
      location_state: latestEvent.locationState || null,
      location_country: latestEvent.locationCountry || null,
      timestamp: latestEvent.activityTimestamp
        ? latestEvent.activityTimestamp.toISOString()
        : null,
    };
  }

  try {
    console.log(`[bubble] Posting status update: ${shipment.tracking_number} → ${newStatus}`);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${BUBBLE_API_KEY()}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000), // 15s timeout
    });

    const body = await response.text();
    let parsed;
    try { parsed = JSON.parse(body); } catch { parsed = body; }

    if (response.ok) {
      console.log(`[bubble] Success: ${shipment.tracking_number} (${response.status})`);
      return { success: true, statusCode: response.status, body: parsed };
    } else {
      console.error(`[bubble] Failed: ${shipment.tracking_number} — ${response.status}: ${body}`);
      return { success: false, statusCode: response.status, body: parsed };
    }
  } catch (err) {
    console.error(`[bubble] Error posting ${shipment.tracking_number}:`, err.message);
    return { success: false, error: err.message };
  }
}

module.exports = { isConfigured, postTrackingUpdate };
