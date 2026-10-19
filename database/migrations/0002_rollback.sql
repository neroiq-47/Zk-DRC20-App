-- Reverts 0002_mvp.sql. Data in the dropped columns/tables is lost.
BEGIN;
DROP TABLE IF EXISTS transfer_events, doge_balances, devices, idempotency_keys, post_hashtags, credentials CASCADE;

DROP INDEX IF EXISTS transfers_active_idx;
ALTER TABLE transfer_steps
  DROP COLUMN IF EXISTS provider_format, DROP COLUMN IF EXISTS unsigned_payload, DROP COLUMN IF EXISTS signed_payload,
  DROP COLUMN IF EXISTS network_fee_koinu, DROP COLUMN IF EXISTS prepare_expires_at, DROP COLUMN IF EXISTS block_height,
  DROP COLUMN IF EXISTS updated_at;
ALTER TABLE transfers DROP COLUMN IF EXISTS network_fee_koinu, DROP COLUMN IF EXISTS required_confirmations, DROP COLUMN IF EXISTS error_detail;

DROP INDEX IF EXISTS chain_blocks_height_idx;
ALTER TABLE chain_blocks DROP COLUMN IF EXISTS block_time;
DROP INDEX IF EXISTS drc20_tokens_ticker_lower_idx;
ALTER TABLE asset_balances DROP COLUMN IF EXISTS sources;
DROP INDEX IF EXISTS wallet_challenges_user_idx;
ALTER TABLE wallet_challenges DROP COLUMN IF EXISTS message, DROP COLUMN IF EXISTS provider;

DROP INDEX IF EXISTS audit_events_subject_idx;
ALTER TABLE reports DROP CONSTRAINT IF EXISTS reports_reason_check;
ALTER TABLE reports DROP COLUMN IF EXISTS details, DROP COLUMN IF EXISTS resolved_at, DROP COLUMN IF EXISTS resolved_by;

ALTER TABLE outbox_events DROP COLUMN IF EXISTS attempts, DROP COLUMN IF EXISTS last_error;
DROP INDEX IF EXISTS notifications_unread_idx;
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
ALTER TABLE notifications DROP COLUMN IF EXISTS post_id;

DROP INDEX IF EXISTS messages_client_id_idx;
ALTER TABLE messages DROP COLUMN IF EXISTS client_id;
ALTER TABLE conversation_members DROP COLUMN IF EXISTS accepted_at;
ALTER TABLE conversations DROP COLUMN IF EXISTS created_by, DROP COLUMN IF EXISTS direct_key, DROP COLUMN IF EXISTS updated_at;

DROP INDEX IF EXISTS posts_feed_cursor_idx;
DROP INDEX IF EXISTS posts_quote_idx;
DROP INDEX IF EXISTS posts_one_repost_per_user_idx;
ALTER TABLE posts DROP CONSTRAINT IF EXISTS posts_repost_shape;
ALTER TABLE posts DROP COLUMN IF EXISTS is_repost;

DROP INDEX IF EXISTS media_owner_idx;
ALTER TABLE media
  DROP COLUMN IF EXISTS width, DROP COLUMN IF EXISTS height, DROP COLUMN IF EXISTS storage_driver,
  DROP COLUMN IF EXISTS upload_expires_at, DROP COLUMN IF EXISTS uploaded_at, DROP COLUMN IF EXISTS scanned_at,
  DROP COLUMN IF EXISTS rejection_reason, DROP COLUMN IF EXISTS updated_at;

DROP INDEX IF EXISTS blocks_blocked_idx;
DROP INDEX IF EXISTS sessions_family_idx;
DROP INDEX IF EXISTS sessions_refresh_hash_idx;
ALTER TABLE sessions DROP COLUMN IF EXISTS replaced_by, DROP COLUMN IF EXISTS revoked_reason, DROP COLUMN IF EXISTS user_agent;

DROP INDEX IF EXISTS users_status_idx;
ALTER TABLE users DROP COLUMN IF EXISTS role, DROP COLUMN IF EXISTS settings, DROP COLUMN IF EXISTS avatar_media_id, DROP COLUMN IF EXISTS cover_media_id;
DROP TYPE IF EXISTS user_role;
COMMIT;
