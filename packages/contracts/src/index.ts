// Zoko API contract: request and response shapes shared by apps/api and apps/mobile.
// Base path: /api/v1. Errors use application/problem+json (Problem).
// All list endpoints are cursor-paginated: pass ?cursor=<next_cursor>&limit=<1..50>.
// Amounts on chain are decimal strings of base units to avoid float precision loss.

export type Uuid = string;
export type IsoDateTime = string;

export interface Problem {
  type: string;
  title: string;
  status: number;
  detail?: string;
  code?: string;
  errors?: Record<string, string>;
}

export interface Page<T> {
  items: T[];
  next_cursor: string | null;
}

// ---------- Auth ----------
// POST /auth/register   RegisterRequest -> 201 AuthResponse
// POST /auth/login      LoginRequest    -> 201 AuthResponse
// POST /auth/refresh    RefreshRequest  -> 201 TokenPair   (reusing a rotated refresh token revokes the whole family)
// POST /auth/logout     RefreshRequest  -> 204
export interface RegisterRequest {
  email: string;
  password: string; // min 12 chars
  handle: string; // ^[a-z0-9_]{3,30}$
  display_name?: string;
}
export interface LoginRequest {
  email: string;
  password: string;
}
export interface RefreshRequest {
  refresh_token: string;
}
export interface TokenPair {
  access_token: string;
  refresh_token: string;
  expires_in: number; // seconds
}
export interface AuthResponse extends TokenPair {
  user: Me;
}

// ---------- Users ----------
export type Role = 'user' | 'moderator' | 'admin';

export interface UserSummary {
  id: Uuid;
  handle: string;
  display_name: string;
  avatar_url: string | null;
  has_verified_wallet: boolean;
}

export interface Profile extends UserSummary {
  bio: string | null;
  cover_url: string | null;
  created_at: IsoDateTime;
  followers_count: number;
  following_count: number;
  posts_count: number;
  is_me: boolean;
  is_following: boolean;
  follows_me: boolean;
  is_blocked: boolean; // I blocked them
}

export interface Me extends Profile {
  email: string;
  role: Role;
  settings: UserSettings;
}

export interface UserSettings {
  theme: 'system' | 'light' | 'dark';
  default_visibility: PostVisibility;
  allow_message_requests: 'everyone' | 'following' | 'nobody';
  show_wallet_on_profile: boolean;
}

// GET    /users/me                 -> Me
// PATCH  /users/me                 UpdateMeRequest -> Me
// DELETE /users/me                 -> 202 (status becomes 'deleting'; sessions revoked)
// GET    /users/me/export          -> AccountExport
// GET    /users/me/bookmarks       -> Page<Post>
// GET    /users/:handle            -> Profile
// GET    /users/:handle/posts      -> Page<Post>   (?filter=posts|replies|media)
// GET    /users/:handle/followers  -> Page<UserSummary>
// GET    /users/:handle/following  -> Page<UserSummary>
// POST   /users/:handle/follow     -> 204   DELETE same -> 204
// POST   /users/:handle/block      -> 204   DELETE same -> 204
export interface UpdateMeRequest {
  display_name?: string; // 1..80
  bio?: string | null; // <= 500
  avatar_media_id?: Uuid | null;
  cover_media_id?: Uuid | null;
  settings?: Partial<UserSettings>;
}
export interface AccountExport {
  generated_at: IsoDateTime;
  user: Me;
  posts: Post[];
  following: UserSummary[];
  wallets: WalletConnection[];
}

// ---------- Posts & feeds ----------
export type PostVisibility = 'public' | 'followers';

export interface MediaItem {
  id: Uuid;
  kind: 'image' | 'video';
  url: string; // absolute URL, only for ready media
  thumbnail_url: string | null;
  alt_text: string | null;
  width: number | null;
  height: number | null;
}

export interface Post {
  id: Uuid;
  author: UserSummary;
  body: string;
  visibility: PostVisibility;
  created_at: IsoDateTime;
  parent_id: Uuid | null;
  reply_to_handle: string | null;
  quote: Post | null; // repost when body is '' and quote is set
  media: MediaItem[];
  like_count: number;
  reply_count: number;
  repost_count: number;
  liked_by_me: boolean;
  bookmarked_by_me: boolean;
  reposted_by_me: boolean;
}

// GET    /feed                     -> Page<Post>  following feed (me + people I follow), newest first, deduplicated
// GET    /feed/discover            -> Page<Post>  public posts, blocked users filtered out
// POST   /posts   (header Idempotency-Key)  CreatePostRequest -> 201 Post
// GET    /posts/:id                -> Post
// DELETE /posts/:id                -> 204 (author or moderator)
// GET    /posts/:id/replies        -> Page<Post> oldest first
// POST   /posts/:id/like           -> 204   DELETE same -> 204
// POST   /posts/:id/bookmark       -> 204   DELETE same -> 204
// POST   /posts/:id/repost         -> 201 Post   DELETE same -> 204
export interface CreatePostRequest {
  body: string; // <= 500 chars; may be '' only when media_ids or quote_post_id present
  visibility?: PostVisibility;
  media_ids?: Uuid[]; // <= 4, owned by caller, processing_state 'ready'
  parent_id?: Uuid;
  quote_post_id?: Uuid;
}

