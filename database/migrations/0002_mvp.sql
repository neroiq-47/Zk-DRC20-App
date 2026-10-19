-- Zoko PostgreSQL migration 0002 (PostgreSQL 16+): everything the MVP API needs on top of 0001.
BEGIN;

-- ---------- Users, credentials, sessions ----------
CREATE TYPE user_role AS ENUM ('user','moderator','admin');

ALTER TABLE users
  ADD COLUMN role user_role NOT NULL DEFAULT 'user',
  ADD COLUMN settings jsonb NOT NULL DEFAULT '{"theme":"system","default_visibility":"public","allow_message_requests":"everyone","show_wallet_on_profile":true}'::jsonb,
  ADD COLUMN avatar_media_id uuid REFERENCES media(id) ON DELETE SET NULL,
  ADD COLUMN cover_media_id uuid REFERENCES media(id) ON DELETE SET NULL;
CREATE INDEX users_status_idx ON users(status);

CREATE TABLE credentials(
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  email text NOT NULL CHECK (char_length(email) BETWEEN 3 AND 254),
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX credentials_email_lower_unique ON credentials(lower(email));

ALTER TABLE sessions
  ADD COLUMN replaced_by uuid REFERENCES sessions(id) ON DELETE SET NULL,
  ADD COLUMN revoked_reason text,
  ADD COLUMN user_agent text;
CREATE UNIQUE INDEX sessions_refresh_hash_idx ON sessions(refresh_hash);
CREATE INDEX sessions_family_idx ON sessions(token_family);

CREATE INDEX blocks_blocked_idx ON blocks(blocked_id);

-- ---------- Media ----------
ALTER TABLE media
  ADD COLUMN width integer CHECK (width IS NULL OR width BETWEEN 1 AND 20000),
  ADD COLUMN height integer CHECK (height IS NULL OR height BETWEEN 1 AND 20000),
  ADD COLUMN storage_driver text NOT NULL DEFAULT 'local',
  ADD COLUMN upload_expires_at timestamptz,
  ADD COLUMN uploaded_at timestamptz,
  ADD COLUMN scanned_at timestamptz,
  ADD COLUMN rejection_reason text,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX media_owner_idx ON media(owner_id, created_at DESC);

-- ---------- Posts ----------
-- is_repost marks a plain repost (empty body, no media, quote_post_id set) so it can be uniquely indexed.
ALTER TABLE posts ADD COLUMN is_repost boolean NOT NULL DEFAULT false;
ALTER TABLE posts ADD CONSTRAINT posts_repost_shape CHECK (NOT is_repost OR (quote_post_id IS NOT NULL AND body = '' AND parent_id IS NULL));
CREATE UNIQUE INDEX posts_one_repost_per_user_idx ON posts(author_id, quote_post_id) WHERE is_repost AND status = 'published';
CREATE INDEX posts_quote_idx ON posts(quote_post_id) WHERE quote_post_id IS NOT NULL;
CREATE INDEX posts_feed_cursor_idx ON posts(created_at DESC, id DESC) WHERE status = 'published';

CREATE TABLE post_hashtags(
  post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  tag text NOT NULL CHECK (char_length(tag) BETWEEN 1 AND 64),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(post_id, tag)
);
CREATE INDEX post_hashtags_tag_idx ON post_hashtags(tag, created_at DESC);
CREATE INDEX post_hashtags_recent_idx ON post_hashtags(created_at DESC);

CREATE TABLE idempotency_keys(
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  route text NOT NULL,
  key text NOT NULL CHECK (char_length(key) BETWEEN 1 AND 200),
  request_hash text NOT NULL,
  status_code integer,
  response jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id, route, key)
);
CREATE INDEX idempotency_keys_created_idx ON idempotency_keys(created_at);

