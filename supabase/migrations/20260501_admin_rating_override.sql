alter table public.players
  add column if not exists rating_override numeric(3,1);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'players_rating_override_range_check'
      and conrelid = 'public.players'::regclass
  ) then
    alter table public.players
      add constraint players_rating_override_range_check
      check (rating_override is null or (rating_override >= 1 and rating_override <= 10)) not valid;
  end if;
end $$;
