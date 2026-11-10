export const onlyDigits = (s: string) => s.replace(/\D/g, '');

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export function money(cents: number | null | undefined) {
  return cents == null ? 'A combinar' : BRL.format(cents / 100);
}

/** "35,90" ou "35" -> 3590. Vazio -> null. */
export function parseMoney(text: string): number | null | 'invalid' {
  const t = text.trim().replace(/^R\$\s*/i, '');
  if (!t) return null;
  const norm = t.replace(/\./g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(norm)) return 'invalid';
  return Math.round(Number(norm) * 100);
}

export const centsToInput = (c: number | null) => (c == null ? '' : (c / 100).toFixed(2).replace('.', ','));

/** Mostra 84998567528 como (84) 99856-7528. */
export function formatPhone(digits: string | null | undefined) {
  if (!digits) return '';
  let d = onlyDigits(digits);
  if (d.length >= 12 && d.startsWith('55')) d = d.slice(2);
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return digits;
}

/** Máscara enquanto digita. */
export function maskPhone(value: string) {
  const d = onlyDigits(value).slice(0, 11);
  if (d.length <= 2) return d.length ? `(${d}` : '';
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

export const validPhone = (value: string) => /^\d{10,11}$/.test(onlyDigits(value));

/** Telefone do Brasil com DDD -> formato do banco da barbearia (55 + DDD + número). */
export function toWhatsappDigits(value: string) {
  const d = onlyDigits(value);
  if (d.length === 10 || d.length === 11) return `55${d}`;
  return d;
}

export function waLink(phone: string, text?: string) {
  let d = onlyDigits(phone);
  if (d.length <= 11) d = `55${d}`;
  return `https://wa.me/${d}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
}

export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const first = parts[0][0];
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase();
}

export const validEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());

export function sumPrices(items: { price_cents: number | null }[]) {
  const known = items.filter((i) => i.price_cents != null).reduce((a, i) => a + (i.price_cents ?? 0), 0);
  const unknown = items.some((i) => i.price_cents == null);
  return { known, unknown };
}

export function priceSummary(items: { price_cents: number | null }[]) {
  const { known, unknown } = sumPrices(items);
  if (!items.length) return '';
  if (unknown && known === 0) return 'A combinar';
  return unknown ? `${money(known)} + a combinar` : money(known);
}
