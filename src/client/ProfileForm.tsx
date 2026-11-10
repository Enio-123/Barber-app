import { useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../state/auth';
import { useFeedback } from '../state/feedback';
import { errorMessage } from '../lib/errors';
import { formatPhone, maskPhone, onlyDigits, validPhone } from '../lib/format';
import { Field, Spinner } from '../ui/kit';

export function ProfileForm({ submitLabel = 'Salvar', onSaved }: { submitLabel?: string; onSaved?: () => void | Promise<void> }) {
  const { profile, refreshProfile } = useAuth();
  const { toast } = useFeedback();
  const [name, setName] = useState(profile?.full_name ?? '');
  const [phone, setPhone] = useState(formatPhone(profile?.phone));
  const [errors, setErrors] = useState<{ name?: string; phone?: string }>({});
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const errs: typeof errors = {};
    if (name.trim().length < 2) errs.name = 'Informe seu nome.';
    if (!validPhone(phone)) errs.phone = 'Informe o WhatsApp com DDD.';
    setErrors(errs);
    if (Object.keys(errs).length || !profile) return;
    setSaving(true);
    const { error } = await supabase
      .from('profiles')
      .update({ full_name: name.trim(), phone: onlyDigits(phone) })
      .eq('id', profile.id);
    setSaving(false);
    if (error) return toast(errorMessage(error), 'error');
    await refreshProfile();
    if (onSaved) await onSaved();
    else toast('Dados salvos.');
  }

  return (
    <form className="form" onSubmit={submit} noValidate>
      <Field label="Nome" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} error={errors.name} maxLength={80} />
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
      <button className="btn primary block" disabled={saving}>
        {saving && <Spinner small />}
        {submitLabel}
      </button>
    </form>
  );
}
