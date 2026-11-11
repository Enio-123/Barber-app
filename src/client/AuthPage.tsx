import { useEffect, useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { MailCheck } from 'lucide-react';
import { appBaseUrl, supabase } from '../lib/supabase';
import { useAuth } from '../state/auth';
import { useFeedback } from '../state/feedback';
import { errorMessage } from '../lib/errors';
import { maskPhone, onlyDigits, validEmail, validPhone } from '../lib/format';
import { passwordProblem, PASSWORD_HINT } from '../lib/password';
import { TERMS_VERSION } from '../lib/legal';
import { Empty, Field, PasswordField, Spinner } from '../ui/kit';

type Mode = 'entrar' | 'cadastro' | 'esqueci';

/** Depois de entrar, só volta para uma tela do próprio app (um link nunca leva a pessoa para outro site). */
function safeBack(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || /[\\\s]/.test(value)) return '/';
  return value;
}

export function AuthPage() {
  const [params] = useSearchParams();
  const { session, refreshProfile } = useAuth();
  const { toast } = useFeedback();
  const navigate = useNavigate();
  const back = safeBack(params.get('voltar'));
  const [mode, setMode] = useState<Mode>(() => {
    const m = params.get('modo');
    return m === 'cadastro' || m === 'esqueci' ? m : 'entrar';
  });
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [terms, setTerms] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<null | 'confirmar' | 'senha'>(null);

  useEffect(() => {
    setErrors({});
    setFormError(null);
  }, [mode]);

  if (session && !sent) return <Navigate to={back} replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (mode === 'cadastro') {
      if (name.trim().length < 2) errs.name = 'Informe seu nome.';
      if (!validPhone(phone)) errs.phone = 'Informe o WhatsApp com DDD.';
      const weak = passwordProblem(password);
      if (weak) errs.password = weak;
      if (!terms) errs.terms = 'Para criar a conta, aceite os Termos de uso e a Política de privacidade.';
    }
    if (!validEmail(email)) errs.email = 'Informe um e-mail válido.';
    if (mode === 'entrar' && !password) errs.password = 'Digite sua senha.';
    setErrors(errs);
    setFormError(null);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      if (mode === 'entrar') {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
        await refreshProfile();
        toast('Bem-vindo de volta!');
        navigate(back, { replace: true });
      } else if (mode === 'cadastro') {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            data: { full_name: name.trim(), phone: onlyDigits(phone), terms_version: TERMS_VERSION },
            emailRedirectTo: appBaseUrl(),
          },
        });
        if (error) throw error;
        if (data.session) {
          await refreshProfile();
          toast('Conta criada!');
          navigate(back, { replace: true });
        } else {
          // Mesma resposta para e-mail novo e e-mail que já tem conta: ninguém descobre quem é cliente.
          setSent('confirmar');
        }
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: appBaseUrl() });
        if (error) throw error;
        setSent('senha');
      }
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div className="card">
        <Empty icon={<MailCheck size={34} />} title="Confira seu e-mail">
          <p>
            {sent === 'confirmar'
              ? `Se ${email} ainda não tiver conta, enviamos um link de confirmação. Depois de confirmar, é só entrar. Se você já tem conta, entre ou use "Esqueceu a senha?".`
              : `Se existir uma conta com ${email}, você vai receber um link para criar uma nova senha.`}
          </p>
          <button className="btn outline" onClick={() => { setSent(null); setMode('entrar'); }}>
            Voltar para entrar
          </button>
        </Empty>
      </div>
    );
  }

  return (
    <div className="stack lg">
      <div className="camo-hero">
        <h1 className="page-title">{mode === 'esqueci' ? 'Recuperar senha' : mode === 'cadastro' ? 'Criar conta' : 'Acesse sua conta'}</h1>
        <p className="page-sub">
          {mode === 'esqueci'
            ? 'Informe o e-mail da sua conta para receber o link.'
            : 'Com a conta você agenda em segundos e acompanha seus horários.'}
        </p>
      </div>

      {mode !== 'esqueci' && (
        <div className="auth-tabs" role="group">
          <button type="button" aria-pressed={mode === 'entrar'} onClick={() => setMode('entrar')}>
            Entrar
          </button>
          <button type="button" aria-pressed={mode === 'cadastro'} onClick={() => setMode('cadastro')}>
            Criar conta
          </button>
        </div>
      )}

      <form className="form" onSubmit={submit} noValidate>
        {mode === 'cadastro' && (
          <>
            <Field label="Nome completo" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} error={errors.name} maxLength={80} />
            <Field
              label="WhatsApp"
              type="tel"
              inputMode="tel"
              autoComplete="tel-national"
              placeholder="(84) 99999-9999"
              value={phone}
              onChange={(e) => setPhone(maskPhone(e.target.value))}
              error={errors.phone}
            />
          </>
        )}
        <Field
          label="E-mail"
          type="email"
          inputMode="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={errors.email}
        />
        {mode !== 'esqueci' && (
          <PasswordField
            label="Senha"
            autoComplete={mode === 'cadastro' ? 'new-password' : 'current-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={errors.password}
            hint={mode === 'cadastro' ? PASSWORD_HINT : undefined}
          />
        )}
        {mode === 'cadastro' && (
          <div className="field">
            <label className="consent">
              <input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} aria-invalid={errors.terms ? true : undefined} />
              <span>
                Li e aceito os{' '}
                <Link to="/termos" target="_blank" rel="noopener">
                  Termos de uso
                </Link>{' '}
                e a{' '}
                <Link to="/privacidade" target="_blank" rel="noopener">
                  Política de privacidade
                </Link>
                .
              </span>
            </label>
            {errors.terms && <span className="error-text">{errors.terms}</span>}
          </div>
        )}
        {formError && <p className="error-text" role="alert">{formError}</p>}
        <button className="btn primary block" disabled={busy}>
          {busy && <Spinner small />}
          {mode === 'entrar' ? 'Entrar' : mode === 'cadastro' ? 'Criar conta' : 'Enviar link'}
        </button>
      </form>

      <div style={{ textAlign: 'center' }}>
        {mode === 'entrar' && (
          <button className="link-btn" onClick={() => setMode('esqueci')}>
            Esqueceu a senha?
          </button>
        )}
        {mode === 'esqueci' && (
          <button className="link-btn" onClick={() => setMode('entrar')}>
            Voltar para entrar
          </button>
        )}
      </div>
    </div>
  );
}
