import { Link, useLocation } from 'react-router-dom';
import { LogIn } from 'lucide-react';
import { Empty } from '../ui/kit';

export function LoginPrompt({ title, text }: { title: string; text: string }) {
  const { pathname } = useLocation();
  return (
    <div className="card">
      <Empty icon={<LogIn size={32} />} title={title}>
        <p>{text}</p>
        <div className="row" style={{ marginTop: 6 }}>
          <Link className="btn primary" to={`/entrar?voltar=${encodeURIComponent(pathname)}`}>
            Entrar
          </Link>
          <Link className="btn outline" to={`/entrar?modo=cadastro&voltar=${encodeURIComponent(pathname)}`}>
            Criar conta
          </Link>
        </div>
      </Empty>
    </div>
  );
}
