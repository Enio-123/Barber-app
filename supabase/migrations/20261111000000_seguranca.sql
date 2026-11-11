-- =====================================================================
-- Easy Cut · blindagem de segurança
--  1. Código de primeiro acesso: o painel sem dono só é assumido por quem tem o código.
--  2. Verificação em duas etapas (app autenticador) obrigatória para a equipe:
--     o banco só libera o painel para sessões verificadas (aal2).
--  3. Papéis com o mínimo de acesso: dono, gerente, recepção e barbeiro.
--  4. A agenda só muda por funções que conferem a permissão (sem escrita direta na tabela).
--  5. Histórico das ações da equipe (ninguém altera; só o dono lê).
--  6. Limites contra abuso no agendamento.
--  7. LGPD: aceite dos termos, baixar os próprios dados e excluir a própria conta.
-- Só acrescenta e substitui regras e funções. Nenhum dado é apagado.
-- Para desfazer: supabase/rollback/20261111000000_seguranca_rollback.sql
-- =====================================================================

-- Área interna: não aparece na API do Supabase (só o banco usa).
create schema if not exists private;
revoke all on schema private from public;

-- ---------------------------------------------------------------------
-- 1. Papéis da equipe e aceite dos termos
-- ---------------------------------------------------------------------

alter table public.profiles drop constraint if exists profiles_role_check;
update public.profiles set role = 'owner' where role = 'admin';
alter table public.profiles
  add constraint profiles_role_check check (role in ('client', 'barber', 'reception', 'manager', 'owner')),
  add column if not exists barber_id uuid references public.barbers (id) on delete set null,
  add column if not exists terms_version text check (terms_version ~ '^[0-9a-z.-]{1,20}$'),
  add column if not exists terms_accepted_at timestamptz;
alter table public.profiles drop constraint if exists profiles_barber_link;
alter table public.profiles add constraint profiles_barber_link check (role = 'barber' or barber_id is null);

-- Papel de quem está no painel. Só vale depois da verificação em duas etapas (aal2) e enquanto a
-- sessão existir: sair de todos os aparelhos, trocar de papel ou zerar a verificação corta o acesso
-- na hora, sem esperar o token vencer.
create or replace function public.staff_role() returns text
language sql stable security definer set search_path = '' as $$
  select p.role from public.profiles p
  where p.id = auth.uid()
    and p.role <> 'client'
    and coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
    and exists (
      select 1 from auth.sessions s
      where s.id = nullif(auth.jwt() ->> 'session_id', '')::uuid
        and s.user_id = p.id
        and (s.not_after is null or s.not_after > now())
    );
$$;

create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.staff_role() is not null;
$$;

-- Dono e gerente: cadastro da barbearia (serviços, barbeiros, horários, dados e regras) e avaliações.
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.staff_role() in ('owner', 'manager'), false);
$$;

-- Dono, gerente e recepção: agenda de todos os barbeiros e lista de clientes.
create or replace function public.can_front_desk() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.staff_role() in ('owner', 'manager', 'reception'), false);
$$;

create or replace function public.is_owner() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.staff_role() = 'owner', false);
$$;

-- Barbeiro: só a própria agenda (o dono liga a conta ao barbeiro em Ajustes, Equipe).
create or replace function public.my_barber_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select p.barber_id from public.profiles p
  where p.id = auth.uid() and public.staff_role() = 'barber';
$$;

-- Sempre true ou false (nunca nulo): um "nulo" dentro de um if passaria direto pela checagem.
create or replace function public.can_see_barber(p_barber_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.can_front_desk() or (p_barber_id is not null and p_barber_id = public.my_barber_id()), false);
$$;

-- ---------------------------------------------------------------------
-- 2. Regras de acesso (RLS) que mudam
-- (serviços, barbeiros, horários e dados da barbearia continuam usando is_admin, agora com aal2)
-- ---------------------------------------------------------------------

drop policy if exists "profiles: o próprio ou admin" on public.profiles;
drop policy if exists "profiles: o próprio ou admin edita" on public.profiles;
drop policy if exists "profiles: só o próprio" on public.profiles;
drop policy if exists "profiles: só o próprio edita" on public.profiles;
create policy "profiles: só o próprio" on public.profiles for select to authenticated
  using (id = (select auth.uid()));
