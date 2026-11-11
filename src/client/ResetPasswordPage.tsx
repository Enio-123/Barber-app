import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../state/auth';
import { useFeedback } from '../state/feedback';
import { errorMessage } from '../lib/errors';
import { passwordProblem, PASSWORD_HINT } from '../lib/password';
import { Empty, PasswordField, Spinner } from '../ui/kit';

export function ResetPasswordPage() {
  const { session, clearRecovering } = useAuth();
  const { toast } = useFeedback();
  const navigate = useNavigate();
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!session) {
    return (
      <div className="card">
        <Empty title="Link expirado ou inválido">
          <p>Peça um novo link em "Esqueceu a senha?".</p>
        </Empty>
      </div>
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const problem = passwordProblem(pw);
    if (problem) return setErr(problem);
    if (pw !== pw2) return setErr('As senhas não são iguais.');
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    if (error) {
      setBusy(false);
      return setErr(errorMessage(error));
    }
    // Quem pediu a troca pode estar recuperando uma conta invadida: tira a conta dos outros aparelhos.
    await supabase.auth.signOut({ scope: 'others' });
    setBusy(false);
    clearRecovering();
    toast('Senha alterada. Os outros aparelhos saíram da conta.');
    navigate('/', { replace: true });
  }

  return (
    <div className="stack lg">
      <div>
        <h1 className="page-title">Criar nova senha</h1>
        <p className="page-sub">{PASSWORD_HINT}</p>
      </div>
      <form className="form" onSubmit={submit} noValidate>
        <PasswordField label="Nova senha" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
        <PasswordField label="Repita a nova senha" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} error={err} />
        <button className="btn primary block" disabled={busy}>
          {busy && <Spinner small />} Salvar nova senha
        </button>
      </form>
    </div>
  );
}
