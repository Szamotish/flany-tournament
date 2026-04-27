-- MMR history for profile chart

create table if not exists public.player_mmr_history (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  tournament_id uuid references public.tournaments(id) on delete set null,
  match_id uuid references public.tournament_matches(id) on delete set null,
  reason text not null default 'manual',
  delta numeric(5,2),
  mmr numeric(4,1) not null,
  prestige_points integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists player_mmr_history_player_created_idx
  on public.player_mmr_history(player_id, created_at asc);