create policy "profiles: só o próprio edita" on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- Agenda: leitura pela regra; qualquer mudança só pelas funções (que conferem permissão e prazos).
drop policy if exists "appointments: o cliente vê os seus, admin vê tudo" on public.appointments;
drop policy if exists "appointments: admin cria" on public.appointments;
drop policy if exists "appointments: admin altera" on public.appointments;
drop policy if exists "appointments: admin apaga" on public.appointments;
drop policy if exists "appointments: o cliente e a equipe que atende" on public.appointments;
revoke insert, update, delete on public.appointments from anon, authenticated;
create policy "appointments: o cliente e a equipe que atende" on public.appointments
  for select to authenticated
  using (
    client_id = (select auth.uid())
    or (select public.can_front_desk())
    or barber_id = (select public.my_barber_id())
  );

drop policy if exists "appointment_services: quem vê o agendamento" on public.appointment_services;
create policy "appointment_services: quem vê o agendamento" on public.appointment_services for select to authenticated
  using (exists (
    select 1 from public.appointments a
    where a.id = appointment_id
      and (a.client_id = (select auth.uid()) or (select public.can_front_desk()) or a.barber_id = (select public.my_barber_id()))
  ));

drop policy if exists "reviews: o autor ou admin" on public.reviews;
drop policy if exists "reviews: admin apaga" on public.reviews;
drop policy if exists "reviews: o autor e a equipe" on public.reviews;
drop policy if exists "reviews: dono e gerente apagam" on public.reviews;
create policy "reviews: o autor e a equipe" on public.reviews for select to authenticated
  using (
    client_id = (select auth.uid())
    or (select public.can_front_desk())
    or barber_id = (select public.my_barber_id())
  );
create policy "reviews: dono e gerente apagam" on public.reviews for delete to authenticated
  using ((select public.is_admin()));

-- ---------------------------------------------------------------------
-- 3. Histórico de ações (só inserção; ninguém da API lê ou altera direto)
-- ---------------------------------------------------------------------

create table if not exists private.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor uuid,
  actor_role text,
  action text not null,
  entity text not null,
  entity_id text,
  details jsonb
);
create index if not exists audit_log_at_idx on private.audit_log (at desc);

create or replace function private.log(p_action text, p_entity text, p_entity_id text, p_details jsonb default null)
returns void
language sql security definer set search_path = '' as $$
  insert into private.audit_log (actor, actor_role, action, entity, entity_id, details)
  values (auth.uid(), (select role from public.profiles where id = auth.uid()), p_action, p_entity, p_entity_id, p_details);
$$;

-- Registra o que mudou em cada linha. Os argumentos do gatilho são colunas que não entram no histórico
-- (foto, nome e telefone do cliente, observação, comentário): fica só a marca de que mudaram.
-- Assim o histórico não guarda dados pessoais de clientes; quem lê vê o nome atual pela própria agenda.
create or replace function private.audit_row() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_role text := (select role from public.profiles where id = auth.uid());
  v_hide text[] := coalesce(tg_argv, '{}'::text[]);
  v_diff jsonb := '{}'::jsonb;
  k text;
begin
  -- O que o próprio cliente faz (agendar, cancelar, excluir a conta) já fica no agendamento; aqui vai o que a equipe faz.
  if auth.uid() is not null and coalesce(v_role, 'client') = 'client' then
    return null;
  end if;
  if tg_op = 'UPDATE' then
    for k in select jsonb_object_keys(v_new) loop
      if k <> 'updated_at' and v_new -> k is distinct from v_old -> k then
        v_diff := v_diff || jsonb_build_object(k,
          case when k = any (v_hide) then to_jsonb('alterado'::text)
               else jsonb_build_object('de', v_old -> k, 'para', v_new -> k) end);
      end if;
    end loop;
    if v_diff = '{}'::jsonb then return null; end if;
  else
    v_diff := v_row - v_hide;
  end if;
  insert into private.audit_log (actor, actor_role, action, entity, entity_id, details)
  values (auth.uid(), coalesce(v_role, case when auth.uid() is null then 'sistema' end),
          lower(tg_op), tg_table_name, coalesce(v_row ->> 'id', v_row ->> 'weekday'), v_diff);
  return null;
end $$;

drop trigger if exists audit_shop on public.shop;
drop trigger if exists audit_services on public.services;
drop trigger if exists audit_barbers on public.barbers;
drop trigger if exists audit_hours on public.business_hours;
drop trigger if exists audit_appointments on public.appointments;
drop trigger if exists audit_reviews on public.reviews;
create trigger audit_shop after update on public.shop
  for each row execute function private.audit_row();
