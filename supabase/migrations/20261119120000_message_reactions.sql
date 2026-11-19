-- Reacciones con expresiones de los gatitos: una por persona y mensaje.
-- Quitar una reacción = reaction null (sin DELETE, así Realtime avisa con un UPDATE filtrable por sala).

create table if not exists public.message_reactions (
  message_id uuid not null references public.messages(id) on delete cascade,
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  reaction text check (reaction is null or reaction in ('love', 'laugh', 'happy', 'wow', 'sad', 'angry')),
  updated_at timestamptz not null default now(),
  primary key (message_id, user_id)
);
alter table public.message_reactions enable row level security;
create index if not exists message_reactions_room_updated_idx on public.message_reactions (room_id, updated_at);

revoke all on public.message_reactions from anon, authenticated;
grant select on public.message_reactions to authenticated;

drop policy if exists message_reactions_select on public.message_reactions;
create policy message_reactions_select on public.message_reactions for select to authenticated
  using (public.is_room_member(room_id));

-- Reaccionar (o quitar con p_reaction = null). Valida que seas miembro de la sala del mensaje.
create or replace function public.react_to_message(p_message uuid, p_reaction text)
returns public.message_reactions language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  v_room uuid;
  r public.message_reactions;
begin
  select m.room_id into v_room from public.messages m where m.id = p_message;
  if v_room is null or me is null or not public.is_room_member(v_room) then
    raise exception 'not-member' using errcode = '42501';
  end if;
  insert into public.message_reactions (message_id, room_id, user_id, reaction, updated_at)
  values (p_message, v_room, me, p_reaction, now())
  on conflict (message_id, user_id)
  do update set reaction = excluded.reaction, updated_at = now()
  returning * into r;
  return r;
end;
$$;

revoke all on function public.react_to_message(uuid, text) from public, anon;
grant execute on function public.react_to_message(uuid, text) to authenticated;

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'message_reactions') then
    alter publication supabase_realtime add table public.message_reactions;
  end if;
end $$;
