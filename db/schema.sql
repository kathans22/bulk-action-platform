CREATE TABLE contacts (
  id SERIAL PRIMARY KEY,
  account_id VARCHAR(50) NOT NULL,
  name VARCHAR(255),
  email VARCHAR(255),
  age INTEGER,
  status VARCHAR(50) DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_contacts_account_id ON contacts(account_id);


CREATE TABLE bulk_actions (
  id SERIAL PRIMARY KEY,
  account_id VARCHAR(50) NOT NULL,
  entity_type VARCHAR(50) NOT NULL,
  action_type VARCHAR(50) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'queued',
  configuration JSONB NOT NULL,
  total_entities INTEGER DEFAULT 0,
  scheduled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ
);


CREATE TABLE bulk_action_batches (
  id SERIAL PRIMARY KEY,
  bulk_action_id INTEGER NOT NULL REFERENCES bulk_actions(id),
  entity_ids INTEGER[] NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  attempts INTEGER DEFAULT 0,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);

CREATE INDEX idx_bulk_action_batches_status ON bulk_action_batches(status);


CREATE TABLE bulk_action_logs (
  id BIGSERIAL PRIMARY KEY,
  bulk_action_id INTEGER NOT NULL REFERENCES bulk_actions(id),
  entity_id INTEGER,
  status VARCHAR(20) NOT NULL,
  message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE rate_limits (
  account_id VARCHAR(50) NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  event_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (account_id, window_start)
);

CREATE INDEX idx_bulk_action_logs_action_status ON bulk_action_logs(bulk_action_id, status);
