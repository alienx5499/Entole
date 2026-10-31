create table if not exists users (
  id text primary key,
  paypal_user_id text not null unique,
  email text not null,
  name text not null,
  created_at timestamptz not null default now()
);
create table if not exists sessions (
  token text primary key,
  user_id text not null,
  expires_at timestamptz not null
);
create table if not exists taste (
  user_id text primary key,
  data jsonb not null
);
create table if not exists mandates (
  id text primary key,
  owner_id text not null,
  order_id text unique,
  status text not null,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
alter table mandates add column if not exists approve_url text;
create index if not exists mandates_owner_idx on mandates (owner_id);
create index if not exists mandates_funded_candidates_idx on mandates
  using gin ((data->'terms'->'candidates') jsonb_path_ops) where status = 'funded';
create table if not exists audit (
  id bigserial primary key,
  mandate_id text not null,
  at timestamptz not null,
  kind text not null,
  message text not null,
  data jsonb
);
create index if not exists audit_mandate_idx on audit (mandate_id, id);
create table if not exists webhook_events (
  id text primary key,
  received_at timestamptz not null default now()
);
create table if not exists api_tokens (
  id text primary key,
  user_id text not null,
  name text not null,
  hash text not null unique,
  created_at timestamptz not null,
  last_used_at timestamptz,
  revoked_at timestamptz
);
create index if not exists api_tokens_user_idx on api_tokens (user_id);
create table if not exists idempotency_keys (
  caller_id text not null,
  key text not null,
  route text not null,
  body_hash text not null,
  status integer,
  body text,
  expires_at timestamptz not null,
  primary key (caller_id, key)
);
alter table idempotency_keys add column if not exists claim_id text;
create index if not exists idempotency_keys_expires_idx on idempotency_keys (expires_at);
