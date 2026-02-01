PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS creators (
  id TEXT PRIMARY KEY,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT,
  country TEXT NOT NULL,
  city TEXT,
  declared_category TEXT,
  status TEXT NOT NULL DEFAULT 'lead',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS consent_records (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL,
  consent_type TEXT NOT NULL,
  granted INTEGER NOT NULL,
  text_version TEXT NOT NULL,
  text_hash TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  granted_at TEXT NOT NULL,
  revoked_at TEXT,
  revoke_reason TEXT,
  FOREIGN KEY (creator_id) REFERENCES creators(id)
);

CREATE TABLE IF NOT EXISTS connected_accounts (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  ig_user_id TEXT,
  username TEXT,
  account_type TEXT NOT NULL DEFAULT 'unknown',
  scopes TEXT,
  access_token_enc TEXT,
  token_expires_at TEXT,
  connected_at TEXT NOT NULL,
  disconnected_at TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  last_sync_at TEXT,
  FOREIGN KEY (creator_id) REFERENCES creators(id)
);

CREATE TABLE IF NOT EXISTS profile_snapshots (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  snapshot_date TEXT NOT NULL,
  followers_count INTEGER,
  follows_count INTEGER,
  media_count INTEGER,
  bio_text TEXT,
  website TEXT,
  is_verified INTEGER,
  created_at TEXT NOT NULL,
  FOREIGN KEY (account_id) REFERENCES connected_accounts(id)
);

CREATE TABLE IF NOT EXISTS content_metrics_daily (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  day TEXT NOT NULL,
  posts_count INTEGER NOT NULL DEFAULT 0,
  reels_count INTEGER NOT NULL DEFAULT 0,
  likes_total INTEGER,
  comments_total INTEGER,
  shares_total INTEGER,
  saves_total INTEGER,
  views_total INTEGER,
  reach_total INTEGER,
  impressions_total INTEGER,
  profile_visits_total INTEGER,
  website_clicks_total INTEGER,
  created_at TEXT NOT NULL,
  FOREIGN KEY (account_id) REFERENCES connected_accounts(id)
);

CREATE TABLE IF NOT EXISTS creator_scores (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL,
  score_total INTEGER NOT NULL,
  grade TEXT NOT NULL,
  er_score INTEGER NOT NULL,
  reach_score INTEGER NOT NULL,
  consistency_score INTEGER NOT NULL,
  niche_score INTEGER NOT NULL,
  fraud_penalty INTEGER NOT NULL,
  scoring_version TEXT NOT NULL,
  computed_at TEXT NOT NULL,
  FOREIGN KEY (creator_id) REFERENCES creators(id)
);

CREATE TABLE IF NOT EXISTS niche_classification (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL,
  primary_niche TEXT NOT NULL,
  secondary_niches TEXT,
  confidence REAL NOT NULL,
  evidence_keywords TEXT,
  model_version TEXT NOT NULL,
  computed_at TEXT NOT NULL,
  FOREIGN KEY (creator_id) REFERENCES creators(id)
);

CREATE TABLE IF NOT EXISTS brand_targets (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL,
  target_type TEXT NOT NULL,
  segment TEXT NOT NULL,
  suggested_brands TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  FOREIGN KEY (creator_id) REFERENCES creators(id)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  actor_type TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  metadata TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS deletion_requests (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  status TEXT NOT NULL,
  completed_at TEXT,
  notes TEXT,
  FOREIGN KEY (creator_id) REFERENCES creators(id)
);

CREATE INDEX IF NOT EXISTS idx_creators_status ON creators(status);
CREATE INDEX IF NOT EXISTS idx_scores_creator ON creator_scores(creator_id, computed_at);
CREATE INDEX IF NOT EXISTS idx_accounts_creator ON connected_accounts(creator_id, status);
