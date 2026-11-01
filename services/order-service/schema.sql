CREATE TABLE IF NOT EXISTS orders (
  oid BIGSERIAL PRIMARY KEY,
  uid BIGINT NOT NULL,
  discount NUMERIC(5, 2) NOT NULL CHECK (discount >= 0 AND discount <= 100),
  subtotal NUMERIC(12, 2) NOT NULL CHECK (subtotal >= 0),
  discount_amount NUMERIC(12, 2) NOT NULL CHECK (discount_amount >= 0),
  total_amount NUMERIC(12, 2) NOT NULL CHECK (total_amount >= 0),
  request_key VARCHAR(100) UNIQUE,
  reservation_id UUID NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS order_details (
  oid BIGINT NOT NULL REFERENCES orders(oid) ON DELETE CASCADE,
  pid INTEGER NOT NULL,
  pname VARCHAR(100) NOT NULL,
  qty INTEGER NOT NULL CHECK (qty > 0),
  unit_price NUMERIC(10, 2) NOT NULL CHECK (unit_price >= 0),
  PRIMARY KEY (oid, pid)
);

CREATE TABLE IF NOT EXISTS outbox_events (
  event_id UUID PRIMARY KEY,
  aggregate_id BIGINT NOT NULL,
  event_type VARCHAR(100) NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at TIMESTAMPTZ,
  attempts INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_outbox_unpublished
ON outbox_events (created_at) WHERE published_at IS NULL;
