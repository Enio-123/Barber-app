// Testes do banco (regras, RLS e funções) contra o Supabase local.
// Rodar: node tests/db.test.mjs   (precisa de dev/stack.sh up + dev/proxy.mjs)
import { createClient } from '@supabase/supabase-js';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const env = Object.fromEntries(
  readFileSync(new URL('../dev/local.env', import.meta.url), 'utf8')
    .trim().split('\n').map((l) => l.split(/=(.*)/s).slice(0, 2)),
);
const URL_ = 'http://127.0.0.1:54321';
const TZ = 'America/Fortaleza';
let passed = 0;
const results = [];

function sql(q) {
  return execFileSync('docker', ['exec', '-e', 'PGPASSWORD=postgres', 'ec-db', 'psql', '-h', '127.0.0.1', '-U', 'postgres',
    '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-tAq', '-c', q], { encoding: 'utf8' }).trim();
}
const anon = () => createClient(URL_, env.ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

async function signUp(email, full_name, phone) {
  const c = anon();
  const { data, error } = await c.auth.signUp({ email, password: 'senha123', options: { data: { full_name, phone } } });
  if (error) throw error;
  return { c, id: data.user.id };
}
async function test(name, fn) {
  try { await fn(); passed++; results.push(`ok   ${name}`); }
  catch (e) { results.push(`FAIL ${name}\n     ${e.message}`); }
}
const code = (error) => error?.message ?? null;

// Próximo dia útil (seg a sex) pelo menos 2 dias à frente, no fuso da barbearia.
function nextWeekday(minDaysAhead = 2) {
  const now = new Date();
  for (let i = minDaysAhead; i < minDaysAhead + 10; i++) {
    const d = new Date(now.getTime() + i * 86400000);
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' }).formatToParts(d);
    const wd = parts.find((p) => p.type === 'weekday').value;
    if (!['Sat', 'Sun'].includes(wd)) {
      return `${parts.find((p) => p.type === 'year').value}-${parts.find((p) => p.type === 'month').value}-${parts.find((p) => p.type === 'day').value}`;
    }
  }
}
const at = (day, hhmm) => new Date(`${day}T${hhmm}:00-03:00`).toISOString();

// ---------- preparação ----------
sql(`delete from public.reviews; delete from public.appointments; delete from auth.users where email like '%@teste.local';`);
const stamp = Date.now();
const A = await signUp(`a${stamp}@teste.local`, 'Cliente A', '(84) 99999-0001');
const B = await signUp(`b${stamp}@teste.local`, 'Cliente B', '84999990002');
const C = await signUp(`c${stamp}@teste.local`, 'Cliente C', '84999990003');
const ADM = await signUp(`dono${stamp}@teste.local`, 'Dono', '84999990009');
sql(`update public.profiles set role = 'admin' where id = '${ADM.id}'`);

const services = (await anon().from('services').select('*').order('sort')).data;
const barbers = (await anon().from('barbers').select('*').order('sort')).data;
const corte = services.find((s) => s.name === 'Corte');
const corteBarba = services.find((s) => s.name === 'Corte e barba');
const [b1, b2, b3] = barbers;
const day = nextWeekday(2);
const day2 = nextWeekday(4);

// ---------- testes ----------
await test('cadastro cria perfil de cliente com telefone só em dígitos', async () => {
  const { data } = await A.c.from('profiles').select('*').eq('id', A.id).single();
  assert.equal(data.role, 'client');
  assert.equal(data.full_name, 'Cliente A');
  assert.equal(data.phone, '84999990001');
});

await test('visitante sem login lê serviços, barbeiros, horários e dados da barbearia', async () => {
  const c = anon();
  assert.equal((await c.from('services').select('id')).data.length, 6);
  assert.equal((await c.from('barbers').select('id')).data.length, 3);
  assert.equal((await c.from('business_hours').select('weekday')).data.length, 7);
  assert.equal((await c.from('shop').select('name').single()).data.name, 'Easy Cut');
});

await test('visitante não vê perfis nem agendamentos e não agenda', async () => {
  const c = anon();
  const p = await c.from('profiles').select('*');
  assert.ok(p.error || p.data.length === 0);
  const a = await c.from('appointments').select('*');
  assert.ok(a.error || a.data.length === 0);
  const r = await c.rpc('book_appointment', { p_service_ids: [corte.id], p_starts_at: at(day, '10:00') });
  assert.ok(r.error, 'visitante não pode agendar');
});

await test('horários livres respeitam funcionamento, intervalo de almoço e duração', async () => {
  const { data, error } = await anon().rpc('get_availability', { p_date: day, p_service_ids: [corte.id], p_barber_id: b1.id });
  assert.ifError(error);
  const times = data.map((r) => new Date(r.starts_at).toLocaleTimeString('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }));
  assert.equal(times[0], '09:00');
  assert.equal(times.at(-1), '18:30');
  assert.ok(!times.includes('12:00') && !times.includes('12:30'), 'almoço bloqueado');
  assert.equal(times.length, 18);
  const { data: d60 } = await anon().rpc('get_availability', { p_date: day, p_service_ids: [corteBarba.id], p_barber_id: b1.id });
  const t60 = d60.map((r) => new Date(r.starts_at).toLocaleTimeString('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }));
  assert.ok(!t60.includes('11:30'), 'serviço de 1h não pode invadir o almoço');
  assert.equal(t60.at(-1), '18:00');
});

await test('domingo fechado não tem horários', async () => {
  const d = new Date(`${day}T12:00:00-03:00`);
  const toSunday = (7 - d.getUTCDay()) % 7 || 7;
  const sunday = new Date(d.getTime() + toSunday * 86400000).toISOString().slice(0, 10);
  const { data } = await anon().rpc('get_availability', { p_date: sunday, p_service_ids: [corte.id] });
  assert.equal(data.length, 0);
});

await test('cliente agenda e o horário some para os outros', async () => {
  const { data: id, error } = await A.c.rpc('book_appointment', { p_service_ids: [corte.id], p_starts_at: at(day, '10:00'), p_barber_id: b1.id });
  assert.ifError(error);
  assert.ok(id);
  const { data } = await anon().rpc('get_availability', { p_date: day, p_service_ids: [corte.id], p_barber_id: b1.id });
  assert.ok(!data.some((r) => r.starts_at === at(day, '10:00').replace('.000Z', '+00:00')) &&
    !data.some((r) => new Date(r.starts_at).getTime() === new Date(at(day, '10:00')).getTime()));
});

await test('outro cliente não consegue o mesmo barbeiro no mesmo horário', async () => {
  const { error } = await B.c.rpc('book_appointment', { p_service_ids: [corte.id], p_starts_at: at(day, '10:00'), p_barber_id: b1.id });
  assert.equal(code(error), 'HORARIO_INDISPONIVEL');
});

await test('serviço que invade um horário ocupado também é recusado', async () => {
  const { error } = await B.c.rpc('book_appointment', { p_service_ids: [corteBarba.id], p_starts_at: at(day, '09:30'), p_barber_id: b1.id });
  assert.equal(code(error), 'HORARIO_INDISPONIVEL');
});

await test('sem preferência de barbeiro, o sistema escolhe outro livre', async () => {
  const { data: id, error } = await B.c.rpc('book_appointment', { p_service_ids: [corte.id], p_starts_at: at(day, '10:00') });
  assert.ifError(error);
  const { data } = await B.c.from('appointments').select('barber_id').eq('id', id).single();
  assert.notEqual(data.barber_id, b1.id);
});

await test('dois clientes no mesmo segundo: só um fica com o horário', async () => {
  const [r1, r2] = await Promise.all([
    C.c.rpc('book_appointment', { p_service_ids: [corte.id], p_starts_at: at(day, '15:00'), p_barber_id: b3.id }),
    A.c.rpc('book_appointment', { p_service_ids: [corte.id], p_starts_at: at(day, '15:00'), p_barber_id: b3.id }),
  ]);
  const ok = [r1, r2].filter((r) => !r.error).length;
  assert.equal(ok, 1, JSON.stringify([r1.error, r2.error]));
  assert.equal(code([r1, r2].find((r) => r.error).error), 'HORARIO_INDISPONIVEL');
  const n = sql(`select count(*) from public.appointments where barber_id='${b3.id}' and starts_at='${at(day, '15:00')}' and status<>'cancelled'`);
  assert.equal(n, '1');
});

await test('cliente só vê os próprios agendamentos', async () => {
  const { data } = await B.c.from('appointments').select('client_id');
  assert.ok(data.length >= 1);
  assert.ok(data.every((r) => r.client_id === B.id));
});

await test('cliente não altera agendamento direto nem vira admin', async () => {
  const { data: mine } = await A.c.from('appointments').select('id').limit(1);
  const u = await A.c.from('appointments').update({ status: 'completed' }).eq('id', mine[0].id).select();
  assert.ok(u.error || u.data.length === 0);
  const r = await A.c.from('profiles').update({ role: 'admin' }).eq('id', A.id).select();
  assert.ok(r.error, 'coluna role é protegida');
  const ok = await A.c.from('profiles').update({ full_name: 'Cliente A Silva' }).eq('id', A.id).select().single();
  assert.ifError(ok.error);
  assert.equal(ok.data.full_name, 'Cliente A Silva');
});

await test('limite de agendamentos ativos por cliente (2)', async () => {
  const { count } = await A.c.from('appointments').select('*', { count: 'exact', head: true }).eq('status', 'confirmed');
  if (count < 2) {
    const r = await A.c.rpc('book_appointment', { p_service_ids: [corte.id], p_starts_at: at(day2, '09:00') });
    assert.ifError(r.error);
  }
  const { error } = await A.c.rpc('book_appointment', { p_service_ids: [corte.id], p_starts_at: at(day2, '11:00') });
  assert.equal(code(error), 'LIMITE_AGENDAMENTOS');
});

await test('cliente cancela com antecedência e o horário volta a ficar livre', async () => {
  const { data: mine } = await B.c.from('appointments').select('id, barber_id, starts_at').eq('status', 'confirmed');
  const target = mine[0];
  const { error } = await B.c.rpc('cancel_appointment', { p_id: target.id });
  assert.ifError(error);
  const { data } = await anon().rpc('get_availability', { p_date: day, p_service_ids: [corte.id], p_barber_id: target.barber_id });
  assert.ok(data.some((r) => new Date(r.starts_at).getTime() === new Date(target.starts_at).getTime()));
});

await test('cliente não cancela em cima da hora (prazo de 2h)', async () => {
  const soon = new Date(Date.now() + 60 * 60000);
  soon.setUTCMinutes(soon.getUTCMinutes() < 30 ? 30 : 60, 0, 0);
  const { data: id, error } = await ADM.c.rpc('admin_create_booking', {
    p_barber_id: b2.id, p_service_ids: [corte.id], p_starts_at: soon.toISOString(), p_client_name: '', p_client_id: C.id,
  });
  assert.ifError(error);
  const r = await C.c.rpc('cancel_appointment', { p_id: id });
  assert.equal(code(r.error), 'PRAZO_CANCELAMENTO');
  const r2 = await ADM.c.rpc('cancel_appointment', { p_id: id });
  assert.ifError(r2.error);
});

await test('cliente não usa funções do dono', async () => {
  for (const [fn, args] of [
    ['admin_clients', {}],
    ['admin_list_admins', {}],
    ['admin_set_role', { p_email: 'x@y.z', p_role: 'admin' }],
    ['set_appointment_status', { p_id: '00000000-0000-0000-0000-000000000000', p_status: 'completed' }],
    ['admin_create_block', { p_barber_id: null, p_starts_at: at(day, '17:00'), p_ends_at: at(day, '18:00') }],
  ]) {
    const { error } = await A.c.rpc(fn, args);
    assert.equal(code(error), 'SEM_PERMISSAO', fn);
  }
});

await test('dono bloqueia horário de todos e ele some da agenda dos clientes', async () => {
  const { data: n, error } = await ADM.c.rpc('admin_create_block', {
    p_barber_id: null, p_starts_at: at(day, '17:00'), p_ends_at: at(day, '18:00'), p_note: 'Reunião',
  });
  assert.ifError(error);
  assert.equal(n, 3);
  const { data } = await anon().rpc('get_availability', { p_date: day, p_service_ids: [corte.id] });
  const times = new Set(data.map((r) => new Date(r.starts_at).getTime()));
  assert.ok(!times.has(new Date(at(day, '17:00')).getTime()) && !times.has(new Date(at(day, '17:30')).getTime()));
});

await test('bloqueio por cima de cliente marcado é recusado', async () => {
  const { error } = await ADM.c.rpc('admin_create_block', { p_barber_id: b1.id, p_starts_at: at(day, '09:30'), p_ends_at: at(day, '10:30') });
  assert.equal(code(error), 'CONFLITO_BLOQUEIO');
});

await test('agendamento manual do dono (cliente do balcão) respeita a agenda', async () => {
  const r = await ADM.c.rpc('admin_create_booking', {
    p_barber_id: b1.id, p_service_ids: [corte.id], p_starts_at: at(day, '10:00'), p_client_name: 'Balcão',
  });
  assert.equal(code(r.error), 'HORARIO_INDISPONIVEL');
  const ok = await ADM.c.rpc('admin_create_booking', {
    p_barber_id: b1.id, p_service_ids: [corte.id], p_starts_at: at(day, '13:00'), p_client_name: 'João do balcão', p_client_phone: '84 98888-7777',
  });
  assert.ifError(ok.error);
});

await test('dono vê todos os agendamentos e a lista de clientes', async () => {
  const { data } = await ADM.c.from('appointments').select('id');
  assert.ok(data.length >= 5);
  const { data: cl, error } = await ADM.c.rpc('admin_clients');
  assert.ifError(error);
  assert.ok(cl.some((r) => r.full_name === 'João do balcão' && r.client_id === null));
  assert.ok(cl.some((r) => r.client_id === A.id && r.email.startsWith('a')));
});

await test('atendimento passado: dono marca concluído, cliente avalia, nota aparece', async () => {
  const past = new Date(Date.now() - 3 * 3600000);
  past.setUTCMinutes(0, 0, 0);
  const id = sql(`insert into public.appointments (barber_id, client_id, client_name, client_phone, starts_at, ends_at)
    values ('${b2.id}', '${C.id}', 'Cliente C', '84999990003', '${past.toISOString()}', '${new Date(past.getTime() + 1800000).toISOString()}')
    returning id`).split('\n')[0];
  const fut = await ADM.c.rpc('set_appointment_status', { p_id: id, p_status: 'completed' });
  assert.ifError(fut.error);
  const r = await C.c.rpc('rate_appointment', { p_id: id, p_rating: 5, p_comment: 'Muito bom' });
  assert.ifError(r.error);
  const other = await A.c.rpc('rate_appointment', { p_id: id, p_rating: 1 });
  assert.equal(code(other.error), 'NAO_ENCONTRADO');
  const { data } = await anon().rpc('barber_ratings');
  const row = data.find((x) => x.barber_id === b2.id);
  assert.equal(Number(row.average), 5);
  assert.equal(row.total, 1);
});

await test('não dá para avaliar ou concluir algo que ainda não aconteceu', async () => {
  const { data: mine } = await A.c.from('appointments').select('id').eq('status', 'confirmed').limit(1);
  const r = await A.c.rpc('rate_appointment', { p_id: mine[0].id, p_rating: 4 });
  assert.equal(code(r.error), 'AINDA_NAO_ACONTECEU');
  const s = await ADM.c.rpc('set_appointment_status', { p_id: mine[0].id, p_status: 'completed' });
  assert.equal(code(s.error), 'AINDA_NAO_ACONTECEU');
});

await test('equipe: dar acesso ao painel e não remover o último dono', async () => {
  const r = await ADM.c.rpc('admin_set_role', { p_email: `dono${stamp}@teste.local`, p_role: 'client' });
  assert.equal(code(r.error), 'ULTIMO_ADMIN');
  const g = await ADM.c.rpc('admin_set_role', { p_email: `C${stamp}@TESTE.local`, p_role: 'admin' });
  assert.ifError(g.error);
  const { data } = await ADM.c.rpc('admin_list_admins');
  assert.equal(data.length, 2);
  const back = await ADM.c.rpc('admin_set_role', { p_email: `c${stamp}@teste.local`, p_role: 'client' });
  assert.ifError(back.error);
});

await test('dono edita serviços, horários e dados; cliente não', async () => {
  const s = await ADM.c.from('services').update({ price_cents: 4000 }).eq('id', corte.id).select().single();
  assert.ifError(s.error);
  assert.equal(s.data.price_cents, 4000);
  await ADM.c.from('services').update({ price_cents: 3500 }).eq('id', corte.id);
  const h = await A.c.from('business_hours').update({ is_open: false }).eq('weekday', 1).select();
  assert.ok(h.error || h.data.length === 0);
  const tz = await ADM.c.from('shop').update({ timezone: 'Lua/Base' }).eq('id', 1).select();
  assert.ok(tz.error, 'fuso inválido recusado');
  const ok = await ADM.c.from('shop').update({ instagram: 'easycut' }).eq('id', 1).select().single();
  assert.ifError(ok.error);
  await ADM.c.from('shop').update({ instagram: null }).eq('id', 1);
});

await test('primeiro acesso: sem dono, só uma conta assume o painel e depois ninguém mais', async () => {
  const admins = sql(`select coalesce(string_agg(quote_literal(id::text), ','), '') from public.profiles where role = 'admin'`);
  sql(`update public.profiles set role = 'client' where role = 'admin'`);
  try {
    assert.equal((await B.c.rpc('panel_has_owner')).data, false);
    // Duas contas pedindo ao mesmo tempo: só uma vira dona.
    const [r1, r2] = await Promise.all([B.c.rpc('claim_owner'), C.c.rpc('claim_owner')]);
    const errs = [code(r1.error), code(r2.error)];
    assert.equal(errs.filter((e) => e === null).length, 1, `resultado: ${errs}`);
    assert.equal(errs.filter((e) => e === 'JA_TEM_DONO').length, 1, `resultado: ${errs}`);
    assert.equal((await A.c.rpc('panel_has_owner')).data, true);
    assert.equal(code((await A.c.rpc('claim_owner')).error), 'JA_TEM_DONO');
    assert.ok((await anon().rpc('claim_owner')).error, 'visitante sem login não assume');
  } finally {
    sql(`update public.profiles set role = 'client' where id in ('${B.id}', '${C.id}')`);
    if (admins) sql(`update public.profiles set role = 'admin' where id::text in (${admins})`);
  }
});

console.log(results.join('\n'));
console.log(`\n${passed}/${results.length} testes passaram`);
sql(`delete from public.reviews; delete from public.appointments; delete from auth.users where email like '%@teste.local';`);
process.exit(passed === results.length ? 0 : 1);