-- ---------- Devices (Expo push tokens) ----------
CREATE TABLE devices(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expo_push_token text NOT NULL UNIQUE,
  platform text NOT NULL CHECK (platform IN ('ios','android')),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX devices_user_idx ON devices(user_id);

-- ---------- Messaging ----------
ALTER TABLE conversations
  ADD COLUMN created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN direct_key text UNIQUE,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE conversation_members ADD COLUMN accepted_at timestamptz;
UPDATE conversation_members SET accepted_at = joined_at WHERE accepted_at IS NULL;
ALTER TABLE messages ADD COLUMN client_id varchar(64);
CREATE UNIQUE INDEX messages_client_id_idx ON messages(conversation_id, sender_id, client_id) WHERE client_id IS NOT NULL;

-- ---------- Notifications ----------
ALTER TABLE notifications ADD COLUMN post_id uuid REFERENCES posts(id) ON DELETE SET NULL;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check CHECK (kind IN ('like','reply','follow','repost','mention','message','transfer'));
CREATE INDEX notifications_unread_idx ON notifications(recipient_id) WHERE read_at IS NULL;

ALTER TABLE outbox_events ADD COLUMN attempts integer NOT NULL DEFAULT 0, ADD COLUMN last_error text;

-- ---------- Safety ----------
ALTER TABLE reports
  ADD COLUMN details varchar(1000),
  ADD COLUMN resolved_at timestamptz,
  ADD COLUMN resolved_by uuid REFERENCES users(id);
ALTER TABLE reports ADD CONSTRAINT reports_reason_check CHECK (reason IN ('spam','harassment','hate','violence','sexual','scam','impersonation','other'));
CREATE INDEX audit_events_subject_idx ON audit_events(subject_kind, subject_id);

-- ---------- Wallet & chain ----------
ALTER TABLE wallet_challenges
  ADD COLUMN message text NOT NULL DEFAULT '',
  ADD COLUMN provider text NOT NULL DEFAULT 'manual';
CREATE INDEX wallet_challenges_user_idx ON wallet_challenges(user_id, created_at DESC);

CREATE TABLE doge_balances(
  wallet_id uuid PRIMARY KEY REFERENCES wallet_connections(id) ON DELETE CASCADE,
  amount_koinu numeric(30,0) NOT NULL CHECK (amount_koinu >= 0),
  indexed_height bigint,
  status asset_status NOT NULL DEFAULT 'unverified',
  sources jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE asset_balances ADD COLUMN sources jsonb NOT NULL DEFAULT '[]'::jsonb;
CREATE INDEX drc20_tokens_ticker_lower_idx ON drc20_tokens(lower(ticker));

ALTER TABLE chain_blocks ADD COLUMN block_time timestamptz;
CREATE INDEX chain_blocks_height_idx ON chain_blocks(height);

-- ---------- Transfers ----------
ALTER TABLE transfers
  ADD COLUMN network_fee_koinu numeric(30,0),
  ADD COLUMN required_confirmations integer NOT NULL DEFAULT 6 CHECK (required_confirmations >= 1),
  ADD COLUMN error_detail text;
ALTER TABLE transfer_steps
  ADD COLUMN provider_format text CHECK (provider_format IS NULL OR provider_format IN ('psbt_hex','unsigned_tx_hex')),
  ADD COLUMN unsigned_payload text,
  ADD COLUMN signed_payload text,
  ADD COLUMN network_fee_koinu numeric(30,0),
  ADD COLUMN prepare_expires_at timestamptz,
  ADD COLUMN block_height bigint,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX transfers_active_idx ON transfers(status) WHERE status IN ('broadcast','confirming','reorged');

-- Append-only history of every transfer state transition (server-enforced state machine).
CREATE TABLE transfer_events(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id uuid NOT NULL REFERENCES transfers(id) ON DELETE CASCADE,
  from_status transfer_status,
  to_status transfer_status NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX transfer_events_transfer_idx ON transfer_events(transfer_id, created_at);

COMMIT;