// ---------- Search & discovery ----------
// GET /search?q=...&type=all|users|posts  -> SearchResults
// GET /trends                              -> { items: Trend[] }
// GET /users/suggested                     -> { items: UserSummary[] }
export interface SearchResults {
  users: UserSummary[];
  posts: Post[];
}
export interface Trend {
  tag: string; // without '#'
  post_count: number;
}

// ---------- Media ----------
// POST /media/uploads        UploadRequest -> 201 UploadTicket
// PUT  <upload_url>          raw bytes with Content-Type = mime_type and the returned headers
// POST /media/:id/complete   CompleteUploadRequest -> 201 Media (scanned; 'ready' or 'rejected')
// GET  /media/:id            -> Media
export interface UploadRequest {
  kind: 'image' | 'video';
  mime_type: string; // image/jpeg|png|webp|heic, video/mp4|quicktime
  byte_size: number; // image <= 15 MB, video <= 200 MB
}
export interface UploadTicket {
  media_id: Uuid;
  upload_url: string;
  method: 'PUT';
  headers: Record<string, string>;
  expires_at: IsoDateTime;
}
export interface CompleteUploadRequest {
  alt_text?: string;
  width?: number;
  height?: number;
}
export type MediaState = 'pending' | 'scanning' | 'processing' | 'ready' | 'rejected' | 'failed';
export interface Media {
  id: Uuid;
  kind: 'image' | 'video';
  processing_state: MediaState;
  url: string | null;
  thumbnail_url: string | null;
  alt_text: string | null;
}

// ---------- Messaging ----------
// GET  /conversations                    -> Page<Conversation>
// POST /conversations                    StartConversationRequest -> 201 Conversation (returns the existing one if present)
// GET  /conversations/:id                -> Conversation
// GET  /conversations/:id/messages       -> Page<Message> newest first
// POST /conversations/:id/messages       SendMessageRequest -> 201 Message
// POST /conversations/:id/read           -> 204
// POST /conversations/:id/accept         -> 204 (accept a message request)
// WS   /ws?access_token=...              server pushes RealtimeEvent JSON frames
export interface StartConversationRequest {
  handle: string;
}
export interface Conversation {
  id: Uuid;
  other: UserSummary;
  last_message: Message | null;
  unread_count: number;
  is_request: boolean; // true when the other person started it and I have not accepted or replied
  updated_at: IsoDateTime;
}
export interface SendMessageRequest {
  body: string; // 1..4000
  client_id?: string; // echoed back for optimistic UI
}
export interface Message {
  id: Uuid;
  conversation_id: Uuid;
  sender_id: Uuid;
  body: string;
  created_at: IsoDateTime;
  client_id: string | null;
}

// ---------- Notifications ----------
// GET  /notifications           -> Page<Notification> & { unread_count: number }
// POST /notifications/read      -> 204 (marks all read)
// POST /devices                 RegisterDeviceRequest -> 204 (Expo push token)
export type NotificationKind = 'like' | 'reply' | 'follow' | 'repost' | 'mention' | 'message' | 'transfer';
export interface Notification {
  id: Uuid;
  kind: NotificationKind;
  actor: UserSummary | null;
  post: Pick<Post, 'id' | 'body'> | null;
  entity_id: Uuid | null;
  read: boolean;
  created_at: IsoDateTime;
}
export interface NotificationPage extends Page<Notification> {
  unread_count: number;
}
export interface RegisterDeviceRequest {
  expo_push_token: string;
  platform: 'ios' | 'android';
}

export type RealtimeEvent =
  | { type: 'message'; message: Message }
  | { type: 'notification'; notification: Notification }
  | { type: 'transfer'; transfer: Transfer };

// ---------- Safety & moderation ----------
// POST /reports                              ReportRequest -> 201 Report
// GET  /moderation/reports?status=open       -> Page<ModerationReport>   (moderator/admin only)
// POST /moderation/reports/:id/actions       ModerationActionRequest -> 201 ModerationReport
export type ReportTarget = 'user' | 'post' | 'message';
export type ReportReason = 'spam' | 'harassment' | 'hate' | 'violence' | 'sexual' | 'scam' | 'impersonation' | 'other';
export interface ReportRequest {
  target_kind: ReportTarget;
  target_id: Uuid;
  reason: ReportReason;
  details?: string;
}
export interface Report {
  id: Uuid;
  status: 'open' | 'reviewing' | 'resolved' | 'dismissed';
}
export interface ModerationReport extends Report {
  target_kind: ReportTarget;
  target_id: Uuid;
  reason: string;
  reporter: UserSummary;
  created_at: IsoDateTime;
}
export interface ModerationActionRequest {
  action: 'dismiss' | 'hide_post' | 'suspend_user' | 'restore';
  reason: string;
}