create trigger audit_services after insert or update or delete on public.services
  for each row execute function private.audit_row();
create trigger audit_barbers after insert or update or delete on public.barbers
  for each row execute function private.audit_row('photo');
create trigger audit_hours after update on public.business_hours
  for each row execute function private.audit_row();
create trigger audit_appointments after insert or update or delete on public.appointments
  for each row execute function private.audit_row('client_name', 'client_phone', 'note');
create trigger audit_reviews after delete on public.reviews
  for each row execute function private.audit_row('comment');

-- Dono: últimas ações da equipe. "target" diz em quem ou no que foi a ação, pelo estado atual
-- (cliente que excluiu a conta aparece como "Cliente removido").
drop function if exists public.admin_audit_log(int);
create or replace function public.admin_audit_log(p_limit int default 200)
returns table (at timestamptz, actor_name text, actor_role text, action text, entity text, entity_id text,
               target text, details jsonb)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if not public.is_owner() then raise exception 'SEM_PERMISSAO'; end if;
  return query
  select l.at,
         coalesce(nullif(p.full_name, ''), case when l.actor is null then 'Sistema' else 'Conta removida' end),
         l.actor_role, l.action, l.entity, l.entity_id,
         case l.entity
           when 'profiles' then (select coalesce(nullif(t.full_name, ''), 'Sem nome') from public.profiles t where t.id::text = l.entity_id)
           when 'appointments' then (
             select case when a.kind = 'block' then 'Bloqueio' else a.client_name end
                    || ' · ' || to_char(a.starts_at at time zone sh.timezone, 'DD/MM HH24:MI')
             from public.appointments a where a.id::text = l.entity_id)
           when 'services' then coalesce((select v.name from public.services v where v.id::text = l.entity_id), l.details ->> 'name')
           when 'barbers' then coalesce((select b.name from public.barbers b where b.id::text = l.entity_id), l.details ->> 'name')
           when 'business_hours' then case when l.entity_id ~ '^[0-6]$' then
             (array['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'])[l.entity_id::int + 1] end
           when 'shop' then 'Dados da barbearia'
         end,
         l.details
  from private.audit_log l
  left join public.profiles p on p.id = l.actor
  cross join (select timezone from public.shop where id = 1) sh
  order by l.at desc, l.id desc
  limit least(greatest(coalesce(p_limit, 200), 1), 500);
end $$;

-- ---------------------------------------------------------------------
-- 4. Primeiro acesso com código
-- ---------------------------------------------------------------------

create table if not exists private.owner_claim (
  id smallint primary key default 1 check (id = 1),
  code_hash text not null,
  created_at timestamptz not null default now(),
  attempts int not null default 0,
  used_at timestamptz
);

-- Gera um código novo (só quem administra o projeto no Supabase consegue rodar: select private.new_owner_code();).
-- Guarda só o hash; o código aparece uma vez, na resposta.
create or replace function private.new_owner_code() returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_bytes bytea := extensions.gen_random_bytes(10);
  v_code text := '';
begin
  for i in 0..9 loop
    v_code := v_code || substr(v_alphabet, (get_byte(v_bytes, i) % 32) + 1, 1);
  end loop;
  v_code := substr(v_code, 1, 5) || '-' || substr(v_code, 6, 5);
  insert into private.owner_claim (id, code_hash)
  values (1, extensions.crypt(v_code, extensions.gen_salt('bf', 10)))
  on conflict (id) do update
    set code_hash = excluded.code_hash, created_at = now(), attempts = 0, used_at = null;
  return v_code;
end $$;

create or replace function public.panel_has_owner() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where role = 'owner');
$$;

