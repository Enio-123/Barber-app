// Testes do banco (regras, RLS, funções e segurança) contra o Supabase local.
// Rodar: node tests/db.test.mjs   (precisa de dev/stack.sh up + dev/proxy.mjs)
import { createClient } from '@supabase/supabase-js';
import { execFileSync } from 'node:child_process';
import { createHmac, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { totp } from './totp.mjs';

const env = Object.fromEntries(
  readFileSync(new URL('../dev/local.env', import.meta.url), 'utf8')
    .trim().split('\n').map((l) => l.split(/=(.*)/s).slice(0, 2)),
);
const URL_ = 'http://127.0.0.1:54321';
const TZ = 'America/Fortaleza';
const PASS = 'Senha123';
const TERMS = '2026-11-11';
let passed = 0;
const results = [];

function sql(q) {
  return execFileSync('docker', ['exec', '-e', 'PGPASSWORD=postgres', 'ec-db', 'psql', '-h', '127.0.0.1', '-U', 'postgres',
    '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-tAq', '-c', q], { encoding: 'utf8' }).trim();
}
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const anon = () => createClient(URL_, env.ANON_KEY, opts);
// Cliente que usa um token qualquer (para testar token antigo, roubado ou forjado).
const withToken = (token) => createClient(URL_, env.ANON_KEY, { ...opts, global: { headers: { Authorization: `Bearer ${token}` } } });

async function signUp(email, full_name, phone, { terms = true } = {}) {
  const c = anon();
  const data = { full_name, phone };
  if (terms) data.terms_version = TERMS;
  const r = await c.auth.signUp({ email, password: PASS, options: { data } });
  if (r.error) throw r.error;
  return { c, id: r.data.user.id, email };
}
async function signIn(email) {
  const c = anon();
  const { error } = await c.auth.signInWithPassword({ email, password: PASS });
  if (error) throw error;
  return c;
}
const secrets = new Map();
async function enrollMfa(u) {
  const { data: f, error } = await u.c.auth.mfa.enroll({ factorType: 'totp', friendlyName: `Celular ${randomUUID().slice(0, 6)}` });
  if (error) throw error;
  const v = await u.c.auth.mfa.challengeAndVerify({ factorId: f.id, code: totp(f.totp.secret) });
  if (v.error) throw v.error;
  secrets.set(u.id, f.totp.secret);
  return f;
}
const tokenOf = async (c) => (await c.auth.getSession()).data.session.access_token;
const claimsOf = async (c) => JSON.parse(Buffer.from((await tokenOf(c)).split('.')[1], 'base64url').toString());
function mintJwt(payload) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64(payload);
  return `${head}.${body}.${createHmac('sha256', env.JWT_SECRET).update(`${head}.${body}`).digest('base64url')}`;
}
async function test(name, fn) {
  try { await fn(); passed++; results.push(`ok   ${name}`); }
  catch (e) { results.push(`FAIL ${name}\n     ${e.message}`); }
}
const code = (error) => error?.message ?? null;
const denied = (r) => Boolean(r.error) || (Array.isArray(r.data) && r.data.length === 0);

// Próximo dia útil (seg a sex) pelo menos N dias à frente, no fuso da barbearia.
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
const same = (a, b) => new Date(a).getTime() === new Date(b).getTime();

// ---------- preparação ----------
const clean = `delete from public.reviews; delete from public.appointments; delete from auth.users where email like '%@teste.local';
  update public.profiles set role = 'client', barber_id = null; delete from private.owner_claim; delete from private.audit_log;`;
sql(clean);
const stamp = Date.now();
const A = await signUp(`a${stamp}@teste.local`, 'Cliente A', '(84) 99999-0001');
const B = await signUp(`b${stamp}@teste.local`, 'Cliente B', '84999990002');
const C = await signUp(`c${stamp}@teste.local`, 'Cliente C', '84999990003');
const D = await signUp(`d${stamp}@teste.local`, 'Cliente D', '84999990004');
const N = await signUp(`n${stamp}@teste.local`, 'Cliente N', '84999990005', { terms: false });
const OWN = await signUp(`dono${stamp}@teste.local`, 'Dono', '84999990009');
const MGR = await signUp(`gerente${stamp}@teste.local`, 'Gerente', '84999990008');
const REC = await signUp(`recepcao${stamp}@teste.local`, 'Recepção', '84999990007');
const BAR = await signUp(`barbeiro${stamp}@teste.local`, 'Barbeiro', '84999990006');

const services = (await anon().from('services').select('*').order('sort')).data;
const barbers = (await anon().from('barbers').select('*').order('sort')).data;
const corte = services.find((s) => s.name === 'Corte');
const corteBarba = services.find((s) => s.name === 'Corte e barba');
const [b1, b2, b3] = barbers;
const day = nextWeekday(2);
const day2 = nextWeekday(4);
const ids = {};