// ---------- Wallet & DRC-20 ----------
// Dogecoin mainnet only. The backend never holds private keys or seed phrases.
// Wallet proof: POST /wallet/challenges -> sign `message` in the wallet (Dogecoin signed message) -> POST /wallet/connections.
// GET    /wallet/providers         -> { items: WalletProvider[] }  capability matrix
// POST   /wallet/challenges        WalletChallengeRequest -> 201 WalletChallenge (one use, 10 minute expiry, bound to domain + network)
// POST   /wallet/connections       WalletVerifyRequest -> 201 WalletConnection
// GET    /wallet/connections       -> { items: WalletConnection[] }
// DELETE /wallet/connections/:id   -> 204
// GET    /wallet/assets            -> WalletAssets
// GET    /tokens/:ticker           -> Token
export type Network = 'dogecoin-mainnet';
export interface WalletProvider {
  id: string; // e.g. 'manual'
  name: string;
  can_sign_message: boolean;
  can_sign_transaction: boolean;
  signing_method: 'copy_paste' | 'deep_link';
  notes: string;
}
export interface WalletChallengeRequest {
  address: string;
  provider: string;
}
export interface WalletChallenge {
  challenge_id: Uuid;
  message: string;
  expires_at: IsoDateTime;
}
export interface WalletVerifyRequest {
  challenge_id: Uuid;
  signature: string; // base64 compact signature
  provider: string;
}
export interface WalletConnection {
  id: Uuid;
  address: string;
  network: Network;
  provider: string;
  verified_at: IsoDateTime;
}

export type AssetStatus = 'unverified' | 'pending' | 'confirmed' | 'disputed';
export interface Token {
  id: Uuid;
  ticker: string;
  decimals: number;
  max_supply: string | null;
  deploy_txid: string;
}
export interface DogeBalance {
  wallet_id: Uuid;
  address: string;
  amount_koinu: string; // 1 DOGE = 100,000,000 koinu
  status: AssetStatus;
  indexed_height: number | null;
}
export interface Drc20Balance {
  wallet_id: Uuid;
  address: string;
  token: Token;
  amount_base_units: string;
  status: AssetStatus; // 'disputed' when independent indexers disagree
  indexed_height: number | null;
}
export interface WalletAssets {
  doge: DogeBalance[];
  drc20: Drc20Balance[];
  chain_height: number | null;
}

// ---------- Transfers ----------
// Multi-step: create intent -> prepare step -> sign externally -> submit signed -> broadcast -> confirming -> confirmed.
// Never reported as 'confirmed' before the required confirmations on the canonical chain.
// POST /transfers  (header Idempotency-Key)  CreateTransferRequest -> 201 Transfer
// GET  /transfers                            -> Page<Transfer>
// GET  /transfers/:id                        -> Transfer
// POST /transfers/:id/prepare                -> 201 SigningStep
// POST /transfers/:id/signed                 SignedStepRequest -> 201 Transfer
// POST /transfers/:id/broadcast              -> 201 Transfer
// POST /transfers/:id/cancel                 -> 201 Transfer (only before broadcast)
export type TransferStatus =
  | 'draft'
  | 'prepared'
  | 'awaiting_signature'
  | 'signed'
  | 'broadcast'
  | 'confirming'
  | 'confirmed'
  | 'failed'
  | 'reorged'
  | 'cancelled';
export interface CreateTransferRequest {
  wallet_id: Uuid;
  token_id: Uuid;
  recipient_address: string;
  amount_base_units: string; // ^[1-9][0-9]*$
}
export interface TransferStep {
  id: Uuid;
  step_index: number;
  kind: 'inscription' | 'transfer' | 'other';
  status: TransferStatus;
  txid: string | null;
  confirmations: number;
}
export interface Transfer {
  id: Uuid;
  status: TransferStatus;
  wallet_id: Uuid;
  from_address: string;
  token: Token;
  recipient_address: string;
  amount_base_units: string;
  network_fee_koinu: string | null;
  required_confirmations: number;
  steps: TransferStep[];
  error_code: string | null;
  error_detail: string | null;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}
export interface SigningStep {
  step_id: Uuid;
  step_index: number;
  kind: 'inscription' | 'transfer' | 'other';
  wallet_payload: { provider_format: 'psbt_hex' | 'unsigned_tx_hex'; data: string };
  network_fee_koinu: string;
  expires_at: IsoDateTime;
}
export interface SignedStepRequest {
  step_id: Uuid;
  signed_payload: string; // signed transaction hex
}
