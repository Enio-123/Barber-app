import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Download, LayoutDashboard, LogOut, MonitorSmartphone, Trash2 } from 'lucide-react';
import { checkPassword, supabase } from '../lib/supabase';
import { useAuth } from '../state/auth';
import { useFeedback } from '../state/feedback';
import { errorMessage } from '../lib/errors';
import { passwordProblem, PASSWORD_HINT } from '../lib/password';
import { downloadText } from '../lib/download';
import { Avatar, PasswordField, Spinner } from '../ui/kit';
import { Sheet } from '../ui/Sheet';
import { ProfileForm } from './ProfileForm';
import { LoginPrompt } from './LoginPrompt';

export function ProfilePage() {
  const { session, profile, isStaff, signOut } = useAuth();
  const { toast } = useFeedback();
  if (!session) return <LoginPrompt title="Sua conta" text="Entre para agendar mais rápido e acompanhar seus horários." />;

  return (
    <div className="stack lg">
      <div className="row" style={{ gap: 14 }}>
        <Avatar name={profile?.full_name || session.user.email || '?'} size={56} />
        <div className="grow">
          <h1 className="page-title" style={{ fontSize: 20 }}>
            {profile?.full_name || 'Sua conta'}
          </h1>
          <p className="muted small ellipsis">{session.user.email}</p>
        </div>
      </div>

      {isStaff && (
        <Link className="btn primary block" to="/admin">
          <LayoutDashboard size={18} /> Abrir painel da barbearia
        </Link>
      )}

      <section className="card card-pad stack">
        <p className="section-title">Seus dados</p>
        {profile && <ProfileForm key={profile.id} />}
      </section>

      <PasswordCard email={session.user.email ?? ''} />

      <PrivacyCard email={session.user.email ?? ''} staff={isStaff} />

      <button
        className="btn outline block"
        onClick={async () => {
          await signOut();
          toast('Você saiu da conta.');
        }}
      >
        <LogOut size={18} /> Sair
      </button>
    </div>
  );
}

function PasswordCard({ email }: { email: string }) {
  const { toast } = useFeedback();
  const [current, setCurrent] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    const problem = passwordProblem(pw);
    if (!current) return setErr('Digite a senha atual.');
    if (problem) return setErr(problem);
    if (pw !== pw2) return setErr('As senhas não são iguais.');
    setErr(null);
    setSaving(true);
    // Confere a senha atual antes: quem pega o celular desbloqueado não troca a senha da conta.
    const wrong = await checkPassword(email, current);
    if (wrong) {
      setSaving(false);
      return setErr(/invalid login credentials/i.test(wrong.message) ? 'Senha atual incorreta.' : errorMessage(wrong));
    }
    const { error } = await supabase.auth.updateUser({ password: pw, current_password: current });
    if (error) {
      setSaving(false);
      return setErr(errorMessage(error));
    }
    // Quem estava logado com a senha antiga em outro aparelho sai.
    await supabase.auth.signOut({ scope: 'others' });
    setSaving(false);
    setCurrent('');
    setPw('');
    setPw2('');
    toast('Senha alterada. Os outros aparelhos saíram da conta.');
  }
  return (
    <form className="card card-pad form" onSubmit={submit} noValidate>
      <p className="section-title">Alterar senha</p>
      <PasswordField label="Senha atual" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
      <PasswordField label="Nova senha" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} hint={PASSWORD_HINT} />
      <PasswordField label="Repita a nova senha" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} error={err} />
      <button className="btn outline block" disabled={saving || !pw}>
        {saving && <Spinner small />} Salvar nova senha
      </button>
    </form>
  );
}

