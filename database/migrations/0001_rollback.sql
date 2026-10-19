BEGIN;
DROP TABLE IF EXISTS audit_events,outbox_events,transfer_steps,transfers,asset_balances,chain_events,chain_blocks,drc20_tokens,wallet_connections,wallet_challenges,moderation_actions,reports,notifications,messages,conversation_members,conversations,bookmarks,reactions,post_media,media,posts,blocks,follows,sessions,auth_identities,users CASCADE;
DROP TYPE IF EXISTS transfer_status,asset_status,post_status,post_visibility,account_status;
COMMIT;
