/** Mesma regra configurada no login do Supabase: pelo menos 8 caracteres, com letras e números. */
export function passwordProblem(pw: string): string | null {
  if (pw.length < 8) return 'A senha precisa ter pelo menos 8 caracteres.';
  if (pw.length > 72) return 'Use no máximo 72 caracteres.';
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return 'Use letras e números na senha.';
  return null;
}

export const PASSWORD_HINT = 'Pelo menos 8 caracteres, com letras e números.';
