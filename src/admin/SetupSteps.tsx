import { Link } from 'react-router-dom';
import { Check, ChevronRight } from 'lucide-react';
import { useShop } from '../state/shop';

/** Primeiros passos do dono: some quando tudo estiver preenchido. */
export function SetupSteps() {
  const { shop, services, barbers, hours, loading } = useShop();
  if (loading) return null;
  const steps = [
    { done: services.some((s) => s.active), label: 'Cadastre os serviços e preços', to: '/admin/servicos' },
    { done: barbers.some((b) => b.active), label: 'Cadastre os barbeiros', to: '/admin/barbeiros' },
    { done: hours.some((h) => h.is_open), label: 'Defina os horários de funcionamento', to: '/admin/horarios' },
    { done: Boolean(shop?.whatsapp && shop?.address), label: 'Preencha WhatsApp, Instagram e endereço', to: '/admin/ajustes' },
  ];
  if (steps.every((s) => s.done)) return null;
  const essentials = steps.slice(0, 3).every((s) => s.done);
  return (
    <section className="card card-pad stack">
      <div>
        <h2 style={{ fontSize: 17 }}>{essentials ? 'Quase pronto' : 'Configure a agenda online'}</h2>
        <p className="muted small" style={{ marginTop: 4 }}>
          {essentials
            ? 'Os clientes já conseguem agendar. Falta completar os dados de contato.'
            : 'Os clientes só conseguem agendar pelo app depois dos três primeiros passos.'}
        </p>
      </div>
      <div className="setup-steps">
        {steps.map((s) => (
          <Link key={s.to} to={s.to} className={`setup-step${s.done ? ' done' : ''}`}>
            <span className={`check${s.done ? ' on' : ''}`}>{s.done && <Check size={14} strokeWidth={3} />}</span>
            <span className="grow">{s.label}</span>
            {!s.done && <ChevronRight size={18} className="muted" />}
          </Link>
        ))}
      </div>
    </section>
  );
}
