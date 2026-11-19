-- Ajustes tras revisar los avisos de Supabase (seguridad y rendimiento). No toca datos.

-- 1) room_members: solo lectura para miembros; altas y bajas únicamente por join_room / create_group_room / leave_group.
--    Tenía todos los permisos para anon y authenticated (incluido TRUNCATE, que ignora RLS).
revoke all on public.room_members from anon, authenticated;
grant select on public.room_members to authenticated;

-- 2) Salir de una Manada: quien la creó también figura en rooms.user_1 y con eso seguía siendo miembro.
create or replace function public.leave_group(p_room uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  delete from public.room_members where room_id = p_room and user_id = auth.uid();
  update public.rooms set user_1 = null
   where id = p_room and kind = 'group' and user_1 = auth.uid();
end;
$$;

-- 3) Índices para las claves foráneas de user_id (borrar un perfil no recorre la tabla entera).
create index if not exists message_reactions_user_idx on public.message_reactions (user_id);
create index if not exists room_reads_user_idx on public.room_reads (user_id);