-- Devolve OK, JA_TEM_DONO, SEM_CODIGO, CODIGO_INVALIDO ou CODIGO_BLOQUEADO (depois de 10 erros).
-- Não usa exceção nos erros de código para a contagem de tentativas ficar gravada.
drop function if exists public.claim_owner();
create or replace function public.claim_owner(p_code text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  c private.owner_claim;
  v_code text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
begin
  if auth.uid() is null then raise exception 'SEM_PERMISSAO'; end if;
  -- Um pedido por vez: duas contas nunca viram dono ao mesmo tempo.
  perform pg_advisory_xact_lock(hashtext('easycut_claim_owner'));
  if exists (select 1 from public.profiles where role = 'owner') then return 'JA_TEM_DONO'; end if;
  select * into c from private.owner_claim where id = 1 for update;
  if not found or c.used_at is not null then return 'SEM_CODIGO'; end if;
  if c.attempts >= 10 then return 'CODIGO_BLOQUEADO'; end if;
  if length(v_code) <> 10
     or extensions.crypt(substr(v_code, 1, 5) || '-' || substr(v_code, 6, 5), c.code_hash) <> c.code_hash then
    update private.owner_claim set attempts = attempts + 1 where id = 1;
    perform private.log('errou o código do painel', 'profiles', auth.uid()::text, null);
    return 'CODIGO_INVALIDO';
  end if;
  update public.profiles set role = 'owner', barber_id = null where id = auth.uid();
  if not found then raise exception 'USUARIO_NAO_ENCONTRADO'; end if;
  update private.owner_claim set used_at = now() where id = 1;
  perform private.log('assumiu o painel', 'profiles', auth.uid()::text, null);
  return 'OK';
end $$;

-- ---------------------------------------------------------------------
-- 5. Equipe (só o dono)
-- ---------------------------------------------------------------------

drop function if exists public.admin_list_admins();
create or replace function public.admin_team()
returns table (id uuid, full_name text, email text, role text, barber_id uuid, has_mfa boolean)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if not public.is_owner() then raise exception 'SEM_PERMISSAO'; end if;
  return query
  select p.id, p.full_name, u.email::text, p.role, p.barber_id,
         exists (select 1 from auth.mfa_factors f where f.user_id = p.id and f.status = 'verified')
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.role <> 'client'
  order by case p.role when 'owner' then 0 when 'manager' then 1 when 'reception' then 2 else 3 end, p.full_name;
end $$;

drop function if exists public.admin_set_role(text, text);
create or replace function public.admin_set_role(p_email text, p_role text, p_barber_id uuid default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_old text;
begin
  if not public.is_owner() then raise exception 'SEM_PERMISSAO'; end if;
  if p_role is null or p_role not in ('client', 'barber', 'reception', 'manager', 'owner') then
    raise exception 'PAPEL_INVALIDO';
  end if;
  if p_role = 'barber' and (p_barber_id is null or not exists (select 1 from public.barbers where id = p_barber_id)) then
    raise exception 'BARBEIRO_INVALIDO';
  end if;
  select u.id into v_id from auth.users u where lower(u.email) = lower(btrim(p_email));
  if v_id is null then raise exception 'USUARIO_NAO_ENCONTRADO'; end if;
  perform pg_advisory_xact_lock(hashtext('easycut_team'));
  select role into v_old from public.profiles where id = v_id for update;
  if not found then raise exception 'USUARIO_NAO_ENCONTRADO'; end if;
  if v_old = 'owner' and p_role <> 'owner'
     and not exists (select 1 from public.profiles where role = 'owner' and id <> v_id) then
    raise exception 'ULTIMO_DONO';
  end if;
  update public.profiles
    set role = p_role, barber_id = case when p_role = 'barber' then p_barber_id end
    where id = v_id;
  perform private.log('mudou o acesso', 'profiles', v_id::text,
    jsonb_build_object('de', v_old, 'para', p_role, 'barbeiro', p_barber_id));
end $$;

-- Quem perdeu o celular do autenticador: o dono zera a verificação e a pessoa cadastra de novo no próximo acesso.
create or replace function public.admin_reset_mfa(p_user_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_owner() then raise exception 'SEM_PERMISSAO'; end if;
  if p_user_id = auth.uid() then raise exception 'NAO_PODE_SI_MESMO'; end if;
  if not exists (select 1 from public.profiles where id = p_user_id and role <> 'client') then
    raise exception 'USUARIO_NAO_ENCONTRADO';
  end if;
  delete from auth.mfa_factors where user_id = p_user_id;
  delete from auth.sessions where user_id = p_user_id;
  perform private.log('zerou a verificação em duas etapas', 'profiles', p_user_id::text, null);
end $$;

-- ---------------------------------------------------------------------
-- 6. Agenda: funções com permissão por papel e limites contra abuso
-- ---------------------------------------------------------------------

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
  if p_service_ids is null or cardinality(p_service_ids) > 10 then
    return;
  end if;
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
  v_recent int;
  v_id uuid;
  c record;
begin
  if v_uid is null then
    raise exception 'LOGIN_NECESSARIO';
  end if;
  if p_service_ids is null or cardinality(p_service_ids) = 0 or cardinality(p_service_ids) > 10 then
    raise exception 'SERVICO_INVALIDO';
  end if;
  -- Trava a conta durante o agendamento: dois pedidos ao mesmo tempo não furam os limites.
  select * into p from public.profiles where id = v_uid for update;
  if not found or btrim(p.full_name) = '' or p.phone is null then
    raise exception 'PERFIL_INCOMPLETO';
  end if;
  if p.terms_accepted_at is null then
    raise exception 'ACEITE_TERMOS';
  end if;
  select * into s from public.shop where id = 1;

  select count(*) into v_active from public.appointments a
    where a.client_id = v_uid and a.kind = 'booking' and a.status = 'confirmed' and a.ends_at > now();
  if v_active >= s.max_active_per_client then
    raise exception 'LIMITE_AGENDAMENTOS';
  end if;
  -- Contra robôs e abuso: no máximo 6 agendamentos pelo app em 24 horas (contando os cancelados).
  select count(*) into v_recent from public.appointments a
    where a.client_id = v_uid and a.source = 'app' and a.created_at > now() - interval '24 hours';
  if v_recent >= 6 then
    raise exception 'LIMITE_DIARIO';
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
         p_starts_at + make_interval(mins => v_duration), v_total, nullif(left(btrim(p_note), 300), ''), 'app')
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

-- Cancelar: o cliente dentro do prazo; a equipe, na agenda que atende, a qualquer momento.
create or replace function public.cancel_appointment(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  a public.appointments;
  s public.shop;
  v_staff boolean;
begin
  select * into a from public.appointments where id = p_id for update;
  if not found then raise exception 'NAO_ENCONTRADO'; end if;
  v_staff := public.can_see_barber(a.barber_id);
  if not v_staff and a.client_id is distinct from auth.uid() then
    raise exception 'NAO_ENCONTRADO';
  end if;
  if a.status <> 'confirmed' then
    raise exception 'NAO_PODE_CANCELAR';
  end if;
  select * into s from public.shop where id = 1;
  if not v_staff and a.starts_at < now() + make_interval(mins => s.cancel_limit_minutes) then
    raise exception 'PRAZO_CANCELAMENTO';
  end if;
  update public.appointments
    set status = 'cancelled', cancelled_at = now(), cancelled_by = case when v_staff then 'admin' else 'client' end
    where id = p_id;
end $$;

create or replace function public.set_appointment_status(p_id uuid, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  a public.appointments;
begin
  if not public.is_staff() then raise exception 'SEM_PERMISSAO'; end if;
  if p_status not in ('confirmed', 'completed', 'no_show') then raise exception 'STATUS_INVALIDO'; end if;
  select * into a from public.appointments where id = p_id for update;
  if not found or a.kind <> 'booking' or not public.can_see_barber(a.barber_id) then raise exception 'NAO_ENCONTRADO'; end if;
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
  if not public.is_staff() or not public.can_see_barber(p_barber_id) then raise exception 'SEM_PERMISSAO'; end if;
  -- Barbeiro marca cliente do balcão pelo nome; a lista de clientes cadastrados é da recepção para cima.
  if p_client_id is not null and not public.can_front_desk() then raise exception 'SEM_PERMISSAO'; end if;
  if not exists (select 1 from public.barbers where id = p_barber_id) then raise exception 'BARBEIRO_INVALIDO'; end if;
  if p_service_ids is null or cardinality(p_service_ids) > 10 then raise exception 'SERVICO_INVALIDO'; end if;
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
       p_starts_at + make_interval(mins => v_duration), v_total, nullif(left(btrim(p_note), 300), ''), 'admin')
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
  -- Recepção para cima bloqueia qualquer barbeiro (ou todos); o barbeiro, só a própria agenda.
  if not public.is_staff() then raise exception 'SEM_PERMISSAO'; end if;
  if not public.can_front_desk() and (p_barber_id is null or p_barber_id is distinct from public.my_barber_id()) then
    raise exception 'SEM_PERMISSAO';
  end if;
  if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at or p_ends_at - p_starts_at > interval '400 days' then
    raise exception 'INTERVALO_INVALIDO';
  end if;
  for b in select id from public.barbers where active and (p_barber_id is null or id = p_barber_id) loop
    begin
      insert into public.appointments (kind, barber_id, starts_at, ends_at, note, source)
      values ('block', b.id, p_starts_at, p_ends_at, nullif(left(btrim(p_note), 300), ''), 'admin');
    exception when exclusion_violation then
      raise exception 'CONFLITO_BLOQUEIO';
    end;
    v_count := v_count + 1;
  end loop;
  if v_count = 0 then raise exception 'BARBEIRO_INVALIDO'; end if;
  return v_count;
end $$;

-- Remarcar (antes era escrita direta na tabela): mantém a duração e nunca sobrepõe outro horário.
create or replace function public.admin_reschedule(p_id uuid, p_barber_id uuid, p_starts_at timestamptz) returns void
language plpgsql security definer set search_path = '' as $$
declare
  a public.appointments;
begin
  if not public.is_staff() then raise exception 'SEM_PERMISSAO'; end if;
  select * into a from public.appointments where id = p_id for update;
  if not found or a.kind <> 'booking' or not public.can_see_barber(a.barber_id) then raise exception 'NAO_ENCONTRADO'; end if;
  if p_barber_id is null or not public.can_see_barber(p_barber_id)
     or not exists (select 1 from public.barbers where id = p_barber_id) then
    raise exception 'BARBEIRO_INVALIDO';
  end if;
  if a.status <> 'confirmed' then raise exception 'NAO_PODE_REMARCAR'; end if;
  if p_starts_at is null then raise exception 'INTERVALO_INVALIDO'; end if;
  begin
    update public.appointments
      set barber_id = p_barber_id, starts_at = p_starts_at, ends_at = p_starts_at + (a.ends_at - a.starts_at)
      where id = p_id;
  exception when exclusion_violation then
    raise exception 'HORARIO_INDISPONIVEL';
  end;
end $$;

-- Remover bloqueio (antes era escrita direta na tabela).
create or replace function public.admin_delete_block(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  a public.appointments;
begin
  if not public.is_staff() then raise exception 'SEM_PERMISSAO'; end if;
  select * into a from public.appointments where id = p_id for update;
  if not found or a.kind <> 'block' or not public.can_see_barber(a.barber_id) then raise exception 'NAO_ENCONTRADO'; end if;
  delete from public.appointments where id = p_id;
end $$;

create or replace function public.admin_clients()
returns table (
  client_id uuid, full_name text, phone text, email text, created_at timestamptz,
  bookings int, completed int, no_shows int, last_visit timestamptz, next_visit timestamptz
)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if not public.can_front_desk() then raise exception 'SEM_PERMISSAO'; end if;
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

-- ---------------------------------------------------------------------
-- 7. LGPD: aceite, baixar os próprios dados e excluir a própria conta
-- ---------------------------------------------------------------------

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_phone text := regexp_replace(coalesce(new.raw_user_meta_data ->> 'phone', ''), '\D', '', 'g');
  v_terms text := new.raw_user_meta_data ->> 'terms_version';
  v_ok boolean := coalesce(v_terms ~ '^[0-9a-z.-]{1,20}$', false);
begin
  insert into public.profiles (id, full_name, phone, terms_version, terms_accepted_at)
  values (
    new.id,
    left(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), 80),
    case when v_phone ~ '^[0-9]{10,13}$' then v_phone end,
    case when v_ok then v_terms end,
    case when v_ok then now() end
  );
  return new;
end $$;

create or replace function public.accept_terms(p_version text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'LOGIN_NECESSARIO'; end if;
  if p_version is null or p_version !~ '^[0-9a-z.-]{1,20}$' then raise exception 'VERSAO_INVALIDA'; end if;
  update public.profiles set terms_version = p_version, terms_accepted_at = now() where id = auth.uid();
end $$;

-- Tudo o que o app guarda sobre quem está logado (direito de acesso e portabilidade).
create or replace function public.my_data() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'gerado_em', now(),
    'conta', (
      select jsonb_build_object('email', u.email, 'criada_em', u.created_at, 'ultimo_acesso', u.last_sign_in_at)
      from auth.users u where u.id = auth.uid()
    ),
    'perfil', (
      select jsonb_build_object('nome', p.full_name, 'whatsapp', p.phone, 'papel', p.role, 'criado_em', p.created_at,
                                'termos_versao', p.terms_version, 'termos_aceitos_em', p.terms_accepted_at)
      from public.profiles p where p.id = auth.uid()
    ),
    'agendamentos', coalesce((
      select jsonb_agg(jsonb_build_object(
        'inicio', a.starts_at, 'fim', a.ends_at, 'situacao', a.status, 'total_centavos', a.total_cents,
        'observacao', a.note, 'criado_em', a.created_at, 'cancelado_em', a.cancelled_at,
        'servicos', (select jsonb_agg(x.name) from public.appointment_services x where x.appointment_id = a.id)
      ) order by a.starts_at)
      from public.appointments a where a.client_id = auth.uid()
    ), '[]'::jsonb),
    'avaliacoes', coalesce((
      select jsonb_agg(jsonb_build_object('nota', r.rating, 'comentario', r.comment, 'data', r.created_at) order by r.created_at)
      from public.reviews r where r.client_id = auth.uid()
    ), '[]'::jsonb)
  )
  where auth.uid() is not null;
$$;

-- Exclui a conta de quem está logado. Exige login recente (até 15 minutos) para ninguém excluir
-- a conta de outra pessoa com um celular esquecido aberto. Horários futuros são cancelados e o
-- histórico da barbearia fica sem nome, telefone e observação.
create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_login bigint;
begin
  if v_uid is null then raise exception 'LOGIN_NECESSARIO'; end if;
  select role into v_role from public.profiles where id = v_uid;
  if v_role is not null and v_role <> 'client' then raise exception 'EQUIPE_NAO_EXCLUI'; end if;
  select max((e ->> 'timestamp')::bigint) into v_login
    from jsonb_array_elements(coalesce(auth.jwt() -> 'amr', '[]'::jsonb)) e
    where e ->> 'method' in ('password', 'otp', 'recovery', 'magiclink');
  if v_login is null or v_login < extract(epoch from now())::bigint - 900 then
    raise exception 'LOGIN_RECENTE';
  end if;
  update public.appointments
    set status = 'cancelled', cancelled_at = now(), cancelled_by = 'client'
    where client_id = v_uid and status = 'confirmed' and starts_at > now();
  update public.appointments
    set client_name = 'Cliente removido', client_phone = null, note = null, client_id = null
    where client_id = v_uid;
  perform private.log('excluiu a própria conta', 'profiles', v_uid::text, null);
  delete from auth.users where id = v_uid;  -- leva junto o perfil e as avaliações
end $$;

-- ---------------------------------------------------------------------
-- 8. Quem pode chamar cada função
-- ---------------------------------------------------------------------

revoke execute on all functions in schema public from public, anon, authenticated;
revoke execute on all functions in schema private from public, anon, authenticated;
revoke all on all tables in schema private from public, anon, authenticated;

-- Usadas nas regras de acesso (cada uma só responde sobre quem está chamando).
grant execute on function public.is_admin() to anon, authenticated;
grant execute on function public.staff_role(), public.is_staff(), public.can_front_desk(), public.is_owner(),
  public.my_barber_id(), public.can_see_barber(uuid) to authenticated;

grant execute on function public.get_availability(date, uuid[], uuid) to anon, authenticated;
grant execute on function public.barber_ratings() to anon, authenticated;
grant execute on function public.book_appointment(uuid[], timestamptz, uuid, text) to authenticated;
grant execute on function public.cancel_appointment(uuid) to authenticated;
grant execute on function public.rate_appointment(uuid, int, text) to authenticated;
grant execute on function public.set_appointment_status(uuid, text) to authenticated;
grant execute on function public.admin_create_booking(uuid, uuid[], timestamptz, text, text, uuid, text) to authenticated;
grant execute on function public.admin_create_block(uuid, timestamptz, timestamptz, text) to authenticated;
grant execute on function public.admin_reschedule(uuid, uuid, timestamptz) to authenticated;
grant execute on function public.admin_delete_block(uuid) to authenticated;
grant execute on function public.admin_clients() to authenticated;
grant execute on function public.admin_team() to authenticated;
grant execute on function public.admin_set_role(text, text, uuid) to authenticated;
grant execute on function public.admin_reset_mfa(uuid) to authenticated;
grant execute on function public.admin_audit_log(int) to authenticated;
grant execute on function public.panel_has_owner() to authenticated;
grant execute on function public.claim_owner(text) to authenticated;
grant execute on function public.accept_terms(text) to authenticated;
grant execute on function public.my_data() to authenticated;
grant execute on function public.delete_my_account() to authenticated;
