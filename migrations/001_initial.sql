CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS schema_migrations (
  name TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  telegram_user_id BIGINT PRIMARY KEY,
  first_name TEXT,
  last_name TEXT,
  username TEXT,
  phone TEXT,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  entry_source TEXT NOT NULL DEFAULT 'direct',
  entry_campaign TEXT,
  start_parameter_raw TEXT,
  first_flow TEXT,
  current_flow TEXT,
  current_stage TEXT,
  stage_number INTEGER NOT NULL DEFAULT 0,
  last_event TEXT,
  last_product_id TEXT,
  interested_products TEXT[] NOT NULL DEFAULT '{}',
  active_trial_id UUID,
  trials_started_count INTEGER NOT NULL DEFAULT 0,
  trials_completed_count INTEGER NOT NULL DEFAULT 0,
  trial_products TEXT[] NOT NULL DEFAULT '{}',
  purchase_click_count INTEGER NOT NULL DEFAULT 0,
  purchase_status TEXT NOT NULL DEFAULT 'unknown',
  lead_temperature TEXT NOT NULL DEFAULT 'cold',
  personal_follow_up BOOLEAN NOT NULL DEFAULT false,
  follow_up_reason TEXT,
  manager_status TEXT NOT NULL DEFAULT 'new',
  manager_comment TEXT,
  next_contact_at TIMESTAMPTZ,
  session JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS products (
  product_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  short_description TEXT,
  format TEXT,
  duration TEXT,
  price TEXT,
  cover TEXT,
  details_url TEXT,
  purchase_url TEXT,
  booking_url TEXT,
  trial_enabled BOOLEAN NOT NULL DEFAULT false,
  active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS schedule_events (
  event_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  start_at TIMESTAMPTZ,
  end_at TIMESTAMPTZ,
  short_description TEXT,
  cover TEXT,
  details_url TEXT,
  join_url TEXT,
  product_id TEXT REFERENCES products(product_id),
  status TEXT NOT NULL DEFAULT 'upcoming',
  sort_order INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS offers (
  offer_id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  short_description TEXT,
  cover TEXT,
  product_id TEXT REFERENCES products(product_id),
  event_id TEXT REFERENCES schedule_events(event_id),
  cta_label TEXT,
  cta_url TEXT,
  target_flow TEXT,
  active_from TIMESTAMPTZ,
  active_until TIMESTAMPTZ,
  active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS trials (
  trial_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_user_id BIGINT NOT NULL REFERENCES users(telegram_user_id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(product_id),
  chain_version INTEGER NOT NULL DEFAULT 1,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  scheduled_end_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('scheduled','active','completed','cancelled','unreachable')),
  current_touch INTEGER NOT NULL DEFAULT 0,
  feedback_status TEXT,
  feedback_answer JSONB NOT NULL DEFAULT '{}',
  feedback_text TEXT,
  asked_ira BOOLEAN NOT NULL DEFAULT false,
  continuation_clicked BOOLEAN NOT NULL DEFAULT false,
  purchase_clicked_at TIMESTAMPTZ,
  purchase_status TEXT NOT NULL DEFAULT 'unknown',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_active_trial_id_fkey;
ALTER TABLE users
  ADD CONSTRAINT users_active_trial_id_fkey
  FOREIGN KEY (active_trial_id) REFERENCES trials(trial_id) ON DELETE SET NULL
  DEFERRABLE INITIALLY DEFERRED;

CREATE UNIQUE INDEX IF NOT EXISTS one_active_trial_per_user
  ON trials(telegram_user_id) WHERE status IN ('scheduled', 'active');

CREATE TABLE IF NOT EXISTS trial_touches (
  trial_id UUID NOT NULL REFERENCES trials(trial_id) ON DELETE CASCADE,
  touch_number INTEGER NOT NULL,
  due_at TIMESTAMPTZ NOT NULL,
  kind TEXT NOT NULL DEFAULT 'material',
  content JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','sent','failed','cancelled')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  sent_at TIMESTAMPTZ,
  clicked_at TIMESTAMPTZ,
  error TEXT,
  locked_at TIMESTAMPTZ,
  PRIMARY KEY (trial_id, touch_number)
);
CREATE INDEX IF NOT EXISTS due_trial_touches ON trial_touches(status, due_at);

CREATE TABLE IF NOT EXISTS questions (
  question_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  telegram_user_id BIGINT NOT NULL REFERENCES users(telegram_user_id) ON DELETE CASCADE,
  username TEXT,
  product_id TEXT REFERENCES products(product_id),
  trial_id UUID REFERENCES trials(trial_id) ON DELETE SET NULL,
  touch_number INTEGER,
  question_text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','in_progress','answered','closed')),
  ira_telegram_message_id BIGINT,
  assigned_to BIGINT,
  answer_text TEXT,
  answered_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS events (
  event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  telegram_user_id BIGINT REFERENCES users(telegram_user_id) ON DELETE SET NULL,
  event_name TEXT NOT NULL,
  flow_id TEXT,
  stage_id TEXT,
  stage_number INTEGER,
  product_id TEXT,
  trial_id UUID,
  touch_number INTEGER,
  content_type TEXT,
  button_id TEXT,
  source TEXT,
  campaign TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS events_user_time ON events(telegram_user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS events_name_time ON events(event_name, occurred_at DESC);

CREATE TABLE IF NOT EXISTS follow_up (
  follow_up_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_user_id BIGINT NOT NULL REFERENCES users(telegram_user_id) ON DELETE CASCADE,
  priority TEXT NOT NULL DEFAULT 'medium',
  reason TEXT NOT NULL,
  product_id TEXT,
  recommended_action TEXT,
  initiative TEXT,
  assigned_to TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (telegram_user_id, reason, status)
);

CREATE TABLE IF NOT EXISTS processed_updates (
  update_id BIGINT PRIMARY KEY,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  admin_user_id BIGINT PRIMARY KEY,
  action TEXT NOT NULL,
  question_id UUID REFERENCES questions(question_id) ON DELETE CASCADE,
  payload JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_config (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS outbound_links (
  token UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_user_id BIGINT NOT NULL REFERENCES users(telegram_user_id) ON DELETE CASCADE,
  product_id TEXT REFERENCES products(product_id),
  trial_id UUID REFERENCES trials(trial_id) ON DELETE SET NULL,
  purpose TEXT NOT NULL,
  destination_url TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  clicked_at TIMESTAMPTZ,
  click_count INTEGER NOT NULL DEFAULT 0
);
