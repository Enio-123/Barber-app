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
  PAPEL_INVALIDO: 'Permissão inválida.',
  JA_TEM_DONO: 'Este painel já tem dono. Peça para ele liberar seu e-mail em Ajustes, na parte Equipe.',
};

const AUTH: [RegExp, string][] = [
  [/invalid login credentials/i, 'E-mail ou senha incorretos.'],
  [/user already registered|already been registered/i, 'Já existe uma conta com esse e-mail. Use "Entrar".'],
  [/password should be at least|password is too short/i, 'A senha precisa ter pelo menos 6 caracteres.'],
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
  if (e.code === '23P01') return CODES.HORARIO_INDISPONIVEL;
  if (e.code === '23503') return 'Esse item já foi usado em agendamentos. Desative em vez de apagar.';
  if (e.code === '23514') return 'Algum dado está fora do formato aceito. Confira e tente de novo.';
  if (e.code === '42501') return CODES.SEM_PERMISSAO;
  for (const [re, text] of AUTH) if (re.test(msg)) return text;
  return 'Algo deu errado. Tente de novo.';
}

export const isCode = (error: unknown, code: string) => (error as AnyError)?.message === code;
