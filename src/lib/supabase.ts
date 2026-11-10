import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** false quando o app foi publicado sem os dados do projeto Supabase. */
export const configured = Boolean(url && key);

// Guardado antes do Supabase ler e limpar o link do e-mail (#access_token=... ou #error=...).
const initialHash = typeof window !== 'undefined' ? window.location.hash : '';

/** Mensagem para quando o cliente abre um link de e-mail vencido ou já usado. */
export function emailLinkProblem(): string | null {
  if (!/(^#|&)error(_code|_description)?=/.test(initialHash)) return null;
  if (/otp_expired|expired/i.test(initialHash)) return 'Esse link expirou ou já foi usado. Peça um novo.';
  return 'Não foi possível abrir esse link. Peça um novo.';
}

export const supabase = createClient(url || 'http://localhost:54321', key || 'sem-chave', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'implicit',
    storageKey: 'easycut-auth',
  },
});

/** Endereço base do app (sem o #/rota), usado nos links de e-mail. */
export function appBaseUrl() {
  return window.location.origin + window.location.pathname;
}