// ---------- cadastro, catálogo e agenda do cliente ----------
await test('cadastro cria perfil de cliente com telefone só em dígitos e o aceite dos termos', async () => {
  const { data } = await A.c.from('profiles').select('*').eq('id', A.id).single();
  assert.equal(data.role, 'client');
  assert.equal(data.full_name, 'Cliente A');
  assert.equal(data.phone, '84999990001');
  assert.equal(data.terms_version, TERMS);
  assert.ok(data.terms_accepted_at);
  const n = (await N.c.from('profiles').select('terms_accepted_at').single()).data;
  assert.equal(n.terms_accepted_at, null);
});

await test('senha fraca é recusada (menos de 8 caracteres ou sem número)', async () => {
  for (const password of ['abc123', 'semnumeros']) {
    const { error } = await anon().auth.signUp({ email: `fraca${randomUUID().slice(0, 8)}@teste.local`, password });
    assert.ok(error, `aceitou ${password}`);
    assert.equal(error.code, 'weak_password', `${password}: ${error.code}`);
  }
});

await test('visitante sem login lê serviços, barbeiros, horários e dados da barbearia', async () => {
  const c = anon();
  assert.equal((await c.from('services').select('id')).data.length, 6);
  assert.equal((await c.from('barbers').select('id')).data.length, 3);
  assert.equal((await c.from('business_hours').select('weekday')).data.length, 7);
  assert.equal((await c.from('shop').select('name').single()).data.name, 'Easy Cut');
});

