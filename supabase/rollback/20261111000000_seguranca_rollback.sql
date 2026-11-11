-- =====================================================================
-- Easy Cut · VOLTAR ATRÁS a blindagem de segurança (20261111000000_seguranca.sql)
-- Use só se a blindagem causar problema. Cole no SQL Editor do Supabase e rode.
-- O que acontece:
--  * O app volta às regras da primeira versão (painel sem verificação em duas etapas).
--  * Dono e gerente voltam a ser "admin"; recepção e barbeiro voltam a ser clientes.
--  * Nenhum dado é apagado: o histórico de ações, o código de primeiro acesso e as colunas
--    novas do perfil (termos, barbeiro ligado) ficam guardados, só deixam de ser usados.
-- Depois de rodar, publique de novo a versão anterior do site (commit 1dd27de).
-- =====================================================================

begin;

-- 1. Histórico: para de registrar (os registros ficam guardados em private.audit_log).
drop trigger if exists audit_shop on public.shop;
drop trigger if exists audit_services on public.services;
drop trigger if exists audit_barbers on public.barbers;
drop trigger if exists audit_hours on public.business_hours;
drop trigger if exists audit_appointments on public.appointments;
drop trigger if exists audit_reviews on public.reviews;

-- 2. Funções que só existem na blindagem.
drop function if exists public.admin_audit_log(int);
drop function if exists public.admin_team();
drop function if exists public.admin_reset_mfa(uuid);
drop function if exists public.admin_reschedule(uuid, uuid, timestamptz);
drop function if exists public.admin_delete_block(uuid);
drop function if exists public.accept_terms(text);
drop function if exists public.my_data();
drop function if exists public.delete_my_account();
drop function if exists public.claim_owner(text);
drop function if exists public.admin_set_role(text, text, uuid);

-- 3. Papéis de volta a cliente e admin.
alter table public.profiles drop constraint if exists profiles_barber_link;
alter table public.profiles drop constraint if exists profiles_role_check;
update public.profiles set role = 'admin' where role in ('owner', 'manager');
update public.profiles set role = 'client' where role in ('reception', 'barber');
alter table public.profiles add constraint profiles_role_check check (role in ('client', 'admin'));

-- 4. Funções da primeira versão (copiadas de 20261110000000_easycut.sql).

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_phone text := regexp_replace(coalesce(new.raw_user_meta_data ->> 'phone', ''), '\D', '', 'g');
begin
  insert into public.profiles (id, full_name, phone)
  values (
    new.id,
    left(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), 80),
    case when v_phone ~ '^[0-9]{10,13}$' then v_phone end
  );
  return new;
end $$;

