-- ============================================================
-- Bybit Claude Bot — Supabase Schema
-- Run this in your Supabase SQL editor to create all tables
-- ============================================================

-- Closed trades log
create table if not exists trades (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz default now(),
  symbol        text not null,
  side          text not null check (side in ('long','short')),
  entry_price   numeric not null,
  exit_price    numeric not null,
  qty           numeric not null,
  leverage      int not null default 1,
  pnl_usd       numeric not null,
  pnl_pct       numeric not null,
  hold_minutes  int,
  entry_time    timestamptz,
  exit_time     timestamptz,
  rationale     text,
  exit_reason   text,
  order_ids     jsonb
);

-- Open positions (upserted each cycle, deleted on close)
create table if not exists positions (
  id            uuid primary key default gen_random_uuid(),
  updated_at    timestamptz default now(),
  symbol        text unique not null,
  side          text not null check (side in ('long','short')),
  entry_price   numeric not null,
  current_price numeric,
  qty           numeric not null,
  leverage      int not null default 1,
  stop_loss     numeric,
  take_profit   numeric,
  unrealised_pnl numeric,
  unrealised_pct numeric,
  rationale     text,
  entry_time    timestamptz default now()
);

-- Equity snapshots (written once per cycle)
create table if not exists equity_snapshots (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz default now(),
  equity_usd    numeric not null,
  available_usd numeric,
  daily_pnl     numeric,
  daily_pnl_pct numeric,
  drawdown_pct  numeric,
  open_positions int default 0,
  note          text
);

-- Claude decision log (every reasoning cycle)
create table if not exists decisions (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz default now(),
  cycle_type    text not null check (cycle_type in ('entry_scan','position_check')),
  symbol        text,
  action        text not null,
  reasoning     text,
  market_data   jsonb,
  risk_check    jsonb,
  executed      boolean default false,
  error         text
);

-- Audit log (every MCP write call)
create table if not exists audit_log (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz default now(),
  tool_name     text not null,
  params        jsonb,
  response      jsonb,
  risk_passed   boolean,
  risk_reason   text
);

-- Indexes for dashboard queries
create index if not exists trades_created_at_idx on trades(created_at desc);
create index if not exists trades_symbol_idx on trades(symbol);
create index if not exists equity_snapshots_created_at_idx on equity_snapshots(created_at desc);
create index if not exists decisions_created_at_idx on decisions(created_at desc);
create index if not exists audit_log_created_at_idx on audit_log(created_at desc);

-- Row-level security (enable, read-only for anon key)
alter table trades            enable row level security;
alter table positions         enable row level security;
alter table equity_snapshots  enable row level security;
alter table decisions         enable row level security;
alter table audit_log         enable row level security;

create policy "anon read trades"           on trades            for select using (true);
create policy "anon read positions"        on positions         for select using (true);
create policy "anon read equity"           on equity_snapshots  for select using (true);
create policy "anon read decisions"        on decisions         for select using (true);
create policy "anon read audit"            on audit_log         for select using (true);

-- Service role has full access (used by the bot via SUPABASE_SERVICE_KEY)
