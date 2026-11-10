// Datas sempre no fuso da barbearia, não no fuso do celular de quem abre o app.

export type DayKey = string; // AAAA-MM-DD

const cache = new Map<string, Intl.DateTimeFormat>();
function fmt(locale: string, opts: Intl.DateTimeFormatOptions) {
  const key = locale + JSON.stringify(opts);
  let f = cache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, opts);
    cache.set(key, f);
  }
  return f;
}

const pad = (n: number) => String(n).padStart(2, '0');
const WD: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function zoned(date: Date | string, tz: string) {
  const p = fmt('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    weekday: 'short',
  }).formatToParts(new Date(date));
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? '0';
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')) % 24,
    minute: Number(get('minute')),
    weekday: WD[get('weekday')] ?? 0,
  };
}

export function dayKeyOf(date: Date | string, tz: string): DayKey {
  const z = zoned(date, tz);
  return `${z.year}-${pad(z.month)}-${pad(z.day)}`;
}

export const todayKey = (tz: string) => dayKeyOf(new Date(), tz);

function utcNoon(key: DayKey) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
}

export function addDays(key: DayKey, n: number): DayKey {
  const t = utcNoon(key);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

export const weekdayOf = (key: DayKey) => utcNoon(key).getUTCDay();

/** Horário de parede (dia + HH:MM) no fuso da barbearia -> instante real. */
export function zonedToDate(key: DayKey, hhmm: string, tz: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  const [hh, mm] = hhmm.split(':').map(Number);
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  const offset = (t: number) => {
    const z = zoned(new Date(t), tz);
    return Date.UTC(z.year, z.month - 1, z.day, z.hour, z.minute) - t;
  };
  let t = wall - offset(wall);
  t = wall - offset(t);
  return new Date(t);
}

export function timeOf(date: Date | string, tz: string) {
  const z = zoned(date, tz);
  return `${pad(z.hour)}:${pad(z.minute)}`;
}

export function minutesOf(date: Date | string, tz: string) {
  const z = zoned(date, tz);
  return z.hour * 60 + z.minute;
}

/** "08:30:00" -> 510 */
export function hhmmToMin(t: string | null | undefined) {
  if (!t) return 0;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

export const minToHhmm = (m: number) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
export const shortTime = (t: string | null | undefined) => (t ? t.slice(0, 5) : '');

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function formatDay(key: DayKey, style: 'long' | 'medium' | 'short' = 'long') {
  const d = utcNoon(key);
  if (style === 'long') {
    return cap(fmt('pt-BR', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' }).format(d));
  }
  if (style === 'medium') {
    return cap(fmt('pt-BR', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' }).format(d)).replace(/\./g, '');
  }
  return fmt('pt-BR', { timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);
}

export function monthLabel(year: number, month: number) {
  const d = new Date(Date.UTC(year, month - 1, 15));
  return cap(fmt('pt-BR', { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(d)).replace(' de ', ' ');
}

export const WEEKDAYS_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
export const WEEKDAYS_LONG = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

/** Ordem de exibição começando na segunda. */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

export function durationLabel(min: number) {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const r = min % 60;
  return r ? `${h}h${pad(r)}` : `${h}h`;
}

export function relativeLimit(min: number) {
  if (min === 0) return 'a qualquer momento';
  if (min < 60) return `${min} minutos`;
  const h = min / 60;
  if (h === 1) return '1 hora';
  if (h < 24) return `${h} horas`;
  return h === 24 ? '1 dia' : `${h / 24} dias`;
}
