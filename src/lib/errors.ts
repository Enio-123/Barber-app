// Traduz os erros do banco e do login para mensagens claras em português.

const CODES: Record<string, string> = {
  LOGIN_NECESSARIO: 'Entre na sua conta para agendar.',
  PERFIL_INCOMPLETO: 'Complete seu nome e WhatsApp no perfil para agendar.',
  LIMITE_AGENDAMENTOS: 'Você já tem o máximo de horários marcados. Cancele um ou aguarde o atendimento para marcar outro.',
  HORARIO_INDISPONIVEL: 'Esse horário acabou de ser ocupado. Escolha outro.',
  PRAZO_CANCELAMENTO: 'O prazo para cancelar pelo app já passou. Fale com a barbearia pelo WhatsApp.',
  NAO_PODE_CANCELAR: 'Esse agendamento não pode mais ser cancelado.',
  NAO_ENCONTRADO: 'Agendamento não encontrado.',
  AINDA_NAO_ACONTECEU: 'Esse atendimento ainda não aconteceu.',
  NOTA_INVALIDA: 'Escolha de 1 a 5 estrelas.',
  SEM_PERMISSAO: 'Você não tem acesso a essa área.',
  STATUS_INVALIDO: 'Situação inválida.',
  JA_CANCELADO: 'Esse agendamento já foi cancelado.',
  BARBEIRO_INVALIDO: 'Escolha um barbeiro ativo.',
  SERVICO_INVALIDO: 'Escolha pelo menos um serviço.',
  CLIENTE_INVALIDO: 'Cliente não encontrado.',
  NOME_OBRIGATORIO: 'Informe o nome do cliente.',
  TELEFONE_INVALIDO: 'WhatsApp inválido. Use DDD + número.',
  INTERVALO_INVALIDO: 'O fim precisa ser depois do início.',
  CONFLITO_BLOQUEIO: 'Já tem cliente marcado nesse intervalo. Remarque ou cancele antes de bloquear.',
  USUARIO_NAO_ENCONTRADO: 'Não existe conta com esse e-mail. A pessoa precisa se cadastrar no app primeiro.',
  ULTIMO_ADMIN: 'A barbearia precisa de pelo menos um administrador.',
  ULTIMO_DONO: 'A barbearia precisa de pelo menos um dono. Passe a posse para outra pessoa antes.',
  PAPEL_INVALIDO: 'Permissão inválida.',
  JA_TEM_DONO: 'Este painel já tem dono. Peça para ele liberar seu e-mail em Ajustes, na parte Equipe.',
  SEM_CODIGO: 'Ainda não existe código de primeiro acesso. Quem configurou o sistema precisa gerar um.',
  CODIGO_INVALIDO: 'Código incorreto. Confira as letras e os números.',
  CODIGO_BLOQUEADO: 'Código bloqueado depois de 10 tentativas erradas. Peça um código novo para quem configurou o sistema.',
  NAO_PODE_SI_MESMO: 'Você não pode fazer isso na sua própria conta.',
  NAO_PODE_REMARCAR: 'Só dá para remarcar horários confirmados.',
  LIMITE_DIARIO: 'Esta conta já fez muitos agendamentos hoje. Tente amanhã ou fale com a barbearia pelo WhatsApp.',
  ACEITE_TERMOS: 'Para agendar, aceite os Termos de uso e a Política de privacidade.',
  VERSAO_INVALIDA: 'Não foi possível registrar o aceite. Tente de novo.',
  EQUIPE_NAO_EXCLUI: 'Contas da equipe não são excluídas por aqui. Peça para o dono tirar seu acesso ao painel antes.',
  LOGIN_RECENTE: 'Por segurança, confirme sua senha de novo.',
  FORMATO_FOTO: 'Use uma foto JPG, PNG ou WebP.',
};

// Códigos do login do Supabase (campo "code" do erro).
const AUTH_CODES: Record<string, string> = {
  weak_password: 'Senha fraca. Use pelo menos 8 caracteres, com letras e números.',
  same_password: 'A nova senha precisa ser diferente da atual.',
  mfa_verification_failed: 'Código incorreto ou vencido. Digite o código que aparece agora no app autenticador.',
  insufficient_aal: 'Confirme com o código do app autenticador primeiro.',
  mfa_factor_name_conflict: 'Já existe um autenticador com esse nome. Tente de novo.',
  mfa_challenge_expired: 'O código demorou demais. Digite o código novo do app.',
  user_already_exists: 'Não foi possível criar a conta com esse e-mail. Se você já tem conta, toque em "Entrar" ou em "Esqueceu a senha?".',
  email_exists: 'Não foi possível criar a conta com esse e-mail. Se você já tem conta, toque em "Entrar" ou em "Esqueceu a senha?".',
  over_request_rate_limit: 'Muitas tentativas agora. Espere alguns minutos e tente de novo.',
  over_email_send_rate_limit: 'Muitos e-mails enviados agora. Espere alguns minutos e tente de novo.',
  reauthentication_needed: 'Por segurança, confirme sua senha de novo.',
  session_not_found: 'Sua sessão terminou. Entre de novo.',
};

const AUTH: [RegExp, string][] = [
  [/invalid login credentials/i, 'E-mail ou senha incorretos.'],
  [/user already registered|already been registered/i, AUTH_CODES.user_already_exists],
  [/password should be at least|password is too short|password should contain/i, AUTH_CODES.weak_password],
  [/invalid totp code|invalid mfa|totp code/i, AUTH_CODES.mfa_verification_failed],
  [/aal2 required|aal2 session/i, AUTH_CODES.insufficient_aal],
  [/email not confirmed/i, 'Confirme seu e-mail pelo link que enviamos antes de entrar.'],
  [/rate limit|too many requests|security purposes/i, 'Muitas tentativas agora. Espere alguns minutos e tente de novo.'],
  [/invalid format|unable to validate email/i, 'E-mail inválido.'],
  [/should be different from the old/i, 'A nova senha precisa ser diferente da atual.'],
  [/auth session missing|session.*expired|jwt expired/i, 'Sua sessão expirou. Entre de novo.'],
  [/signups not allowed/i, 'Cadastros estão desativados no momento.'],
  [/failed to fetch|network|load failed/i, 'Sem conexão com o servidor. Verifique sua internet.'],
];

type AnyError = { message?: string; code?: string; details?: string } | null | undefined;

export function errorMessage(error: unknown): string {
  const e = error as AnyError;
  if (!e) return 'Algo deu errado. Tente de novo.';
  const msg = e.message ?? String(error);
  if (CODES[msg]) return CODES[msg];
  if (e.code && AUTH_CODES[e.code]) return AUTH_CODES[e.code];
  if (e.code === '23P01') return CODES.HORARIO_INDISPONIVEL;
  if (e.code === '23503') return 'Esse item já foi usado em agendamentos. Desative em vez de apagar.';
  if (e.code === '23514') return 'Algum dado está fora do formato aceito. Confira e tente de novo.';
  if (e.code === '42501') return CODES.SEM_PERMISSAO;
  for (const [re, text] of AUTH) if (re.test(msg)) return text;
  return 'Algo deu errado. Tente de novo.';
}

export const isCode = (error: unknown, code: string) => (error as AnyError)?.message === code;
