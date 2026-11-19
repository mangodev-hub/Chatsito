-- Day & Night Sync: chat para dos personas.
-- Requiere "Allow anonymous sign-ins" activado (Authentication → Sign In / Providers).
-- Cada dispositivo inicia sesión anónima; profiles.id = auth.uid(); cada sala tiene 2 asientos.

alter table public.profiles alter column id set default auth.uid();
alter table public.rooms alter column user_1 set default auth.uid();
alter table public.rooms add column if not exists released_user uuid;

-- "Visto": última lectura de cada miembro
create table if not exists public.room_reads (
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (room_id, user_id)
);
alter table public.room_reads enable row level security;

create index if not exists messages_room_created_idx on public.messages (room_id, created_at desc);

-- ---------- helpers (security definer: evitan recursión de RLS)
create or replace function public.is_room_member(p_room uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.rooms r
    where r.id = p_room and (select auth.uid()) in (r.user_1, r.user_2)
  );
$$;

create or replace function public.shares_room_with(p_profile uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.rooms r
    where (select auth.uid()) in (r.user_1, r.user_2) and p_profile in (r.user_1, r.user_2)
  );
$$;

create or replace function public.is_room_topic_member(p_topic text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.rooms r
    where 'room:' || r.id::text = p_topic and (select auth.uid()) in (r.user_1, r.user_2)
  );
$$;

-- ---------- permisos: fuera anon, lo mínimo para authenticated
revoke all on public.profiles, public.rooms, public.messages, public.room_reads from anon, authenticated;
grant select, insert on public.profiles to authenticated;
grant update (username, avatar_type) on public.profiles to authenticated;
grant select on public.rooms to authenticated;
grant insert (room_code, user_1) on public.rooms to authenticated;
grant select on public.messages to authenticated;
grant insert (id, room_id, sender_id, content, is_secret, emotion) on public.messages to authenticated;
grant update (sticker_reaction) on public.messages to authenticated;
grant select on public.room_reads to authenticated;

-- ---------- políticas
drop policy if exists profiles_select on public.profiles;
drop policy if exists profiles_insert on public.profiles;
drop policy if exists profiles_update on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or public.shares_room_with(id));
create policy profiles_insert on public.profiles for insert to authenticated
  with check (id = (select auth.uid()));
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

drop policy if exists rooms_select on public.rooms;
drop policy if exists rooms_insert on public.rooms;
drop policy if exists rooms_join on public.rooms;
create policy rooms_select on public.rooms for select to authenticated
  using ((select auth.uid()) in (user_1, user_2));
create policy rooms_insert on public.rooms for insert to authenticated
  with check (user_1 = (select auth.uid()));

drop policy if exists messages_select on public.messages;
drop policy if exists messages_insert on public.messages;
drop policy if exists messages_update on public.messages;
create policy messages_select on public.messages for select to authenticated
  using (public.is_room_member(room_id));
create policy messages_insert on public.messages for insert to authenticated
  with check (sender_id = (select auth.uid()) and public.is_room_member(room_id));
create policy messages_update on public.messages for update to authenticated
  using (public.is_room_member(room_id)) with check (public.is_room_member(room_id));

drop policy if exists room_reads_select on public.room_reads;
create policy room_reads_select on public.room_reads for select to authenticated
  using (public.is_room_member(room_id));

-- ---------- RPC: unirse / recuperar asiento
-- Toma un asiento vacío, el liberado por el compañero, o el de un perfil antiguo sin cuenta
-- (salas creadas antes de esta migración; prefiere el del mismo gatito).
-- Si el asiento tenía dueño, sus mensajes pasan al nuevo dueño.
create or replace function public.join_room(p_code text)
returns public.rooms language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  r public.rooms;
  my_avatar text;
  seat int;
  old_user uuid;
begin
  if me is null then raise exception 'not-authenticated' using errcode = '28000'; end if;
  select avatar_type into my_avatar from public.profiles where id = me;
  if my_avatar is null then raise exception 'no-profile' using errcode = 'P0001'; end if;

  select * into r from public.rooms where room_code = upper(trim(p_code)) for update;
  if not found then raise exception 'not-found' using errcode = 'P0002'; end if;
  if me in (r.user_1, r.user_2) then return r; end if;

  if r.user_2 is null then seat := 2;
  elsif r.user_1 is null then seat := 1;
  elsif r.released_user is not null and r.released_user in (r.user_1, r.user_2) then
    seat := case when r.user_1 = r.released_user then 1 else 2 end;
  else
    select s.n into seat from (
      select 1 as n, r.user_1 as u union all select 2, r.user_2
    ) s
    join public.profiles p on p.id = s.u
    where not exists (select 1 from auth.users au where au.id = s.u)
    order by (p.avatar_type = my_avatar) desc, s.n
    limit 1;
  end if;

  if seat is null then raise exception 'full' using errcode = 'P0001'; end if;

  old_user := case seat when 1 then r.user_1 else r.user_2 end;
  if old_user is not null then
    update public.messages set sender_id = me where room_id = r.id and sender_id = old_user;
    delete from public.room_reads where room_id = r.id and user_id = old_user;
  end if;

  if seat = 1 then
    update public.rooms set user_1 = me, released_user = null where id = r.id returning * into r;
  else
    update public.rooms set user_2 = me, released_user = null where id = r.id returning * into r;
  end if;
  return r;
end;
$$;

-- El compañero cambió de teléfono: su asiento queda reclamable con el código (sus mensajes se conservan).
create or replace function public.release_partner_seat(p_room uuid)
returns public.rooms language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  r public.rooms;
begin
  select * into r from public.rooms where id = p_room for update;
  if not found or me is null or me not in (r.user_1, r.user_2) then
    raise exception 'not-member' using errcode = '42501';
  end if;
  update public.rooms
     set released_user = case when r.user_1 = me then r.user_2 else r.user_1 end
   where id = p_room returning * into r;
  return r;
end;
$$;

-- "Visto": solo avanza, nunca retrocede
create or replace function public.mark_read(p_room uuid, p_at timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_room_member(p_room) then raise exception 'not-member' using errcode = '42501'; end if;
  insert into public.room_reads (room_id, user_id, last_read_at)
  values (p_room, auth.uid(), least(p_at, now()))
  on conflict (room_id, user_id)
  do update set last_read_at = greatest(public.room_reads.last_read_at, excluded.last_read_at);
end;
$$;

revoke all on function public.join_room(text), public.release_partner_seat(uuid), public.mark_read(uuid, timestamptz),
  public.is_room_member(uuid), public.shares_room_with(uuid), public.is_room_topic_member(text) from public, anon;
grant execute on function public.join_room(text), public.release_partner_seat(uuid), public.mark_read(uuid, timestamptz),
  public.is_room_member(uuid), public.shares_room_with(uuid), public.is_room_topic_member(text) to authenticated;

-- ---------- Realtime: canal privado "room:<uuid>" solo para los 2 miembros
drop policy if exists room_members_receive on realtime.messages;
drop policy if exists room_members_send on realtime.messages;
create policy room_members_receive on realtime.messages for select to authenticated
  using (realtime.messages.extension in ('broadcast', 'presence')
         and public.is_room_topic_member((select realtime.topic())));
create policy room_members_send on realtime.messages for insert to authenticated
  with check (realtime.messages.extension in ('broadcast', 'presence')
              and public.is_room_topic_member((select realtime.topic())));

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'room_reads') then
    alter publication supabase_realtime add table public.room_reads;
  end if;
end $$;
