-- =====================================================================
-- Easy Cut · agenda da barbearia
-- Banco, regras de acesso (RLS) e funções do app.
-- Para instalar: cole este arquivo inteiro no SQL Editor do Supabase e rode.
-- =====================================================================

create extension if not exists btree_gist with schema extensions;

-- ---------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------

-- Dados e regras da barbearia (uma linha só).
create table public.shop (
  id smallint primary key default 1 check (id = 1),
  name text not null default 'Easy Cut' check (char_length(btrim(name)) between 1 and 60),
  tagline text not null default 'Studio & Barber Shop' check (char_length(tagline) <= 80),
  whatsapp text check (whatsapp ~ '^[0-9]{12,13}$'),          -- DDI + DDD + número, só dígitos
  instagram text check (instagram ~ '^[A-Za-z0-9._]{1,30}$'),  -- sem @
  address text check (char_length(address) <= 200),
  maps_url text check (maps_url ~ '^https://'),
  timezone text not null default 'America/Fortaleza',
  slot_minutes int not null default 30 check (slot_minutes in (10, 15, 20, 30, 45, 60)),
  min_advance_minutes int not null default 30 check (min_advance_minutes between 0 and 10080),
  max_days_ahead int not null default 30 check (max_days_ahead between 1 and 180),
  cancel_limit_minutes int not null default 120 check (cancel_limit_minutes between 0 and 10080),
  max_active_per_client int not null default 2 check (max_active_per_client between 1 and 10),
  updated_at timestamptz not null default now()
);
insert into public.shop (id) values (1);

create table public.services (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 60),
  description text check (char_length(description) <= 200),
  duration_minutes int not null check (duration_minutes between 5 and 480),
  price_cents int check (price_cents between 0 and 10000000),   -- vazio = "a combinar"
  active boolean not null default true,
  sort int not null default 0,
  created_at timestamptz not null default now()
);

create table public.barbers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 60),
  bio text check (char_length(bio) <= 160),
  photo text check (photo ~ '^data:image/(webp|jpeg|png);base64,' and char_length(photo) <= 120000),
  active boolean not null default true,
  sort int not null default 0,
  created_at timestamptz not null default now()
);

-- Horário de funcionamento por dia da semana (0 = domingo ... 6 = sábado).
create table public.business_hours (
  weekday smallint primary key check (weekday between 0 and 6),
  is_open boolean not null default false,
  opens time,
  closes time,
  break_start time,
  break_end time,
  constraint hours_valid check (not is_open or (opens is not null and closes is not null and opens < closes)),
  constraint break_pair check ((break_start is null) = (break_end is null)),
  constraint break_valid check (
    break_start is null or not is_open
    or (break_start < break_end and break_start > opens and break_end < closes)
  )
);
insert into public.business_hours (weekday) select g from generate_series(0, 6) g;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '' check (char_length(full_name) <= 80),
  phone text check (phone ~ '^[0-9]{10,13}$'),
  role text not null default 'client' check (role in ('client', 'admin')),
  created_at timestamptz not null default now()
);

-- Agendamentos e bloqueios de horário (folga, almoço etc.) na mesma tabela:
-- assim a mesma regra impede qualquer sobreposição na agenda do barbeiro.
create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'booking' check (kind in ('booking', 'block')),
  barber_id uuid not null references public.barbers (id) on delete restrict,
  client_id uuid references public.profiles (id) on delete set null,
  client_name text check (char_length(client_name) <= 80),
  client_phone text check (client_phone ~ '^[0-9]{10,13}$'),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'confirmed' check (status in ('confirmed', 'completed', 'cancelled', 'no_show')),
  total_cents int check (total_cents >= 0),
  note text check (char_length(note) <= 300),
  source text not null default 'app' check (source in ('app', 'admin')),
  created_at timestamptz not null default now(),
  cancelled_at timestamptz,
  cancelled_by text check (cancelled_by in ('client', 'admin')),
  constraint time_order check (ends_at > starts_at),
  constraint block_status check (kind = 'booking' or status in ('confirmed', 'cancelled')),
  constraint no_overlap exclude using gist (
    barber_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  ) where (status <> 'cancelled')
);
create index appointments_starts_idx on public.appointments (starts_at);
create index appointments_client_idx on public.appointments (client_id, starts_at desc);

create table public.appointment_services (
  appointment_id uuid not null references public.appointments (id) on delete cascade,
  service_id uuid not null references public.services (id) on delete restrict,
  name text not null,
  duration_minutes int not null,
  price_cents int,
  primary key (appointment_id, service_id)
);