create or replace function public.get_availability(p_date date, p_service_ids uuid[], p_barber_id uuid default null)
returns table (barber_id uuid, starts_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare
  s public.shop;
  h public.business_hours;
  v_duration int;
  v_found int;
  v_wanted int;
  v_today date;
begin
  select * into s from public.shop where id = 1;
  v_today := (now() at time zone s.timezone)::date;
  if p_date is null or p_date < v_today or p_date > v_today + s.max_days_ahead then
    return;
  end if;

  select count(distinct x) into v_wanted from unnest(p_service_ids) x;
  select count(*), coalesce(sum(sv.duration_minutes), 0) into v_found, v_duration
    from public.services sv where sv.id = any (p_service_ids) and sv.active;
  if v_wanted = 0 or v_found <> v_wanted then
    return;
  end if;

  select * into h from public.business_hours bh where bh.weekday = extract(dow from p_date)::int;
  if not found or not h.is_open then
    return;
  end if;

  return query
  with grid as (
    select g as local_start, g + make_interval(mins => v_duration) as local_end
    from generate_series(
      p_date + h.opens,
      p_date + h.closes - make_interval(mins => v_duration),
      make_interval(mins => s.slot_minutes)
    ) g
  ), slots as (
    select (gr.local_start at time zone s.timezone) as st,
           (gr.local_end at time zone s.timezone) as en
    from grid gr
    where h.break_start is null
       or not (gr.local_start < p_date + h.break_end and gr.local_end > p_date + h.break_start)
  )
  select b.id, sl.st
  from slots sl
  cross join public.barbers b
  where b.active
    and (p_barber_id is null or b.id = p_barber_id)
    and sl.st >= now() + make_interval(mins => s.min_advance_minutes)
    and not exists (
      select 1 from public.appointments a
      where a.barber_id = b.id
        and a.status <> 'cancelled'
        and tstzrange(a.starts_at, a.ends_at, '[)') && tstzrange(sl.st, sl.en, '[)')
    )
  order by sl.st, b.sort, b.name;
end $$;

create or replace function public.book_appointment(
  p_service_ids uuid[], p_starts_at timestamptz, p_barber_id uuid default null, p_note text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  p public.profiles;
  s public.shop;
  v_day date;
  v_duration int;
  v_total int;
  v_active int;
  v_id uuid;
  c record;
begin
  if v_uid is null then
    raise exception 'LOGIN_NECESSARIO';
  end if;
  select * into p from public.profiles where id = v_uid;
  if not found or btrim(p.full_name) = '' or p.phone is null then
    raise exception 'PERFIL_INCOMPLETO';
  end if;
  select * into s from public.shop where id = 1;

  select count(*) into v_active from public.appointments a
    where a.client_id = v_uid and a.kind = 'booking' and a.status = 'confirmed' and a.ends_at > now();
  if v_active >= s.max_active_per_client then
    raise exception 'LIMITE_AGENDAMENTOS';
  end if;

  select sum(sv.duration_minutes), sum(sv.price_cents) into v_duration, v_total
    from public.services sv where sv.id = any (p_service_ids) and sv.active;
  v_day := (p_starts_at at time zone s.timezone)::date;

  for c in
    select av.barber_id
    from public.get_availability(v_day, p_service_ids, p_barber_id) av
    join public.barbers b on b.id = av.barber_id
    where av.starts_at = p_starts_at
    order by (
      select count(*) from public.appointments x
      where x.barber_id = av.barber_id and x.kind = 'booking' and x.status <> 'cancelled'
        and (x.starts_at at time zone s.timezone)::date = v_day
    ), b.sort, b.name
  loop
    begin
      insert into public.appointments
        (kind, barber_id, client_id, client_name, client_phone, starts_at, ends_at, total_cents, note, source)
      values
        ('booking', c.barber_id, v_uid, p.full_name, p.phone, p_starts_at,
         p_starts_at + make_interval(mins => v_duration), v_total, nullif(btrim(p_note), ''), 'app')
      returning id into v_id;
      exit;
    exception when exclusion_violation then
      v_id := null;  -- alguém pegou este barbeiro agora; tenta o próximo
    end;
  end loop;

  if v_id is null then
    raise exception 'HORARIO_INDISPONIVEL';
  end if;

  insert into public.appointment_services (appointment_id, service_id, name, duration_minutes, price_cents)
  select v_id, sv.id, sv.name, sv.duration_minutes, sv.price_cents
  from public.services sv where sv.id = any (p_service_ids) and sv.active;

  return v_id;
end $$;

create or replace function public.cancel_appointment(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  a public.appointments;
  s public.shop;
  v_admin boolean := public.is_admin();
begin
  select * into a from public.appointments where id = p_id for update;
  if not found or (not v_admin and a.client_id is distinct from auth.uid()) then
    raise exception 'NAO_ENCONTRADO';
  end if;
  if a.status <> 'confirmed' then
    raise exception 'NAO_PODE_CANCELAR';
  end if;
  select * into s from public.shop where id = 1;
  if not v_admin and a.starts_at < now() + make_interval(mins => s.cancel_limit_minutes) then
    raise exception 'PRAZO_CANCELAMENTO';
  end if;
  update public.appointments
    set status = 'cancelled', cancelled_at = now(), cancelled_by = case when v_admin then 'admin' else 'client' end
    where id = p_id;
end $$;

create or replace function public.set_appointment_status(p_id uuid, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  a public.appointments;
begin
  if not public.is_admin() then raise exception 'SEM_PERMISSAO'; end if;
  if p_status not in ('confirmed', 'completed', 'no_show') then raise exception 'STATUS_INVALIDO'; end if;
  select * into a from public.appointments where id = p_id for update;
  if not found or a.kind <> 'booking' then raise exception 'NAO_ENCONTRADO'; end if;
  if a.status = 'cancelled' then raise exception 'JA_CANCELADO'; end if;
  if p_status in ('completed', 'no_show') and a.starts_at > now() then raise exception 'AINDA_NAO_ACONTECEU'; end if;
  update public.appointments set status = p_status where id = p_id;
end $$;

create or replace function public.admin_create_booking(
  p_barber_id uuid, p_service_ids uuid[], p_starts_at timestamptz,
  p_client_name text, p_client_phone text default null, p_client_id uuid default null, p_note text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_duration int;
  v_total int;
  v_wanted int;
  v_found int;
  v_name text := btrim(coalesce(p_client_name, ''));
  v_phone text := nullif(regexp_replace(coalesce(p_client_phone, ''), '\D', '', 'g'), '');
  p public.profiles;
  v_id uuid;
begin
  if not public.is_admin() then raise exception 'SEM_PERMISSAO'; end if;
  if not exists (select 1 from public.barbers where id = p_barber_id) then raise exception 'BARBEIRO_INVALIDO'; end if;
  select count(distinct x) into v_wanted from unnest(p_service_ids) x;
  select count(*), sum(sv.duration_minutes), sum(sv.price_cents) into v_found, v_duration, v_total
    from public.services sv where sv.id = any (p_service_ids);
  if v_wanted = 0 or v_found <> v_wanted then raise exception 'SERVICO_INVALIDO'; end if;
  if p_client_id is not null then
    select * into p from public.profiles where id = p_client_id;
    if not found then raise exception 'CLIENTE_INVALIDO'; end if;
    v_name := coalesce(nullif(v_name, ''), p.full_name);
    v_phone := coalesce(v_phone, p.phone);
  end if;
  if v_name = '' then raise exception 'NOME_OBRIGATORIO'; end if;
  if v_phone is not null and v_phone !~ '^[0-9]{10,13}$' then raise exception 'TELEFONE_INVALIDO'; end if;

  begin
    insert into public.appointments
      (kind, barber_id, client_id, client_name, client_phone, starts_at, ends_at, total_cents, note, source)
    values
      ('booking', p_barber_id, p_client_id, left(v_name, 80), v_phone, p_starts_at,
       p_starts_at + make_interval(mins => v_duration), v_total, nullif(btrim(p_note), ''), 'admin')
    returning id into v_id;
  exception when exclusion_violation then
    raise exception 'HORARIO_INDISPONIVEL';
  end;

  insert into public.appointment_services (appointment_id, service_id, name, duration_minutes, price_cents)
  select v_id, sv.id, sv.name, sv.duration_minutes, sv.price_cents
  from public.services sv where sv.id = any (p_service_ids);
  return v_id;
end $$;

create or replace function public.admin_create_block(
  p_barber_id uuid, p_starts_at timestamptz, p_ends_at timestamptz, p_note text default null
) returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_count int := 0;
  b record;
begin
  if not public.is_admin() then raise exception 'SEM_PERMISSAO'; end if;
  if p_ends_at <= p_starts_at then raise exception 'INTERVALO_INVALIDO'; end if;
  for b in select id from public.barbers where active and (p_barber_id is null or id = p_barber_id) loop
    begin
      insert into public.appointments (kind, barber_id, starts_at, ends_at, note, source)
      values ('block', b.id, p_starts_at, p_ends_at, nullif(btrim(p_note), ''), 'admin');
    exception when exclusion_violation then
      raise exception 'CONFLITO_BLOQUEIO';
    end;
    v_count := v_count + 1;
  end loop;
  if v_count = 0 then raise exception 'BARBEIRO_INVALIDO'; end if;
  return v_count;
end $$;

create or replace function public.admin_clients()
returns table (
  client_id uuid, full_name text, phone text, email text, created_at timestamptz,
  bookings int, completed int, no_shows int, last_visit timestamptz, next_visit timestamptz
)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if not public.is_admin() then raise exception 'SEM_PERMISSAO'; end if;
  return query
  with b as (
    select a.*, coalesce(a.client_id::text, 'tel:' || coalesce(a.client_phone, lower(a.client_name))) as k
    from public.appointments a where a.kind = 'booking'
  ), agg as (
    select k,
      count(*) filter (where status <> 'cancelled')::int as bookings,
      count(*) filter (where status = 'completed' or (status = 'confirmed' and ends_at <= now()))::int as completed,
      count(*) filter (where status = 'no_show')::int as no_shows,
      max(starts_at) filter (where status in ('completed', 'confirmed') and starts_at <= now()) as last_visit,
      min(starts_at) filter (where status = 'confirmed' and starts_at > now()) as next_visit
    from b group by k
  )
  select p.id, p.full_name, p.phone, u.email::text, p.created_at,
         coalesce(g.bookings, 0), coalesce(g.completed, 0), coalesce(g.no_shows, 0), g.last_visit, g.next_visit
  from public.profiles p
  join auth.users u on u.id = p.id
  left join agg g on g.k = p.id::text
  where p.role = 'client'
  union all
  select null::uuid, w.client_name, w.client_phone, null::text, w.first_at,
         g.bookings, g.completed, g.no_shows, g.last_visit, g.next_visit
  from (
    select distinct on (k) k, client_name, client_phone, min(created_at) over (partition by k) as first_at
    from b where client_id is null order by k, created_at desc
  ) w
  join agg g on g.k = w.k
  order by 2;
end $$;

create or replace function public.admin_list_admins()
returns table (id uuid, full_name text, email text)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if not public.is_admin() then raise exception 'SEM_PERMISSAO'; end if;
  return query
  select p.id, p.full_name, u.email::text from public.profiles p join auth.users u on u.id = p.id
  where p.role = 'admin' order by p.full_name;
end $$;

create or replace function public.admin_set_role(p_email text, p_role text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if not public.is_admin() then raise exception 'SEM_PERMISSAO'; end if;
  if p_role not in ('client', 'admin') then raise exception 'PAPEL_INVALIDO'; end if;
  select u.id into v_id from auth.users u where lower(u.email) = lower(btrim(p_email));
  if v_id is null then raise exception 'USUARIO_NAO_ENCONTRADO'; end if;
  if p_role = 'client' and (select count(*) from public.profiles where role = 'admin' and id <> v_id) = 0 then
    raise exception 'ULTIMO_ADMIN';
  end if;
  update public.profiles set role = p_role where id = v_id;
end $$;

create or replace function public.panel_has_owner() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where role = 'admin');
$$;

create or replace function public.claim_owner() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'SEM_PERMISSAO'; end if;
  -- Um pedido por vez: duas contas nunca viram dono ao mesmo tempo.
  perform pg_advisory_xact_lock(hashtext('easycut_claim_owner'));
  if exists (select 1 from public.profiles where role = 'admin') then raise exception 'JA_TEM_DONO'; end if;
  update public.profiles set role = 'admin' where id = auth.uid();
  if not found then raise exception 'USUARIO_NAO_ENCONTRADO'; end if;
end $$;

-- 5. Regras de acesso da primeira versão.
drop policy if exists "profiles: só o próprio" on public.profiles;
drop policy if exists "profiles: só o próprio edita" on public.profiles;
drop policy if exists "appointments: o cliente e a equipe que atende" on public.appointments;
drop policy if exists "appointment_services: quem vê o agendamento" on public.appointment_services;
drop policy if exists "reviews: o autor e a equipe" on public.reviews;
drop policy if exists "reviews: dono e gerente apagam" on public.reviews;
drop policy if exists "profiles: o próprio ou admin" on public.profiles;
drop policy if exists "profiles: o próprio ou admin edita" on public.profiles;
drop policy if exists "appointments: o cliente vê os seus, admin vê tudo" on public.appointments;
drop policy if exists "appointments: admin cria" on public.appointments;
drop policy if exists "appointments: admin altera" on public.appointments;
drop policy if exists "appointments: admin apaga" on public.appointments;
drop policy if exists "reviews: o autor ou admin" on public.reviews;
drop policy if exists "reviews: admin apaga" on public.reviews;
create policy "profiles: o próprio ou admin" on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin());
create policy "profiles: o próprio ou admin edita" on public.profiles for update to authenticated
  using (id = auth.uid() or public.is_admin()) with check (id = auth.uid() or public.is_admin());

create policy "appointments: o cliente vê os seus, admin vê tudo" on public.appointments for select to authenticated
  using (client_id = auth.uid() or public.is_admin());
create policy "appointments: admin cria" on public.appointments for insert to authenticated with check (public.is_admin());
create policy "appointments: admin altera" on public.appointments for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "appointments: admin apaga" on public.appointments for delete to authenticated using (public.is_admin());

create policy "appointment_services: quem vê o agendamento" on public.appointment_services for select to authenticated
  using (exists (
    select 1 from public.appointments a
    where a.id = appointment_id and (a.client_id = auth.uid() or public.is_admin())
  ));

create policy "reviews: o autor ou admin" on public.reviews for select to authenticated
  using (client_id = auth.uid() or public.is_admin());
create policy "reviews: admin apaga" on public.reviews for delete to authenticated using (public.is_admin());
grant select, insert, update, delete on public.appointments to authenticated;

-- 6. Funções auxiliares da blindagem (depois das regras que dependiam delas).
drop function if exists public.can_see_barber(uuid);
drop function if exists public.my_barber_id();
drop function if exists public.is_owner();
drop function if exists public.can_front_desk();
drop function if exists public.is_staff();
drop function if exists public.staff_role();

-- 7. Quem pode chamar cada função (igual à primeira versão).
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.get_availability(date, uuid[], uuid) to anon, authenticated;
grant execute on function public.barber_ratings() to anon, authenticated;
grant execute on function public.is_admin() to anon, authenticated;
grant execute on function public.book_appointment(uuid[], timestamptz, uuid, text) to authenticated;
grant execute on function public.cancel_appointment(uuid) to authenticated;
grant execute on function public.rate_appointment(uuid, int, text) to authenticated;
grant execute on function public.set_appointment_status(uuid, text) to authenticated;
grant execute on function public.admin_create_booking(uuid, uuid[], timestamptz, text, text, uuid, text) to authenticated;
grant execute on function public.admin_create_block(uuid, timestamptz, timestamptz, text) to authenticated;
grant execute on function public.admin_clients() to authenticated;
grant execute on function public.admin_list_admins() to authenticated;
grant execute on function public.admin_set_role(text, text) to authenticated;
grant execute on function public.panel_has_owner() to authenticated;
grant execute on function public.claim_owner() to authenticated;

commit;