/** Privacidade: baixar os próprios dados, encerrar sessões e excluir a conta. */
function PrivacyCard({ email, staff }: { email: string; staff: boolean }) {
  const { toast, confirm } = useFeedback();
  const [busy, setBusy] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function download() {
    setBusy('data');
    const { data, error } = await supabase.rpc('my_data');
    setBusy(null);
    if (error) return toast(errorMessage(error), 'error');
    downloadText('meus-dados-easy-cut.json', JSON.stringify(data, null, 2), 'application/json;charset=utf-8');
    toast('Arquivo com os seus dados baixado.');
  }

  async function endOthers() {
    const ok = await confirm({
      title: 'Encerrar as outras sessões?',
      text: 'Todos os outros celulares e computadores com a sua conta aberta saem dela. Este aparelho continua conectado.',
      confirm: 'Encerrar',
    });
    if (!ok) return;
    setBusy('others');
    const { error } = await supabase.auth.signOut({ scope: 'others' });
    setBusy(null);
    if (error) return toast(errorMessage(error), 'error');
    toast('Pronto, os outros aparelhos saíram da conta.');
  }

  return (
    <section className="card card-pad stack">
      <p className="section-title">Privacidade e segurança</p>
      <p className="text-2 small">
        Veja como usamos os seus dados na <Link to="/privacidade">Política de privacidade</Link> e as regras nos{' '}
        <Link to="/termos">Termos de uso</Link>.
      </p>
      <button className="btn outline block" disabled={busy !== null} onClick={download}>
        {busy === 'data' ? <Spinner small /> : <Download size={18} />} Baixar meus dados
      </button>
      <button className="btn outline block" disabled={busy !== null} onClick={endOthers}>
        {busy === 'others' ? <Spinner small /> : <MonitorSmartphone size={18} />} Encerrar as outras sessões
      </button>
      {staff ? (
        <p className="small muted">Contas da equipe não são excluídas por aqui. Peça para o dono tirar seu acesso ao painel antes.</p>
      ) : (
        <button className="btn danger-outline block" disabled={busy !== null} onClick={() => setDeleting(true)}>
          <Trash2 size={18} /> Excluir minha conta
        </button>
      )}
      {deleting && <DeleteAccountSheet email={email} onClose={() => setDeleting(false)} />}
    </section>
  );
}

function DeleteAccountSheet({ email, onClose }: { email: string; onClose: () => void }) {
  const { toast } = useFeedback();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function remove() {
    if (!password) return setErr('Digite sua senha para confirmar.');
    setBusy(true);
    setErr(null);
    // O banco só exclui com login de agora há pouco: entra de novo com a senha e exclui em seguida.
    const { error: loginError } = await supabase.auth.signInWithPassword({ email, password });
    if (loginError) {
      setBusy(false);
      return setErr(/invalid login credentials/i.test(loginError.message) ? 'Senha incorreta.' : errorMessage(loginError));
    }
    const { error } = await supabase.rpc('delete_my_account');
    if (error) {
      setBusy(false);
      return setErr(errorMessage(error));
    }
    await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
    try {
      sessionStorage.clear();
    } catch {
      /* sem armazenamento */
    }
    toast('Sua conta foi excluída.');
    navigate('/', { replace: true });
  }

  return (
    <Sheet
      title="Excluir minha conta"
      onClose={onClose}
      footer={
        <>
          <button className="btn outline" onClick={onClose}>
            Voltar
          </button>
          <button className="btn danger" disabled={busy} onClick={remove}>
            {busy && <Spinner small />} Excluir de vez
          </button>
        </>
      }
    >
      <div className="form">
        <p className="text-2">Isso não tem volta. Ao excluir:</p>
        <ul className="text-2 small" style={{ paddingLeft: 18, lineHeight: 1.6 }}>
          <li>sua conta, seu perfil e suas avaliações são apagados;</li>
          <li>os horários que você tem marcados são cancelados;</li>
          <li>os atendimentos que já aconteceram ficam sem o seu nome e telefone.</li>
        </ul>
        <p className="small muted">Se quiser guardar uma cópia, use Baixar meus dados antes.</p>
        <PasswordField label="Sua senha" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} error={err} />
      </div>
    </Sheet>
  );
}
