// Teste de ponta a ponta no navegador (celular e computador) contra o Supabase local.
// Rodar: dev/stack.sh up && node dev/proxy.mjs & npm run dev &  depois  node tests/e2e.mjs [pasta-dos-prints]
// Precisa do Playwright instalado (npm i -D playwright).
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');

const APP = process.env.APP_URL ?? 'http://127.0.0.1:5173/';
const MAIL = 'http://127.0.0.1:54324';
const OUT = process.argv[2] ?? new URL('../e2e-prints/', import.meta.url).pathname;
const TZ = 'America/Fortaleza';
mkdirSync(OUT, { recursive: true });

// ---------- utilidades ----------
const root = new URL('..', import.meta.url).pathname;
function psql(sql) {
  return execFileSync('docker', ['exec', '-i', '-e', 'PGPASSWORD=postgres', 'ec-db', 'psql', '-h', '127.0.0.1', '-U', 'postgres', '-d', 'postgres',
    '-v', 'ON_ERROR_STOP=1', '-tAq'], { input: sql, encoding: 'utf8' }).trim();
}
function dayKey(date) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const g = (t) => p.find((x) => x.type === t).value;
  return `${g('year')}-${g('month')}-${g('day')}`;
}
const weekday = (key) => new Date(`${key}T12:00:00Z`).getUTCDay();
const addDays = (key, n) => {
  const d = new Date(`${key}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const TODAY = dayKey(new Date());
let D = addDays(TODAY, 2);
while (![1, 2, 3, 4, 5].includes(weekday(D))) D = addDays(D, 1); // dia útil à frente
let P = addDays(TODAY, -1);
while (weekday(P) === 0) P = addDays(P, -1); // último dia aberto que já passou
const stamp = Date.now();
const email = (n) => `${n}${stamp}@teste.local`;

const results = [];
let failed = 0;
let failShot = null; // página para print quando um passo falha
async function step(name, fn) {
  const t = Date.now();
  try {
    await fn();
    results.push(`ok   ${name} (${((Date.now() - t) / 1000).toFixed(1)}s)`);
  } catch (e) {
    failed++;
    if (failShot) await failShot.screenshot({ path: `${OUT}/falha.png` }).catch(() => undefined);
    results.push(`FAIL ${name}\n     ${String(e.message).split('\n').slice(0, 4).join('\n     ')}`);
    throw e;
  }
}
// Prints sem animação no meio e sem os avisos flutuantes por cima do conteúdo.
const shot = (page, name, full = false) =>
  page.screenshot({ path: `${OUT}/${name}.png`, fullPage: full, animations: 'disabled', caret: 'hide', style: '.toasts{display:none!important}' });
const toast = (page, text) => page.locator('.toast', { hasText: text }).first().waitFor({ timeout: 10000 });

async function newPhone(browser) {
  const ctx = await browser.newContext({ ...devices['Pixel 7'], locale: 'pt-BR', timezoneId: TZ });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => results.push(`     erro na página: ${e.message}`));
  return page;
}
async function newDesktop(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, locale: 'pt-BR', timezoneId: TZ });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => results.push(`     erro na página: ${e.message}`));
  return page;
}

async function signUpForm(page, { name, phone, mail, password = 'senha123' }) {
  await page.getByRole('group').getByRole('button', { name: 'Criar conta' }).click();
  await page.getByLabel('Nome completo').fill(name);
  await page.getByLabel('WhatsApp').fill(phone);
  await page.getByLabel('E-mail').fill(mail);
  await page.getByLabel('Senha', { exact: true }).fill(password);
}
async function submitSignUp(page) {
  await page.locator('form').getByRole('button', { name: 'Criar conta' }).click();
  await toast(page, 'Conta criada');
}

/** Escolhe barbeiro, serviços, dia e hora na tela Agendar. */
async function pick(page, { barber, services, day, time, period, shots }) {
  // Começa sem escolhas guardadas de uma tentativa anterior.
  await page.evaluate(() => sessionStorage.removeItem('easycut-draft'));
  await page.goto(APP);
  await page.reload();
  await page.locator('.picker').nth(0).click();
  let dialog = page.getByRole('dialog');
  if (shots) await shot(page, shots[0]);
  await dialog.locator('.option', { hasText: barber }).first().click();
  dialog = page.getByRole('dialog', { name: 'Escolha os serviços' });
  for (const s of services) {
    await dialog.locator('.option', { has: page.locator('.option-title', { hasText: new RegExp(`^${s}$`) }) }).click();
  }
  if (shots) await shot(page, shots[1]);
  await dialog.getByRole('button', { name: /^Continuar/ }).click();
  dialog = page.getByRole('dialog', { name: 'Data do agendamento' });
  for (let i = 0; i < 3 && !(await dialog.locator(`button.cal-day[aria-label="${day}"]`).count()); i++) {
    await dialog.getByRole('button', { name: 'Próximo mês' }).click();
  }
  await dialog.locator(`button.cal-day[aria-label="${day}"]`).click();
  await dialog.locator('.slot').first().waitFor();
  if (period) await dialog.getByRole('button', { name: new RegExp(`^${period}`) }).click();
  const slot = dialog.locator('.slot', { hasText: new RegExp(`^${time}$`) });
  if (time) {
    if (shots) await shot(page, shots[2]);
    await slot.click();
    await dialog.getByRole('button', { name: 'Selecionar' }).click();
    await dialog.waitFor({ state: 'detached' });
  }
  return dialog;
}

async function mailLink(to) {
  for (let i = 0; i < 20; i++) {
    const list = await (await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`)).json();
    const m = list.messages?.[0];
    if (m) {
      const full = await (await fetch(`${MAIL}/api/v1/message/${m.ID}`)).json();
      const link = (full.Text || full.HTML || '').match(/https?:\/\/[^\s"'<>]+verify[^\s"'<>]+/);
      if (link) return link[0].replace(/&amp;/g, '&');
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`E-mail para ${to} não chegou`);
}

// ---------- preparação ----------
psql(readFileSync(`${root}/dev/reset.sql`, 'utf8') + readFileSync(`${root}/supabase/seed.sql`, 'utf8'));
await fetch(`${MAIL}/api/v1/messages`, { method: 'DELETE' });
console.log(`hoje ${TODAY} · dia do teste ${D} · dia passado ${P}`);

const browser = await chromium.launch({ args: ['--lang=pt-BR'] });
try {
  // ---------- cliente A: agenda sem conta, cria conta no meio e confirma ----------
  const A = await newPhone(browser);
  await step('cliente abre o app e vê a tela de agendar', async () => {
    await A.goto(APP);
    await A.getByRole('heading', { name: 'Agende seu horário' }).waitFor();
    await A.locator('.status-line').waitFor();
    await shot(A, '01-cliente-inicio');
  });
  await step('escolhe Barbeiro 1, Corte + Barba e o horário das 10:00', async () => {
    await pick(A, { barber: 'Barbeiro 1', services: ['Corte', 'Barba'], day: D, time: '10:00', shots: ['02-cliente-barbeiro', '03-cliente-servicos', '04-cliente-horario'] });
    await A.locator('.summary-line.total', { hasText: 'R$ 60,00' }).waitFor();
    await shot(A, '05-cliente-resumo');
  });
  await step('sem conta, o app pede cadastro e volta com a escolha guardada', async () => {
    await A.getByRole('button', { name: 'Entrar e confirmar' }).click();
    await A.waitForURL(/#\/entrar/);
    await signUpForm(A, { name: 'João Pedro Alves', phone: '84999990101', mail: email('joao') });
    await shot(A, '06-cliente-cadastro');
    await submitSignUp(A);
    await A.waitForURL((u) => u.hash === '#/' || u.hash === '');
    await A.locator('.summary-line.total', { hasText: 'R$ 60,00' }).waitFor();
  });
  await step('confirma e vê "Horário confirmado"', async () => {
    await A.getByRole('button', { name: 'Confirmar agendamento' }).click();
    await A.waitForURL(/#\/agendado\//);
    await A.getByRole('heading', { name: 'Horário confirmado' }).waitFor();
    await A.getByText('Barbeiro 1').first().waitFor();
    await shot(A, '07-cliente-confirmado');
    await A.getByRole('link', { name: 'Ver meus horários' }).click();
    await A.locator('.appt-card').first().waitFor();
    await shot(A, '08-cliente-meus-horarios');
  });

  // ---------- cliente B: "sem preferência" no mesmo horário cai em outro barbeiro ----------
  const B = await newPhone(browser);
  await step('outro cliente no mesmo horário com "Sem preferência" vai para outro barbeiro', async () => {
    await B.goto(`${APP}#/entrar?modo=cadastro`);
    await signUpForm(B, { name: 'Pedro Henrique Costa', phone: '84999990102', mail: email('pedro') });
    await submitSignUp(B);
    await B.goto(APP);
    await pick(B, { barber: 'Sem preferência', services: ['Corte'], day: D, time: '10:00' });
    await B.getByRole('button', { name: 'Confirmar agendamento' }).click();
    await B.waitForURL(/#\/agendado\//);
    await B.getByText('Barbeiro 2').first().waitFor();
  });

  // ---------- cliente C: horário ocupado some; cancela pelo app ----------
  const C = await newPhone(browser);
  await step('horário já ocupado do Barbeiro 1 não aparece para outro cliente', async () => {
    await C.goto(`${APP}#/entrar?modo=cadastro`);
    await signUpForm(C, { name: 'Marcos Vinícius Rocha', phone: '84999990103', mail: email('marcos') });
    await submitSignUp(C);
    await C.goto(APP);
    const dialog = await pick(C, { barber: 'Barbeiro 1', services: ['Corte'], day: D, time: null });
    const times = await dialog.locator('.slot').allInnerTexts();
    assert.ok(!times.includes('10:00') && !times.includes('10:30'), `10:00 e 10:30 deviam estar ocupados: ${times.join(' ')}`);
    assert.ok(times.includes('11:00'), '11:00 devia estar livre');
    await dialog.getByRole('button', { name: 'Fechar' }).click();
  });
  await step('cliente agenda e cancela pelo app, e o horário volta a ficar livre', async () => {
    await C.reload();
    await pick(C, { barber: 'Barbeiro 1', services: ['Corte e barba'], day: D, time: '14:00', period: 'Tarde' });
    await C.getByRole('button', { name: 'Confirmar agendamento' }).click();
    await C.waitForURL(/#\/agendado\//);
    await C.goto(`${APP}#/historico`);
    await C.getByRole('button', { name: 'Cancelar' }).first().click();
    await C.getByRole('dialog').getByRole('button', { name: 'Cancelar horário' }).click();
    await toast(C, 'Agendamento cancelado');
    await C.getByText('Nenhum horário marcado').waitFor();
    await C.goto(APP);
    const dialog = await pick(C, { barber: 'Barbeiro 1', services: ['Corte'], day: D, time: null, period: 'Tarde' });
    assert.ok((await dialog.locator('.slot').allInnerTexts()).includes('14:00'), '14:00 devia voltar a ficar livre');
    await dialog.getByRole('button', { name: 'Fechar' }).click();
    await C.reload();
    await pick(C, { barber: 'Barbeiro 1', services: ['Corte'], day: D, time: '11:00' });
    await C.getByRole('button', { name: 'Confirmar agendamento' }).click();
    await C.waitForURL(/#\/agendado\//);
  });

  // ---------- dono: painel no computador ----------
  const ADM = await newDesktop(browser);
  await step('dono cria a conta e assume o painel no primeiro acesso', async () => {
    await ADM.goto(`${APP}#/entrar?modo=cadastro`);
    await signUpForm(ADM, { name: 'Dono da barbearia', phone: '84998567528', mail: email('dono') });
    await submitSignUp(ADM);
    await ADM.goto(`${APP}#/admin?dia=${D}`);
    await ADM.getByRole('heading', { name: 'Primeiro acesso ao painel' }).waitFor();
    await shot(ADM, '21-painel-primeiro-acesso');
    await ADM.getByRole('button', { name: 'Sou o dono, assumir o painel' }).click();
    await ADM.locator('.event').first().waitFor();
    assert.equal(await ADM.locator('.event').count(), 3, 'a grade devia ter 3 clientes (João, Pedro, Marcos)');
    await shot(ADM, '10-painel-agenda');
  });
  await step('dono marca cliente do balcão clicando num horário livre', async () => {
    await ADM.getByRole('button', { name: 'Marcar às 09:00 com Barbeiro 3' }).click();
    const dialog = ADM.getByRole('dialog', { name: 'Novo agendamento' });
    await dialog.locator('#bk-name').fill('Carlos Lima');
    await dialog.getByLabel('WhatsApp (opcional)').fill('84999990104');
    await dialog.locator('.chip', { hasText: /^Corte e barba/ }).click();
    await shot(ADM, '11-painel-novo-agendamento');
    await dialog.getByRole('button', { name: 'Marcar horário' }).click();
    await ADM.getByRole('dialog', { name: 'Carlos Lima' }).waitFor();
    await shot(ADM, '12-painel-detalhes');
    await ADM.keyboard.press('Escape');
  });
  await step('dono bloqueia um horário e o app para de oferecer', async () => {
    await ADM.getByRole('button', { name: 'Bloquear horário' }).click();
    const dialog = ADM.getByRole('dialog', { name: 'Bloquear horário' });
    await dialog.locator('#bl-barber').selectOption({ label: 'Barbeiro 2' });
    await dialog.getByLabel('Das').fill('15:00');
    await dialog.getByLabel('Até', { exact: true }).fill('16:00');
    await dialog.getByRole('button', { name: 'Compromisso' }).click();
    await dialog.getByRole('button', { name: 'Bloquear', exact: true }).click();
    await toast(ADM, 'Horário bloqueado');
    await ADM.locator('.event.block').waitFor();
    const page = await newPhone(browser);
    await page.goto(APP);
    const sheet = await pick(page, { barber: 'Barbeiro 2', services: ['Corte'], day: D, time: null, period: 'Tarde' });
    const times = await sheet.locator('.slot').allInnerTexts();
    assert.ok(!times.includes('15:00') && !times.includes('15:30') && times.includes('16:00'), `bloqueio não respeitado: ${times.join(' ')}`);
    await page.context().close();
  });
  await step('dono remarca um cliente', async () => {
    await ADM.locator('.event', { hasText: 'Pedro Henrique Costa' }).click();
    await ADM.getByRole('dialog', { name: 'Pedro Henrique Costa' }).getByRole('button', { name: 'Remarcar' }).click();
    const dialog = ADM.getByRole('dialog', { name: /Remarcar/ });
    await dialog.locator('.slot', { hasText: /^16:30$/ }).click();
    await dialog.getByRole('button', { name: 'Salvar novo horário' }).click();
    await toast(ADM, 'Horário remarcado');
    await ADM.getByRole('dialog', { name: 'Pedro Henrique Costa' }).getByText('16:30 – 17:00').waitFor();
    await ADM.keyboard.press('Escape');
    await ADM.waitForTimeout(400);
    await shot(ADM, '13-painel-agenda-cheia');
  });
  await step('dono marca atendimento de ontem como concluído', async () => {
    psql(`
      with a as (
        insert into public.appointments (barber_id, client_id, client_name, client_phone, starts_at, ends_at, total_cents, source)
        select b.id, p.id, p.full_name, p.phone, '${P} 09:00'::timestamp at time zone '${TZ}', '${P} 09:30'::timestamp at time zone '${TZ}', 3500, 'app'
        from public.barbers b, public.profiles p join auth.users u on u.id = p.id
        where b.name = 'Barbeiro 1' and u.email = '${email('joao')}'
        returning id
      )
      insert into public.appointment_services (appointment_id, service_id, name, duration_minutes, price_cents)
      select a.id, s.id, s.name, s.duration_minutes, s.price_cents from a, public.services s where s.name = 'Corte';`);
    await ADM.goto(`${APP}#/admin?dia=${P}`);
    await ADM.locator('.event', { hasText: 'João Pedro Alves' }).click();
    await ADM.getByRole('dialog').getByRole('button', { name: 'Concluir' }).click();
    await toast(ADM, 'Atendimento concluído');
    await ADM.locator('.event.completed').waitFor();
  });
  await step('cliente avalia o atendimento com 5 estrelas', async () => {
    await A.goto(`${APP}#/historico`);
    await A.reload();
    await A.getByRole('button', { name: 'Avaliar' }).first().click();
    const dialog = A.getByRole('dialog');
    await dialog.getByRole('radio', { name: '5 estrelas' }).click();
    await dialog.locator('textarea').fill('Corte perfeito, atendimento pontual.');
    await shot(A, '09-cliente-avaliacao');
    await dialog.getByRole('button', { name: 'Enviar avaliação' }).click();
    await toast(A, 'Obrigado pela avaliação');
  });
  await step('telas do painel: clientes, serviços, barbeiros, horários, avaliações, ajustes', async () => {
    await ADM.goto(`${APP}#/admin/clientes`);
    await ADM.locator('.list-item', { hasText: 'Carlos Lima' }).waitFor();
    assert.equal(await ADM.locator('.list-item').count(), 4, 'devia listar 4 clientes (3 do app e 1 do balcão)');
    await shot(ADM, '14-painel-clientes');
    await ADM.goto(`${APP}#/admin/servicos`);
    await ADM.getByRole('button', { name: 'Editar Pigmentação' }).click();
    await ADM.getByRole('dialog').getByLabel('Preço (R$)').fill('40');
    await ADM.getByRole('dialog').getByRole('button', { name: 'Salvar' }).click();
    await toast(ADM, 'Serviço salvo');
    await ADM.locator('.list-item', { hasText: 'Pigmentação' }).getByText('R$ 40,00').waitFor();
    await shot(ADM, '15-painel-servicos');
    await ADM.goto(`${APP}#/admin/barbeiros`);
    await ADM.locator('.list-item', { hasText: 'Barbeiro 1' }).getByText('5,0').waitFor();
    await shot(ADM, '16-painel-barbeiros');
    await ADM.goto(`${APP}#/admin/horarios`);
    await ADM.getByText('Intervalo (almoço)').first().waitFor();
    await shot(ADM, '17-painel-horarios', true);
    await ADM.goto(`${APP}#/admin/avaliacoes`);
    await ADM.getByText('Corte perfeito, atendimento pontual.').waitFor();
    await shot(ADM, '18-painel-avaliacoes');
    await ADM.goto(`${APP}#/admin/ajustes`);
    await ADM.locator('canvas.qr').waitFor();
    await ADM.waitForTimeout(500);
    await shot(ADM, '19-painel-ajustes', true);
  });
  await step('painel no celular abre a agenda em lista', async () => {
    const M = await newPhone(browser);
    await M.goto(`${APP}#/entrar?voltar=${encodeURIComponent(`/admin?dia=${D}`)}`);
    await M.getByLabel('E-mail').fill(email('dono'));
    await M.getByLabel('Senha', { exact: true }).fill('senha123');
    await M.locator('form').getByRole('button', { name: 'Entrar' }).click();
    await M.locator('.agenda-item').first().waitFor();
    await shot(M, '20-painel-celular');
    await M.context().close();
  });
  await step('cliente esquece a senha, recebe o link e cria outra', async () => {
    const R = await newPhone(browser);
    failShot = R;
    await R.goto(`${APP}#/entrar`);
    await R.getByRole('button', { name: 'Esqueceu a senha?' }).click();
    await R.getByLabel('E-mail').fill(email('joao'));
    await R.getByRole('button', { name: 'Enviar link' }).click();
    await R.getByRole('heading', { name: 'Confira seu e-mail' }).waitFor();
    const link = await mailLink(email('joao'));
    await R.goto(link);
    await R.waitForURL(/#\/redefinir-senha/, { timeout: 15000 });
    await R.getByLabel('Nova senha', { exact: true }).fill('novaSenha456');
    await R.getByLabel('Repita a nova senha', { exact: true }).fill('novaSenha456');
    await R.getByRole('button', { name: 'Salvar nova senha' }).click();
    await toast(R, 'Senha alterada');
    await R.goto(`${APP}#/perfil`);
    await R.getByRole('button', { name: 'Sair' }).click();
    await toast(R, 'Você saiu da conta');
    await R.goto(`${APP}#/entrar`);
    await R.getByLabel('E-mail').fill(email('joao'));
    await R.getByLabel('Senha', { exact: true }).fill('novaSenha456');
    await R.locator('form').getByRole('button', { name: 'Entrar' }).click();
    await toast(R, 'Bem-vindo de volta');
    await R.context().close();
  });
  await step('cliente comum não entra no painel', async () => {
    await B.goto(`${APP}#/admin`);
    await B.getByRole('heading', { name: 'Sem acesso ao painel' }).waitFor();
  });
} catch {
  // o erro já foi registrado no passo
} finally {
  await browser.close();
  console.log(results.join('\n'));
  console.log(failed ? `\n${failed} passo(s) falharam` : `\nTodos os ${results.filter((r) => r.startsWith('ok')).length} passos passaram. Prints em ${OUT}`);
  process.exitCode = failed ? 1 : 0;
}
