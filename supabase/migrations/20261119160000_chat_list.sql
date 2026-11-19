-- "Tus chats": lista de salas en el menú principal, ocultar un chat solo para mí y borrar un 1 a 1 para las dos.

-- Chats ocultos por cada usuario. Si llega un mensaje después de ocultarlo, vuelve a aparecer.
create table if not exists public.room_hidden (
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  hidden_at timestamptz not null default now(),
  primary key (user_id, room_id)
);
alter table public.room_hidden enable row level security;
create index if not exists room_hidden_room_idx on public.room_hidden (room_id);

revoke all on public.room_hidden from anon, authenticated;
grant select on public.room_hidden to authenticated;
drop policy if exists room_hidden_select on public.room_hidden;
create policy room_hidden_select on public.room_hidden for select to authenticated
  using (user_id = (select auth.uid()));

-- Mis salas con lo necesario para la lista (security invoker: las reglas de cada tabla siguen aplicando).
create or replace function public.my_rooms()
returns table (
  room_id uuid,
  room_code text,
  kind text,
  name text,
  room_created_at timestamptz,
  partner_id uuid,
  partner_username text,
  partner_avatar text,
  member_count int,
  member_avatars text[],
  last_content text,
  last_is_secret boolean,
  last_sender_id uuid,
  last_at timestamptz,
  unread int
)
language sql stable security invoker set search_path = '' as $$
  with me as (select (select auth.uid()) as id),
  mine as (
    select r.* from public.rooms r cross join me
    where me.id in (r.user_1, r.user_2)
       or exists (select 1 from public.room_members m where m.room_id = r.id and m.user_id = me.id)
  )
  select
    r.id, r.room_code, r.kind, r.name, r.created_at,
    p.id, p.username, p.avatar_type,
    (select count(*) from public.room_members m where m.room_id = r.id)::int,
    (select array_agg(x.avatar_type order by x.joined_at) from (
       select pp.avatar_type, m.joined_at from public.room_members m
       join public.profiles pp on pp.id = m.user_id
       where m.room_id = r.id order by m.joined_at limit 4) x),
    lm.content, lm.is_secret, lm.sender_id, lm.created_at,
    (select count(*) from public.messages x
      where x.room_id = r.id and x.sender_id <> me.id
        and x.created_at > coalesce(
          (select rr.last_read_at from public.room_reads rr where rr.room_id = r.id and rr.user_id = me.id),
          '-infinity'::timestamptz))::int
  from mine r
  cross join me
  left join public.profiles p
    on r.kind = 'duo' and p.id = case when r.user_1 = me.id then r.user_2 else r.user_1 end
  left join lateral (
    select mm.content, mm.is_secret, mm.sender_id, mm.created_at from public.messages mm
    where mm.room_id = r.id order by mm.created_at desc limit 1
  ) lm on true
  left join public.room_hidden h on h.room_id = r.id and h.user_id = me.id
  where h.room_id is null or (lm.created_at is not null and lm.created_at > h.hidden_at)
  order by coalesce(lm.created_at, r.created_at) desc;
$$;

-- Quitar un chat de MI lista (la otra persona no se entera ni pierde nada).
create or replace function public.hide_room(p_room uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_room_member(p_room) then raise exception 'not-member' using errcode = '42501'; end if;
  insert into public.room_hidden (room_id, user_id, hidden_at) values (p_room, auth.uid(), now())
  on conflict (user_id, room_id) do update set hidden_at = now();
end;
$$;

-- Borrar un chat 1 a 1 PARA LAS DOS: sala, mensajes, reacciones y "visto". Sin vuelta atrás.
-- Antes avisa por el canal privado de la sala a quien la tenga abierta.
create or replace function public.delete_room(p_room uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  r public.rooms;
begin
  select * into r from public.rooms where id = p_room for update;
  if not found or not public.is_room_member(p_room) then
    raise exception 'not-member' using errcode = '42501';
  end if;
  if r.kind <> 'duo' then raise exception 'only-duo' using errcode = 'P0001'; end if;
  perform realtime.send(
    jsonb_build_object('type', 'room-deleted', 'senderId', auth.uid()),
    'cat-action', 'room:' || p_room::text, true);
  delete from public.rooms where id = p_room;
end;
$$;

revoke all on function public.my_rooms(), public.hide_room(uuid), public.delete_room(uuid) from public, anon;
grant execute on function public.my_rooms(), public.hide_room(uuid), public.delete_room(uuid) to authenticated;
