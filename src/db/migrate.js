const { query } = require('./index');

const MIGRATIONS = [
  {
    version: 1,
    name: 'create_shipments',
    sql: `
      CREATE TABLE IF NOT EXISTS shipments (
        id SERIAL PRIMARY KEY,
        tracking_number VARCHAR(50) UNIQUE NOT NULL,
        service_code VARCHAR(10) NOT NULL,
        service_name VARCHAR(50) NOT NULL,
        bubble_order_id VARCHAR(255),
        ship_to_name VARCHAR(200) NOT NULL,
        ship_to_phone VARCHAR(30),
        ship_to_address TEXT NOT NULL,
        ship_to_city VARCHAR(100) NOT NULL,
        ship_to_state VARCHAR(10) NOT NULL,
        ship_to_postal_code VARCHAR(20) NOT NULL,
        ship_to_country_code VARCHAR(5) DEFAULT 'US',
        ship_from_postal_code VARCHAR(20) NOT NULL,
        box_length NUMERIC(6,2),
        box_width NUMERIC(6,2),
        box_height NUMERIC(6,2),
        box_weight NUMERIC(6,2),
        filter_count INTEGER NOT NULL DEFAULT 1,
        filter_ids TEXT,
        charges_amount NUMERIC(10,2),
        charges_currency VARCHAR(5) DEFAULT 'USD',
        label_format VARCHAR(10),
        status VARCHAR(30) NOT NULL DEFAULT 'created',
        estimated_delivery_date DATE,
        delivered_at TIMESTAMPTZ,
        voided_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_shipments_tracking ON shipments(tracking_number);
      CREATE INDEX IF NOT EXISTS idx_shipments_status ON shipments(status);
      CREATE INDEX IF NOT EXISTS idx_shipments_created ON shipments(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_shipments_bubble_order ON shipments(bubble_order_id);
    `,
  },
  {
    version: 2,
    name: 'create_tracking_events',
    sql: `
      CREATE TABLE IF NOT EXISTS tracking_events (
        id SERIAL PRIMARY KEY,
        shipment_id INTEGER REFERENCES shipments(id) ON DELETE CASCADE,
        tracking_number VARCHAR(50) NOT NULL,
        status_code VARCHAR(10),
        status_type VARCHAR(30),
        status_description TEXT,
        location_city VARCHAR(100),
        location_state VARCHAR(100),
        location_country VARCHAR(10),
        activity_timestamp TIMESTAMPTZ,
        polled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_tracking_events_shipment ON tracking_events(shipment_id);
      CREATE INDEX IF NOT EXISTS idx_tracking_events_tracking ON tracking_events(tracking_number);
      CREATE INDEX IF NOT EXISTS idx_tracking_events_activity ON tracking_events(activity_timestamp DESC);
    `,
  },
  {
    version: 3,
    name: 'create_shipment_voids',
    sql: `
      CREATE TABLE IF NOT EXISTS shipment_voids (
        id SERIAL PRIMARY KEY,
        shipment_id INTEGER REFERENCES shipments(id) ON DELETE SET NULL,
        tracking_number VARCHAR(50) NOT NULL,
        success BOOLEAN NOT NULL,
        reason TEXT,
        ups_response JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_voids_tracking ON shipment_voids(tracking_number);
    `,
  },
  {
    version: 4,
    name: 'create_rate_quotes',
    sql: `
      CREATE TABLE IF NOT EXISTS rate_quotes (
        id SERIAL PRIMARY KEY,
        quote_type VARCHAR(20) NOT NULL,
        bubble_order_id VARCHAR(255),
        ship_from_postal VARCHAR(20),
        ship_from_state VARCHAR(10),
        ship_to_postal VARCHAR(20),
        ship_to_state VARCHAR(10),
        filter_count INTEGER,
        box_count INTEGER,
        service_code VARCHAR(10),
        total_charges NUMERIC(10,2),
        currency VARCHAR(5) DEFAULT 'USD',
        request_summary JSONB,
        response_summary JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_rate_quotes_created ON rate_quotes(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_rate_quotes_type ON rate_quotes(quote_type);
    `,
  },
];

async function runMigrations() {
  // Create migrations tracking table
  await query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      version INTEGER PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const { rows: applied } = await query('SELECT version FROM _migrations ORDER BY version');
  const appliedVersions = new Set(applied.map(r => r.version));

  for (const migration of MIGRATIONS) {
    if (appliedVersions.has(migration.version)) continue;

    console.log(`[db] Running migration ${migration.version}: ${migration.name}`);
    await query(migration.sql);
    await query('INSERT INTO _migrations (version, name) VALUES ($1, $2)', [migration.version, migration.name]);
    console.log(`[db] Migration ${migration.version} complete`);
  }

  console.log('[db] All migrations up to date');
}

module.exports = { runMigrations };
