const upsService = require('./ups');
const bubbleService = require('./bubbleService');
const shipmentsDb = require('../db/shipments');
const trackingEventsDb = require('../db/trackingEvents');

const POLL_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours
let pollTimer = null;

/**
 * Poll UPS Tracking API for all active shipments and store events.
 */
async function pollAllShipments() {
  console.log('[tracking] Starting tracking poll...');
  const startTime = Date.now();

  try {
    const activeShipments = await shipmentsDb.getActiveShipments();
    console.log(`[tracking] ${activeShipments.length} active shipment(s) to check`);

    let updated = 0;
    let errors = 0;
    let bubbleNotified = 0;

    for (const shipment of activeShipments) {
      try {
        const result = await pollSingleShipment(shipment);
        updated++;
        if (result?.bubbleNotified) bubbleNotified++;
      } catch (err) {
        errors++;
        console.error(`[tracking] Error polling ${shipment.tracking_number}:`, err.message);
      }

      // Small delay between API calls to avoid rate limiting
      if (activeShipments.length > 1) {
        await new Promise(r => setTimeout(r, 500));
      }
    }

    const duration = Date.now() - startTime;
    console.log(`[tracking] Poll complete: ${updated} updated, ${bubbleNotified} notified to Bubble, ${errors} errors, ${duration}ms`);
  } catch (err) {
    console.error('[tracking] Poll failed:', err.message);
  }
}

/**
 * Poll tracking for a single shipment and update its status.
 */
async function pollSingleShipment(shipment) {
  const result = await upsService.trackShipment(shipment.tracking_number);

  const trackResponse = result.trackResponse;
  if (!trackResponse?.shipment?.[0]) {
    console.log(`[tracking] No tracking data for ${shipment.tracking_number}`);
    return;
  }

  const upsShipment = trackResponse.shipment[0];
  const pkg = upsShipment.package?.[0];
  if (!pkg) return;

  // Process activity history
  const activities = pkg.activity || [];
  let latestStatusType = null;
  let latestStatusCode = null;

  for (const activity of activities) {
    const statusType = activity.status?.type;
    const statusCode = activity.status?.code;
    const description = activity.status?.description;
    const location = activity.location?.address || {};
    const activityDate = activity.date; // YYYYMMDD
    const activityTime = activity.time; // HHMMSS

    let activityTimestamp = null;
    if (activityDate) {
      const dateStr = `${activityDate.slice(0, 4)}-${activityDate.slice(4, 6)}-${activityDate.slice(6, 8)}`;
      const timeStr = activityTime
        ? `${activityTime.slice(0, 2)}:${activityTime.slice(2, 4)}:${activityTime.slice(4, 6)}`
        : '00:00:00';
      activityTimestamp = new Date(`${dateStr}T${timeStr}Z`);
    }

    await trackingEventsDb.insertEvent({
      shipmentId: shipment.id,
      trackingNumber: shipment.tracking_number,
      statusCode,
      statusType,
      statusDescription: description,
      locationCity: location.city,
      locationState: location.stateProvince,
      locationCountry: location.country,
      activityTimestamp,
    });
  }

  // Determine latest status from the most recent activity
  if (activities.length > 0) {
    latestStatusType = activities[0].status?.type;
    latestStatusCode = activities[0].status?.code;
  }

  // Map UPS status types to our status
  const newStatus = mapUpsStatus(latestStatusType, latestStatusCode);
  let bubbleNotified = false;

  if (newStatus && newStatus !== shipment.status) {
    const extra = {};
    if (newStatus === 'delivered') {
      extra.deliveredAt = new Date();
    }
    await shipmentsDb.updateShipmentStatus(shipment.tracking_number, newStatus, extra);
    console.log(`[tracking] ${shipment.tracking_number}: ${shipment.status} -> ${newStatus}`);

    // Notify Bubble of the status change
    const latestActivity = activities[0];
    const latestEvent = latestActivity ? {
      description: latestActivity.status?.description,
      locationCity: latestActivity.location?.address?.city,
      locationState: latestActivity.location?.address?.stateProvince,
      locationCountry: latestActivity.location?.address?.country,
      activityTimestamp: (() => {
        const d = latestActivity.date;
        const t = latestActivity.time;
        if (!d) return null;
        const dateStr = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
        const timeStr = t ? `${t.slice(0, 2)}:${t.slice(2, 4)}:${t.slice(4, 6)}` : '00:00:00';
        return new Date(`${dateStr}T${timeStr}Z`);
      })(),
    } : null;

    try {
      const bubbleResult = await bubbleService.postTrackingUpdate(shipment, newStatus, latestEvent);
      bubbleNotified = bubbleResult.success;
    } catch (err) {
      console.error(`[tracking] Bubble notification failed for ${shipment.tracking_number}:`, err.message);
    }
  }

  return { bubbleNotified };
}

/**
 * Map UPS tracking status type/code to our status enum.
 * UPS status types: D=Delivered, I=In Transit, P=Pickup, M=Manifest, X=Exception, RS=Returned
 */
function mapUpsStatus(statusType, statusCode) {
  if (!statusType) return null;

  switch (statusType) {
    case 'D': return 'delivered';
    case 'I': return 'in_transit';
    case 'P': return 'in_transit'; // Picked up = in transit
    case 'M': return 'created';    // Manifest = label created
    case 'X': return 'exception';
    case 'RS': return 'returned';
    case 'O': return 'out_for_delivery';
    default: return 'in_transit';
  }
}

/**
 * Start the polling interval.
 */
function start() {
  if (pollTimer) {
    console.log('[tracking] Poller already running');
    return;
  }

  console.log(`[tracking] Poller started (every ${POLL_INTERVAL_MS / 1000 / 60 / 60}h)`);

  // Run immediately on start, then every 4 hours
  pollAllShipments();
  pollTimer = setInterval(pollAllShipments, POLL_INTERVAL_MS);
}

/**
 * Stop the polling interval.
 */
function stop() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
    console.log('[tracking] Poller stopped');
  }
}

module.exports = { start, stop, pollAllShipments, pollSingleShipment };