create table public.reviews (
  appointment_id uuid primary key references public.appointments (id) on delete cascade,
  client_id uuid not null references public.profiles (id) on delete cascade,
  barber_id uuid not null references public.barbers (id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  comment text check (char_length(comment) <= 500),
  created_at timestamptz not null default now()
);
create index reviews_barber_idx on public.reviews (barber_id);

-- ---------------------------------------------------------------------
-- Funções auxiliares
-- ---------------------------------------------------------------------

create function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

create function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  perform now() at time zone new.timezone;  -- recusa fuso horário inválido
  new.updated_at := now();
  return new;
end $$;
create trigger shop_touch before update on public.shop
  for each row execute function public.touch_updated_at();

-- Cria o perfil de cliente quando alguém se cadastra.
create function public.handle_new_user() returns trigger
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
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- Regras de acesso (RLS)
-- ---------------------------------------------------------------------

alter table public.shop enable row level security;
alter table public.services enable row level security;
alter table public.barbers enable row level security;
alter table public.business_hours enable row level security;
alter table public.profiles enable row level security;
alter table public.appointments enable row level security;
alter table public.appointment_services enable row level security;
alter table public.reviews enable row level security;

-- Permissões de tabela explícitas (não dependem do padrão do projeto).
revoke all on public.shop, public.services, public.barbers, public.business_hours, public.profiles,
  public.appointments, public.appointment_services, public.reviews from anon, authenticated;

grant select on public.shop, public.services, public.barbers, public.business_hours to anon, authenticated;
grant update on public.shop to authenticated;
grant insert, update, delete on public.services, public.barbers to authenticated;
grant update on public.business_hours to authenticated;
grant select on public.profiles to authenticated;
grant update (full_name, phone) on public.profiles to authenticated;
grant select, insert, update, delete on public.appointments to authenticated;
grant select on public.appointment_services to authenticated;
grant select, delete on public.reviews to authenticated;

create policy "shop: todos leem" on public.shop for select to anon, authenticated using (true);
create policy "shop: admin altera" on public.shop for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy "services: ativos para todos" on public.services for select to anon, authenticated
  using (active or public.is_admin());
create policy "services: admin cria" on public.services for insert to authenticated with check (public.is_admin());
create policy "services: admin altera" on public.services for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "services: admin apaga" on public.services for delete to authenticated using (public.is_admin());

create policy "barbers: todos leem" on public.barbers for select to anon, authenticated using (true);
create policy "barbers: admin cria" on public.barbers for insert to authenticated with check (public.is_admin());
create policy "barbers: admin altera" on public.barbers for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "barbers: admin apaga" on public.barbers for delete to authenticated using (public.is_admin());

create policy "hours: todos leem" on public.business_hours for select to anon, authenticated using (true);
create policy "hours: admin altera" on public.business_hours for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

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

-- ---------------------------------------------------------------------
-- Funções do app (RPC)
-- Erros voltam como códigos curtos que o app traduz (ex.: HORARIO_INDISPONIVEL).
-- ---------------------------------------------------------------------

-- Horários livres de um dia para os serviços escolhidos.
-- Sem barbeiro (p_barber_id nulo) devolve os horários de todos os barbeiros ativos.
create function public.get_availability(p_date date, p_service_ids uuid[], p_barber_id uuid default null)
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

-- Cliente agenda. Sem barbeiro escolhido, o sistema escolhe o que estiver livre
-- e com menos atendimentos no dia. A regra no_overlap garante que dois clientes
-- nunca fiquem com o mesmo horário, mesmo agendando no mesmo segundo.
create function public.book_appointment(
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

-- Cancelar: o cliente dentro do prazo, o admin a qualquer momento.
create function public.cancel_appointment(p_id uuid) returns void
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

-- Avaliar um atendimento que já aconteceu (de 1 a 5 estrelas).
create function public.rate_appointment(p_id uuid, p_rating int, p_comment text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  a public.appointments;
begin
  select * into a from public.appointments where id = p_id;
  if not found or a.client_id is distinct from auth.uid() or a.kind <> 'booking' then
    raise exception 'NAO_ENCONTRADO';
  end if;
  if a.status not in ('confirmed', 'completed') or a.starts_at > now() then
    raise exception 'AINDA_NAO_ACONTECEU';
  end if;
  if p_rating is null or p_rating not between 1 and 5 then
    raise exception 'NOTA_INVALIDA';
  end if;
  insert into public.reviews (appointment_id, client_id, barber_id, rating, comment)
  values (a.id, a.client_id, a.barber_id, p_rating, nullif(left(btrim(p_comment), 500), ''))
  on conflict (appointment_id) do update set rating = excluded.rating, comment = excluded.comment;
end $$;

-- Nota média de cada barbeiro (pública).
create function public.barber_ratings()
returns table (barber_id uuid, average numeric, total int)
language sql stable security definer set search_path = '' as $$
  select r.barber_id, round(avg(r.rating)::numeric, 1), count(*)::int
  from public.reviews r group by r.barber_id;
$$;

-- Admin: marcar como concluído, falta ou de volta para confirmado.
create function public.set_appointment_status(p_id uuid, p_status text) returns void
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

-- Admin: agendamento manual (cliente que ligou ou chegou na hora).
-- Pode ser fora da grade de horários, mas nunca por cima de outro horário.
create function public.admin_create_booking(
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

-- Admin: bloquear um intervalo (de um barbeiro ou de todos).
create function public.admin_create_block(
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

-- Admin: lista de clientes com histórico (cadastrados no app e atendidos no balcão).
create function public.admin_clients()
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

-- Admin: equipe que tem acesso ao painel.
create function public.admin_list_admins()
returns table (id uuid, full_name text, email text)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if not public.is_admin() then raise exception 'SEM_PERMISSAO'; end if;
  return query
  select p.id, p.full_name, u.email::text from public.profiles p join auth.users u on u.id = p.id
  where p.role = 'admin' order by p.full_name;
end $$;

-- Admin: dar ou tirar acesso ao painel pelo e-mail da conta (a pessoa precisa ter se cadastrado no app).
create function public.admin_set_role(p_email text, p_role text) returns void
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

-- Primeiro acesso: enquanto o painel não tem dono, a primeira conta que pedir vira dona.
-- Depois disso só um dono libera outras pessoas (em Ajustes, parte Equipe).
create function public.panel_has_owner() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where role = 'admin');
$$;

create function public.claim_owner() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'SEM_PERMISSAO'; end if;
  -- Um pedido por vez: duas contas nunca viram dono ao mesmo tempo.
  perform pg_advisory_xact_lock(hashtext('easycut_claim_owner'));
  if exists (select 1 from public.profiles where role = 'admin') then raise exception 'JA_TEM_DONO'; end if;
  update public.profiles set role = 'admin' where id = auth.uid();
  if not found then raise exception 'USUARIO_NAO_ENCONTRADO'; end if;
end $$;

-- Quem pode chamar cada função.
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
