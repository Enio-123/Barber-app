import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { LayoutDashboard, LogOut } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../state/auth';
import { useFeedback } from '../state/feedback';
import { errorMessage } from '../lib/errors';
import { Avatar, PasswordField, Spinner } from '../ui/kit';
import { ProfileForm } from './ProfileForm';
import { LoginPrompt } from './LoginPrompt';

export function ProfilePage() {
  const { session, profile, isAdmin, signOut } = useAuth();
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

      {isAdmin && (
        <Link className="btn primary block" to="/admin">
          <LayoutDashboard size={18} /> Abrir painel da barbearia
        </Link>
      )}

      <section className="card card-pad stack">
        <p className="section-title">Seus dados</p>
        {profile && <ProfileForm key={profile.id} />}
      </section>

      <PasswordCard />

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

function PasswordCard() {
  const { toast } = useFeedback();
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pw.length < 6) return setErr('A senha precisa ter pelo menos 6 caracteres.');
    if (pw !== pw2) return setErr('As senhas não são iguais.');
    setErr(null);
    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setSaving(false);
    if (error) return setErr(errorMessage(error));
    setPw('');
    setPw2('');
    toast('Senha alterada.');
  }
  return (
    <form className="card card-pad form" onSubmit={submit} noValidate>
      <p className="section-title">Alterar senha</p>
      <PasswordField label="Nova senha" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
      <PasswordField label="Repita a nova senha" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} error={err} />
      <button className="btn outline block" disabled={saving || !pw}>
        {saving && <Spinner small />} Salvar nova senha
      </button>
    </form>
  );
}
