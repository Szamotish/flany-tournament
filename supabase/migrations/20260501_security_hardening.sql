create table if not exists public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  actor_user_id uuid,
  actor_player_id uuid references public.players(id) on delete set null,
  action text not null,
  target_type text not null,
  target_id text,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists admin_audit_log_created_at_idx
  on public.admin_audit_log (created_at desc);

create index if not exists admin_audit_log_actor_player_id_idx
  on public.admin_audit_log (actor_player_id);

create index if not exists admin_audit_log_action_idx
  on public.admin_audit_log (action);

alter table public.admin_audit_log enable row level security;

drop policy if exists "main admins can read audit log" on public.admin_audit_log;
create policy "main admins can read audit log"
  on public.admin_audit_log
  for select
  using (
    exists (
      select 1
      from public.players p
      where p.auth_user_id = auth.uid()
        and p.is_main_admin = true
    )
  );

drop policy if exists "service role can write audit log" on public.admin_audit_log;
create policy "service role can write audit log"
  on public.admin_audit_log
  for insert
  with check (auth.role() = 'service_role');

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'players_name_length_check'
      and conrelid = 'public.players'::regclass
  ) then
    alter table public.players
      add constraint players_name_length_check
      check (char_length(name) between 1 and 80) not valid;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'ratings_value_range_check'
      and conrelid = 'public.ratings'::regclass
  ) then
    alter table public.ratings
      add constraint ratings_value_range_check
      check (value between 1 and 10) not valid;
  end if;
end $$;