await test('visitante não vê perfis nem agendamentos, não agenda e não usa funções de conta', async () => {
  const c = anon();
  assert.ok(denied(await c.from('profiles').select('*')));
  assert.ok(denied(await c.from('appointments').select('*')));
  assert.ok(denied(await c.from('reviews').select('*')));
  assert.ok((await c.rpc('book_appointment', { p_service_ids: [corte.id], p_starts_at: at(day, '10:00') })).error);
  for (const [fn, args] of [['claim_owner', { p_code: 'AAAAA-AAAAA' }], ['my_data', {}], ['delete_my_account', {}],
    ['panel_has_owner', {}], ['admin_team', {}], ['accept_terms', { p_version: TERMS }]]) {
    assert.ok((await c.rpc(fn, args)).error, fn);
  }
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

await test('pedido gigante (mais de 10 serviços) não consulta nem agenda', async () => {
  const many = Array(11).fill(corte.id);
  const { data } = await anon().rpc('get_availability', { p_date: day, p_service_ids: many });
  assert.equal(data.length, 0);
  const r = await A.c.rpc('book_appointment', { p_service_ids: many, p_starts_at: at(day, '16:00') });
  assert.equal(code(r.error), 'SERVICO_INVALIDO');
});

await test('cliente agenda e o horário some para os outros', async () => {
  const { data: id, error } = await A.c.rpc('book_appointment', { p_service_ids: [corte.id], p_starts_at: at(day, '10:00'), p_barber_id: b1.id });
  assert.ifError(error);
  assert.ok(id);
  ids.a10 = id;
  const { data } = await anon().rpc('get_availability', { p_date: day, p_service_ids: [corte.id], p_barber_id: b1.id });
  assert.ok(!data.some((r) => same(r.starts_at, at(day, '10:00'))));
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
  ids.b10 = id;
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

await test('cliente não altera agendamento direto, não vira dono e não mexe no aceite', async () => {
  const u = await A.c.from('appointments').update({ status: 'completed' }).eq('id', ids.a10).select();
  assert.ok(denied(u));
  for (const patch of [{ role: 'owner' }, { role: 'barber', barber_id: b1.id }, { terms_accepted_at: new Date().toISOString() }]) {
    const r = await A.c.from('profiles').update(patch).eq('id', A.id).select();
    assert.ok(r.error, `coluna protegida: ${Object.keys(patch)}`);
  }
  const ok = await A.c.from('profiles').update({ full_name: 'Cliente A Silva' }).eq('id', A.id).select().single();
  assert.ifError(ok.error);
  assert.equal(ok.data.full_name, 'Cliente A Silva');
  assert.equal(sql(`select role from public.profiles where id='${A.id}'`), 'client');
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

await test('limite diário contra robô: 6 agendamentos pelo app em 24h, mesmo cancelando', async () => {
  const times = ['13:00', '13:30', '14:00', '14:30', '15:00', '15:30'];
  for (const t of times) {
    const { data: id, error } = await D.c.rpc('book_appointment', { p_service_ids: [corte.id], p_starts_at: at(day2, t), p_barber_id: b2.id });
    assert.ifError(error);
    assert.ifError((await D.c.rpc('cancel_appointment', { p_id: id })).error);
  }
  const { error } = await D.c.rpc('book_appointment', { p_service_ids: [corte.id], p_starts_at: at(day2, '16:30'), p_barber_id: b2.id });
  assert.equal(code(error), 'LIMITE_DIARIO');
});

await test('sem aceitar os termos não agenda; depois de aceitar agenda (observação limitada a 300 letras)', async () => {
  const r = await N.c.rpc('book_appointment', { p_service_ids: [corte.id], p_starts_at: at(day2, '16:00'), p_barber_id: b2.id });
  assert.equal(code(r.error), 'ACEITE_TERMOS');
  assert.equal(code((await N.c.rpc('accept_terms', { p_version: "1'; drop table x" })).error), 'VERSAO_INVALIDA');
  assert.ifError((await N.c.rpc('accept_terms', { p_version: TERMS })).error);
  const ok = await N.c.rpc('book_appointment', {
    p_service_ids: [corte.id], p_starts_at: at(day2, '16:00'), p_barber_id: b2.id, p_note: 'x'.repeat(1000),
  });
  assert.ifError(ok.error);
  ids.n16 = ok.data;
  assert.equal(sql(`select length(note) from public.appointments where id='${ok.data}'`), '300');
});

await test('cliente cancela com antecedência e o horário volta a ficar livre', async () => {
  const { data: target } = await B.c.from('appointments').select('id, barber_id, starts_at').eq('id', ids.b10).single();
  assert.ifError((await B.c.rpc('cancel_appointment', { p_id: target.id })).error);
  const { data } = await anon().rpc('get_availability', { p_date: day, p_service_ids: [corte.id], p_barber_id: target.barber_id });
  assert.ok(data.some((r) => same(r.starts_at, target.starts_at)));
  assert.equal(code((await A.c.rpc('cancel_appointment', { p_id: ids.n16 })).error), 'NAO_ENCONTRADO', 'cancelar o horário de outra pessoa');
});

// ---------- painel: código de primeiro acesso e verificação em duas etapas ----------
await test('primeiro acesso: só quem tem o código assume o painel', async () => {
  assert.equal((await B.c.rpc('panel_has_owner')).data, false);
  assert.equal((await B.c.rpc('claim_owner', { p_code: 'AAAAA-AAAAA' })).data, 'SEM_CODIGO', 'sem código gerado ninguém assume');
  const ownerCode = sql('select private.new_owner_code()');
  assert.match(ownerCode, /^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/);
  assert.notEqual(sql('select code_hash from private.owner_claim'), ownerCode, 'só o hash fica guardado');
  assert.equal((await B.c.rpc('claim_owner', { p_code: 'AAAAA-AAAAA' })).data, 'CODIGO_INVALIDO');
  assert.equal((await B.c.rpc('claim_owner', { p_code: '' })).data, 'CODIGO_INVALIDO');
  assert.equal((await OWN.c.rpc('claim_owner', { p_code: ownerCode.replace('-', ' ').toLowerCase() })).data, 'OK');
  assert.equal((await C.c.rpc('claim_owner', { p_code: ownerCode })).data, 'JA_TEM_DONO');
  assert.equal((await A.c.rpc('panel_has_owner')).data, true);
  assert.equal(sql(`select role from public.profiles where id='${OWN.id}'`), 'owner');
  assert.equal(sql(`select count(*) from private.audit_log where action='errou o código do painel' and actor='${B.id}'`), '2');
  assert.equal(sql(`select count(*) from private.audit_log where action='assumiu o painel' and actor='${OWN.id}'`), '1');
});

await test('dono sem a verificação em duas etapas não usa o painel', async () => {
  assert.equal((await claimsOf(OWN.c)).aal, 'aal1');
  assert.equal(code((await OWN.c.rpc('admin_team')).error), 'SEM_PERMISSAO');
  assert.equal(code((await OWN.c.rpc('admin_clients')).error), 'SEM_PERMISSAO');
  assert.equal((await OWN.c.rpc('is_admin')).data, false);
  assert.equal((await OWN.c.from('appointments').select('id')).data.length, 0);
  assert.ok(denied(await OWN.c.from('services').update({ price_cents: 1 }).eq('id', corte.id).select()));
});

await test('com o app autenticador o painel libera (sessão aal2)', async () => {
  await enrollMfa(OWN);
  assert.equal((await claimsOf(OWN.c)).aal, 'aal2');
  const { data, error } = await OWN.c.rpc('admin_team');
  assert.ifError(error);
  assert.equal(data.length, 1);
  assert.equal(data[0].role, 'owner');
  assert.equal(data[0].has_mfa, true);
  assert.ok((await OWN.c.from('appointments').select('id')).data.length >= 3);
});

await test('dono monta a equipe com papéis: gerente, recepção e barbeiro ligado à própria agenda', async () => {
  assert.equal(code((await OWN.c.rpc('admin_set_role', { p_email: BAR.email, p_role: 'barber' })).error), 'BARBEIRO_INVALIDO');
  assert.equal(code((await OWN.c.rpc('admin_set_role', { p_email: BAR.email, p_role: 'admin' })).error), 'PAPEL_INVALIDO');
  assert.equal(code((await OWN.c.rpc('admin_set_role', { p_email: 'ninguem@teste.local', p_role: 'manager' })).error), 'USUARIO_NAO_ENCONTRADO');
  assert.ifError((await OWN.c.rpc('admin_set_role', { p_email: MGR.email.toUpperCase(), p_role: 'manager' })).error);
  assert.ifError((await OWN.c.rpc('admin_set_role', { p_email: ` ${REC.email} `, p_role: 'reception' })).error);
  assert.ifError((await OWN.c.rpc('admin_set_role', { p_email: BAR.email, p_role: 'barber', p_barber_id: b1.id })).error);
  // Ainda sem o autenticador: o papel existe, mas o painel continua fechado.
  assert.equal(code((await MGR.c.rpc('admin_clients')).error), 'SEM_PERMISSAO');
  for (const u of [MGR, REC, BAR]) await enrollMfa(u);
  const { data } = await OWN.c.rpc('admin_team');
  assert.deepEqual(data.map((r) => r.role), ['owner', 'manager', 'reception', 'barber']);
  assert.ok(data.every((r) => r.has_mfa));
  assert.equal(data.find((r) => r.role === 'barber').barber_id, b1.id);
  assert.equal(sql(`select count(*) from private.audit_log where action='mudou o acesso'`), '3');
  assert.equal(sql(`select count(*) from private.audit_log where action='mudou o acesso' and details::text ilike '%@%'`), '0', 'sem e-mail no histórico');
});

await test('cliente não usa nenhuma função da equipe', async () => {
  const z = '00000000-0000-0000-0000-000000000000';
  for (const [fn, args] of [
    ['admin_clients', {}],
    ['admin_team', {}],
    ['admin_audit_log', {}],
    ['admin_set_role', { p_email: A.email, p_role: 'owner' }],
    ['admin_reset_mfa', { p_user_id: OWN.id }],
    ['set_appointment_status', { p_id: z, p_status: 'completed' }],
    ['admin_create_block', { p_barber_id: null, p_starts_at: at(day, '17:00'), p_ends_at: at(day, '18:00') }],
    ['admin_create_booking', { p_barber_id: b1.id, p_service_ids: [corte.id], p_starts_at: at(day, '16:00'), p_client_name: 'X' }],
    ['admin_reschedule', { p_id: ids.a10, p_barber_id: b1.id, p_starts_at: at(day, '16:00') }],
    ['admin_delete_block', { p_id: z }],
  ]) {
    const { error } = await A.c.rpc(fn, args);
    assert.equal(code(error), 'SEM_PERMISSAO', fn);
  }
});

// ---------- painel: agenda ----------
await test('cliente não cancela em cima da hora (prazo de 2h); a equipe cancela', async () => {
  const soon = new Date(Date.now() + 60 * 60000);
  soon.setUTCMinutes(soon.getUTCMinutes() < 30 ? 30 : 60, 0, 0);
  const { data: id, error } = await OWN.c.rpc('admin_create_booking', {
    p_barber_id: b2.id, p_service_ids: [corte.id], p_starts_at: soon.toISOString(), p_client_name: '', p_client_id: C.id,
  });
  assert.ifError(error);
  assert.equal(code((await C.c.rpc('cancel_appointment', { p_id: id })).error), 'PRAZO_CANCELAMENTO');
  assert.ifError((await OWN.c.rpc('cancel_appointment', { p_id: id })).error);
});

await test('dono bloqueia horário de todos e ele some da agenda dos clientes', async () => {
  const { data: n, error } = await OWN.c.rpc('admin_create_block', {
    p_barber_id: null, p_starts_at: at(day, '17:00'), p_ends_at: at(day, '18:00'), p_note: 'Reunião',
  });
  assert.ifError(error);
  assert.equal(n, 3);
  const { data } = await anon().rpc('get_availability', { p_date: day, p_service_ids: [corte.id] });
  const times = new Set(data.map((r) => new Date(r.starts_at).getTime()));
  assert.ok(!times.has(new Date(at(day, '17:00')).getTime()) && !times.has(new Date(at(day, '17:30')).getTime()));
  const far = await OWN.c.rpc('admin_create_block', { p_barber_id: b1.id, p_starts_at: at(day, '19:00'), p_ends_at: new Date(Date.now() + 500 * 86400000).toISOString() });
  assert.equal(code(far.error), 'INTERVALO_INVALIDO');
});

await test('bloqueio por cima de cliente marcado é recusado', async () => {
  const { error } = await OWN.c.rpc('admin_create_block', { p_barber_id: b1.id, p_starts_at: at(day, '09:30'), p_ends_at: at(day, '10:30') });
  assert.equal(code(error), 'CONFLITO_BLOQUEIO');
});

await test('agendamento manual do dono (cliente do balcão) respeita a agenda', async () => {
  const r = await OWN.c.rpc('admin_create_booking', {
    p_barber_id: b1.id, p_service_ids: [corte.id], p_starts_at: at(day, '10:00'), p_client_name: 'Balcão',
  });
  assert.equal(code(r.error), 'HORARIO_INDISPONIVEL');
  const ok = await OWN.c.rpc('admin_create_booking', {
    p_barber_id: b1.id, p_service_ids: [corte.id], p_starts_at: at(day, '13:00'), p_client_name: 'João do balcão', p_client_phone: '84 98888-7777',
  });
  assert.ifError(ok.error);
  ids.joao = ok.data;
});

await test('dono vê todos os agendamentos e a lista de clientes', async () => {
  const { data } = await OWN.c.from('appointments').select('id');
  assert.ok(data.length >= 5);
  const { data: cl, error } = await OWN.c.rpc('admin_clients');
  assert.ifError(error);
  assert.ok(cl.some((r) => r.full_name === 'João do balcão' && r.client_id === null));
  assert.ok(cl.some((r) => r.client_id === A.id && r.email.startsWith('a')));
  assert.ok(!cl.some((r) => r.client_id === MGR.id), 'equipe não aparece como cliente');
});

await test('ninguém escreve direto na tabela da agenda, nem o dono', async () => {
  const ins = await OWN.c.from('appointments').insert({
    kind: 'block', barber_id: b1.id, starts_at: at(day, '18:00'), ends_at: at(day, '18:30'), source: 'admin',
  }).select();
  assert.ok(ins.error, 'insert direto');
  assert.ok((await OWN.c.from('appointments').update({ status: 'no_show' }).eq('id', ids.a10).select()).error, 'update direto');
  assert.ok((await OWN.c.from('appointments').delete().eq('id', ids.a10).select()).error, 'delete direto');
  assert.equal(sql(`select status from public.appointments where id='${ids.a10}'`), 'confirmed');
});

await test('remarcar pela função: mantém a duração e nunca sobrepõe', async () => {
  assert.ifError((await OWN.c.rpc('admin_reschedule', { p_id: ids.joao, p_barber_id: b1.id, p_starts_at: at(day, '13:30') })).error);
  const row = sql(`select extract(epoch from ends_at - starts_at)::int || ' ' || (starts_at = '${at(day, '13:30')}') from public.appointments where id='${ids.joao}'`);
  assert.equal(row, '1800 true');
  assert.equal(code((await OWN.c.rpc('admin_reschedule', { p_id: ids.joao, p_barber_id: b1.id, p_starts_at: at(day, '10:00') })).error), 'HORARIO_INDISPONIVEL');
  assert.equal(code((await OWN.c.rpc('admin_reschedule', { p_id: ids.b10, p_barber_id: b1.id, p_starts_at: at(day, '16:00') })).error), 'NAO_PODE_REMARCAR');
  const block = sql(`select id from public.appointments where kind='block' and barber_id='${b1.id}' limit 1`);
  assert.equal(code((await OWN.c.rpc('admin_reschedule', { p_id: block, p_barber_id: b1.id, p_starts_at: at(day, '16:00') })).error), 'NAO_ENCONTRADO');
});

// ---------- painel: papéis ----------
await test('barbeiro só vê e mexe na própria agenda', async () => {
  const { data } = await BAR.c.from('appointments').select('barber_id');
  assert.ok(data.length >= 2);
  assert.ok(data.every((r) => r.barber_id === b1.id), 'só a agenda dele');
  assert.equal(code((await BAR.c.rpc('admin_clients')).error), 'SEM_PERMISSAO');
  const own = await BAR.c.rpc('admin_create_booking', { p_barber_id: b1.id, p_service_ids: [corte.id], p_starts_at: at(day, '14:00'), p_client_name: 'Amigo do Barbeiro' });
  assert.ifError(own.error);
  assert.equal(code((await BAR.c.rpc('admin_create_booking', { p_barber_id: b2.id, p_service_ids: [corte.id], p_starts_at: at(day, '14:00'), p_client_name: 'X' })).error), 'SEM_PERMISSAO');
  assert.equal(code((await BAR.c.rpc('admin_create_booking', { p_barber_id: b1.id, p_service_ids: [corte.id], p_starts_at: at(day, '14:30'), p_client_name: '', p_client_id: A.id })).error), 'SEM_PERMISSAO');
  assert.equal(code((await BAR.c.rpc('admin_create_block', { p_barber_id: null, p_starts_at: at(day, '16:00'), p_ends_at: at(day, '16:30') })).error), 'SEM_PERMISSAO');
  assert.equal((await BAR.c.rpc('admin_create_block', { p_barber_id: b1.id, p_starts_at: at(day, '16:00'), p_ends_at: at(day, '16:30') })).data, 1);
  const myBlock = sql(`select id from public.appointments where kind='block' and barber_id='${b1.id}' and starts_at='${at(day, '16:00')}'`);
  assert.ifError((await BAR.c.rpc('admin_delete_block', { p_id: myBlock })).error);
  const otherBlock = sql(`select id from public.appointments where kind='block' and barber_id='${b2.id}' limit 1`);
  assert.equal(code((await BAR.c.rpc('admin_delete_block', { p_id: otherBlock })).error), 'NAO_ENCONTRADO');
  assert.equal(code((await BAR.c.rpc('cancel_appointment', { p_id: ids.n16 })).error), 'NAO_ENCONTRADO');
  assert.equal(code((await BAR.c.rpc('set_appointment_status', { p_id: ids.n16, p_status: 'no_show' })).error), 'NAO_ENCONTRADO');
  assert.equal(code((await BAR.c.rpc('admin_reschedule', { p_id: own.data, p_barber_id: b2.id, p_starts_at: at(day, '14:00') })).error), 'BARBEIRO_INVALIDO');
  assert.ok(denied(await BAR.c.from('services').update({ price_cents: 1 }).eq('id', corte.id).select()));
  assert.ok(denied(await BAR.c.from('profiles').select('id').neq('id', BAR.id)));
});

await test('recepção cuida da agenda de todos e dos clientes, mas não do cadastro nem da equipe', async () => {
  const { data } = await REC.c.from('appointments').select('barber_id');
  assert.ok(new Set(data.map((r) => r.barber_id)).size >= 3);
  assert.ifError((await REC.c.rpc('admin_clients')).error);
  assert.ifError((await REC.c.rpc('admin_create_booking', { p_barber_id: b2.id, p_service_ids: [corte.id], p_starts_at: at(day, '11:00'), p_client_name: 'Maria' })).error);
  const otherBlock = sql(`select id from public.appointments where kind='block' and barber_id='${b2.id}' limit 1`);
  assert.ifError((await REC.c.rpc('admin_delete_block', { p_id: otherBlock })).error);
  assert.ok(denied(await REC.c.from('services').update({ price_cents: 1 }).eq('id', corte.id).select()));
  assert.ok(denied(await REC.c.from('shop').update({ instagram: 'x' }).eq('id', 1).select()));
  assert.ok(denied(await REC.c.from('business_hours').update({ is_open: false }).eq('weekday', 1).select()));
  assert.equal(code((await REC.c.rpc('admin_team')).error), 'SEM_PERMISSAO');
  assert.equal(code((await REC.c.rpc('admin_set_role', { p_email: REC.email, p_role: 'owner' })).error), 'SEM_PERMISSAO');
});

await test('gerente cuida do cadastro, mas não da equipe nem do histórico', async () => {
  const s = await MGR.c.from('services').update({ price_cents: 4200 }).eq('id', corte.id).select().single();
  assert.ifError(s.error);
  assert.equal(s.data.price_cents, 4200);
  assert.ifError((await MGR.c.from('services').update({ price_cents: corte.price_cents }).eq('id', corte.id)).error);
  for (const [fn, args] of [['admin_team', {}], ['admin_audit_log', {}], ['admin_set_role', { p_email: MGR.email, p_role: 'owner' }],
    ['admin_reset_mfa', { p_user_id: BAR.id }]]) {
    assert.equal(code((await MGR.c.rpc(fn, args)).error), 'SEM_PERMISSAO', fn);
  }
});

await test('atendimento passado: equipe marca concluído, cliente avalia, nota aparece', async () => {
  const past = new Date(Date.now() - 3 * 3600000);
  past.setUTCMinutes(0, 0, 0);
  const id = sql(`insert into public.appointments (barber_id, client_id, client_name, client_phone, starts_at, ends_at)
    values ('${b2.id}', '${C.id}', 'Cliente C', '84999990003', '${past.toISOString()}', '${new Date(past.getTime() + 1800000).toISOString()}')
    returning id`).split('\n')[0];
  ids.past = id;
  assert.ifError((await OWN.c.rpc('set_appointment_status', { p_id: id, p_status: 'completed' })).error);
  assert.ifError((await C.c.rpc('rate_appointment', { p_id: id, p_rating: 5, p_comment: 'Muito bom' })).error);
  assert.equal(code((await A.c.rpc('rate_appointment', { p_id: id, p_rating: 1 })).error), 'NAO_ENCONTRADO');
  const { data } = await anon().rpc('barber_ratings');
  const row = data.find((x) => x.barber_id === b2.id);
  assert.equal(Number(row.average), 5);
  assert.equal(row.total, 1);
  assert.equal((await REC.c.from('reviews').select('rating')).data.length, 1);
  assert.equal((await BAR.c.from('reviews').select('rating')).data.length, 0, 'barbeiro 1 não vê avaliação do barbeiro 2');
  assert.ok(denied(await REC.c.from('reviews').delete().eq('appointment_id', id).select()), 'recepção não apaga avaliação');
});

await test('não dá para avaliar ou concluir algo que ainda não aconteceu', async () => {
  const r = await A.c.rpc('rate_appointment', { p_id: ids.a10, p_rating: 4 });
  assert.equal(code(r.error), 'AINDA_NAO_ACONTECEU');
  const s = await OWN.c.rpc('set_appointment_status', { p_id: ids.a10, p_status: 'completed' });
  assert.equal(code(s.error), 'AINDA_NAO_ACONTECEU');
});

await test('equipe: não remove o último dono e passa a posse com segurança', async () => {
  assert.equal(code((await OWN.c.rpc('admin_set_role', { p_email: OWN.email, p_role: 'client' })).error), 'ULTIMO_DONO');
  assert.ifError((await OWN.c.rpc('admin_set_role', { p_email: C.email, p_role: 'owner' })).error);
  const { data } = await OWN.c.rpc('admin_team');
  assert.equal(data.filter((r) => r.role === 'owner').length, 2);
  assert.equal(data.find((r) => r.id === C.id).has_mfa, false);
  assert.equal(code((await C.c.rpc('admin_team')).error), 'SEM_PERMISSAO', 'dono novo sem autenticador ainda não entra');
  assert.ifError((await OWN.c.rpc('admin_set_role', { p_email: C.email, p_role: 'client' })).error);
});

await test('dono edita serviços, horários e dados; cliente não', async () => {
  const s = await OWN.c.from('services').update({ price_cents: 4000 }).eq('id', corte.id).select().single();
  assert.ifError(s.error);
  assert.equal(s.data.price_cents, 4000);
  await OWN.c.from('services').update({ price_cents: corte.price_cents }).eq('id', corte.id);
  assert.ok(denied(await A.c.from('business_hours').update({ is_open: false }).eq('weekday', 1).select()));
  assert.ok((await OWN.c.from('shop').update({ timezone: 'Lua/Base' }).eq('id', 1).select()).error, 'fuso inválido recusado');
  const ok = await OWN.c.from('shop').update({ instagram: 'easycut' }).eq('id', 1).select().single();
  assert.ifError(ok.error);
  await OWN.c.from('shop').update({ instagram: null }).eq('id', 1);
});

// ---------- histórico, sessões e verificação ----------
await test('histórico registra o que a equipe fez, sem dados pessoais de clientes, e só o dono lê', async () => {
  const mgrPrice = sql(`select details->'price_cents'->>'para' from private.audit_log
    where actor='${MGR.id}' and entity='services' and action='update' order by id limit 1`);
  assert.equal(mgrPrice, '4200');
  assert.equal(sql(`select count(*) from private.audit_log where actor='${REC.id}' and entity='appointments' and action='delete'`), '1');
  assert.equal(sql(`select count(*) from private.audit_log where entity='appointments' and actor in ('${A.id}','${B.id}','${D.id}','${N.id}')`), '0', 'o que o cliente faz não entra');
  assert.equal(sql(`select count(*) from private.audit_log where details::text ~* '(João|Maria|Amigo|8498888|Cliente [A-Z])'`), '0', 'sem nome ou telefone de cliente');
  const { data, error } = await OWN.c.rpc('admin_audit_log', { p_limit: 100000 });
  assert.ifError(error);
  assert.ok(data.length > 5 && data.length <= 500);
  const row = data.find((r) => r.entity === 'services' && r.actor_name === 'Gerente');
  assert.equal(row.target, 'Corte');
  assert.equal(row.actor_role, 'manager');
  const booking = data.find((r) => r.entity === 'appointments' && r.entity_id === ids.joao && r.action === 'insert');
  assert.match(booking.target, /^João do balcão · \d\d\/\d\d \d\d:\d\d$/);
  assert.ok((await OWN.c.schema('private').from('audit_log').select('*')).error, 'tabela interna fora da API');
  assert.ok((await OWN.c.from('audit_log').select('*')).error);
  assert.ok((await OWN.c.rpc('log', { p_action: 'x', p_entity: 'y', p_entity_id: null })).error, 'ninguém escreve no histórico pela API');
  assert.ok((await OWN.c.schema('private').rpc('new_owner_code')).error, 'ninguém gera código pela API');
});

await test('sair de todos os aparelhos corta o painel na hora, mesmo com o token antigo', async () => {
  const old = await tokenOf(MGR.c);
  const stale = withToken(old);
  assert.equal((await stale.rpc('is_admin')).data, true);
  assert.ifError((await MGR.c.auth.signOut({ scope: 'global' })).error);
  assert.equal((await stale.rpc('is_admin')).data, false);
  assert.equal(code((await stale.rpc('admin_clients')).error), 'SEM_PERMISSAO');
  assert.ok(denied(await stale.from('services').update({ price_cents: 1 }).eq('id', corte.id).select()));
});

await test('token forjado ou com aal2 falso não abre o painel', async () => {
  const now = Math.floor(Date.now() / 1000);
  const base = { sub: OWN.id, role: 'authenticated', aud: 'authenticated', iat: now, exp: now + 600, aal: 'aal2',
    session_id: randomUUID(), amr: [{ method: 'totp', timestamp: now }] };
  // Assinado com a chave certa, mas para uma sessão que não existe.
  assert.equal((await withToken(mintJwt(base)).rpc('is_admin')).data, false);
  // Assinatura errada: a API recusa.
  const bad = mintJwt(base).replace(/\.[^.]+$/, '.' + Buffer.from('x'.repeat(32)).toString('base64url'));
  assert.ok((await withToken(bad).rpc('is_admin')).error);
});

await test('dono zera a verificação de quem perdeu o celular; a pessoa cadastra de novo', async () => {
  assert.equal(code((await OWN.c.rpc('admin_reset_mfa', { p_user_id: OWN.id })).error), 'NAO_PODE_SI_MESMO');
  assert.equal(code((await OWN.c.rpc('admin_reset_mfa', { p_user_id: A.id })).error), 'USUARIO_NAO_ENCONTRADO');
  const old = withToken(await tokenOf(BAR.c));
  assert.ifError((await OWN.c.rpc('admin_reset_mfa', { p_user_id: BAR.id })).error);
  assert.equal(sql(`select count(*) from auth.mfa_factors where user_id='${BAR.id}'`), '0');
  assert.equal(sql(`select count(*) from auth.sessions where user_id='${BAR.id}'`), '0');
  assert.equal((await old.from('appointments').select('id')).data.length, 0, 'token antigo perde a agenda');
  BAR.c = await signIn(BAR.email);
  assert.equal((await claimsOf(BAR.c)).aal, 'aal1');
  assert.equal((await BAR.c.auth.mfa.listFactors()).data.totp.length, 0);
  await enrollMfa(BAR);
  assert.ok((await BAR.c.from('appointments').select('id')).data.length >= 2);
});

await test('com autenticador cadastrado, entrar só com a senha não abre o painel', async () => {
  const c = await signIn(OWN.email);
  assert.equal((await claimsOf(c)).aal, 'aal1');
  assert.equal(code((await c.rpc('admin_team')).error), 'SEM_PERMISSAO');
  const { data } = await c.auth.mfa.getAuthenticatorAssuranceLevel();
  assert.equal(data.nextLevel, 'aal2');
  // Quem tem só a senha não consegue cadastrar outro autenticador por cima.
  const e = await c.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'intruso' });
  assert.ok(e.error, 'cadastrou outro autenticador só com a senha');
});

// ---------- LGPD ----------
await test('baixar meus dados traz só o que é da própria pessoa', async () => {
  const { data, error } = await A.c.rpc('my_data');
  assert.ifError(error);
  assert.equal(data.conta.email, A.email);
  assert.equal(data.perfil.nome, 'Cliente A Silva');
  assert.equal(data.perfil.termos_versao, TERMS);
  assert.ok(data.agendamentos.length >= 1);
  assert.ok(data.agendamentos.every((x) => Array.isArray(x.servicos)));
  assert.ok(!JSON.stringify(data).includes('Cliente B') && !JSON.stringify(data).includes('84999990002'));
});

await test('excluir a conta: pede login recente, cancela o futuro e tira nome e telefone do histórico', async () => {
  assert.equal(code((await OWN.c.rpc('delete_my_account')).error), 'EQUIPE_NAO_EXCLUI');
  const fut = await C.c.rpc('book_appointment', { p_service_ids: [corte.id], p_starts_at: at(day2, '17:00'), p_barber_id: b3.id });
  assert.ifError(fut.error);
  const now = Math.floor(Date.now() / 1000);
  const oldLogin = mintJwt({ sub: C.id, role: 'authenticated', aud: 'authenticated', iat: now, exp: now + 600, aal: 'aal1',
    session_id: randomUUID(), amr: [{ method: 'password', timestamp: now - 3600 }] });
  assert.equal(code((await withToken(oldLogin).rpc('delete_my_account')).error), 'LOGIN_RECENTE');
  assert.equal(sql(`select count(*) from auth.users where id='${C.id}'`), '1');
  const fresh = await signIn(C.email);
  assert.ifError((await fresh.rpc('delete_my_account')).error);
  assert.equal(sql(`select count(*) from auth.users where id='${C.id}'`), '0');
  assert.equal(sql(`select count(*) from public.profiles where id='${C.id}'`), '0');
  assert.equal(sql(`select status || ' ' || client_name || ' ' || coalesce(client_phone, '-') from public.appointments where id='${fut.data}'`), 'cancelled Cliente removido -');
  assert.equal(sql(`select client_name || ' ' || coalesce(client_phone, '-') || ' ' || coalesce(client_id::text, '-') from public.appointments where id='${ids.past}'`), 'Cliente removido - -');
  assert.equal(sql(`select count(*) from public.reviews where appointment_id='${ids.past}'`), '0');
  assert.equal(sql(`select count(*) from public.appointments where client_name='Cliente C'`), '0');
  assert.equal(sql(`select count(*) from private.audit_log where action='excluiu a própria conta' and details is null`), '1');
  const { data } = await anon().rpc('barber_ratings');
  assert.ok(!data.some((x) => x.barber_id === b2.id && x.total > 0));
});

await test('primeiro acesso: 10 tentativas erradas travam o código e só uma conta assume ao mesmo tempo', async () => {
  const owners = sql(`select string_agg(quote_literal(id::text), ',') from public.profiles where role = 'owner'`);
  sql(`update public.profiles set role = 'client' where role = 'owner'`);
  try {
    assert.equal((await B.c.rpc('claim_owner', { p_code: 'AAAAA-AAAAA' })).data, 'SEM_CODIGO', 'código já usado não vale de novo');
    let ownerCode = sql('select private.new_owner_code()');
    for (let i = 0; i < 10; i++) assert.equal((await B.c.rpc('claim_owner', { p_code: `ZZZZZ-ZZZZ${i}` })).data, 'CODIGO_INVALIDO');
    assert.equal((await B.c.rpc('claim_owner', { p_code: ownerCode })).data, 'CODIGO_BLOQUEADO');
    ownerCode = sql('select private.new_owner_code()');
    const [r1, r2] = await Promise.all([B.c.rpc('claim_owner', { p_code: ownerCode }), A.c.rpc('claim_owner', { p_code: ownerCode })]);
    const out = [r1.data, r2.data].sort();
    assert.deepEqual(out, ['JA_TEM_DONO', 'OK'], JSON.stringify([r1, r2]));
    assert.equal(sql(`select count(*) from public.profiles where role = 'owner'`), '1');
  } finally {
    sql(`update public.profiles set role = 'client' where id in ('${A.id}', '${B.id}')`);
    if (owners) sql(`update public.profiles set role = 'owner' where id::text in (${owners})`);
  }
});

console.log(results.join('\n'));
console.log(`\n${passed}/${results.length} testes passaram`);
sql(clean);
process.exit(passed === results.length ? 0 : 1);
