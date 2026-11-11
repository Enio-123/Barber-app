import { Link } from 'react-router-dom';
import { useShop } from '../state/shop';
import { formatPhone } from '../lib/format';
import { relativeLimit } from '../lib/time';
import { TERMS_VERSION } from '../lib/legal';

// Rascunhos de Política de privacidade e Termos de uso. Antes do lançamento, peça para um advogado revisar.
// Os dados da barbearia vêm do cadastro no painel (nada aqui é inventado).

const versionLabel = () => {
  const [y, m, d] = TERMS_VERSION.split('-');
  return `Versão de ${d}/${m}/${y}`;
};

function useContact() {
  const { shop } = useShop();
  const name = shop?.name ?? 'a barbearia';
  const whatsapp = shop?.whatsapp ? `WhatsApp ${formatPhone(shop.whatsapp)}` : 'WhatsApp da barbearia (na aba Barbearia do app)';
  return { shop, name, whatsapp, address: shop?.address ?? null };
}

export function PrivacyPage() {
  const { name, whatsapp, address } = useContact();
  return (
    <article className="stack lg legal">
      <div>
        <h1 className="page-title">Política de privacidade</h1>
        <p className="page-sub">{versionLabel()}</p>
      </div>

      <section className="card card-pad stack">
        <p>
          Esta política explica quais dados pessoais o app de agendamento da {name} usa, para quê, com quem eles ficam e quais são os seus
          direitos pela Lei Geral de Proteção de Dados (LGPD, Lei 13.709/2018).
        </p>

        <h2>1. Quem cuida dos seus dados</h2>
        <p>
          A {name} é a responsável (controladora) pelos dados do app. Para qualquer assunto sobre seus dados, fale com a barbearia pelo{' '}
          {whatsapp}
          {address ? ` ou no endereço ${address}` : ''}.
        </p>

        <h2>2. Quais dados o app guarda</h2>
        <ul>
          <li>
            <strong>Conta:</strong> nome, WhatsApp, e-mail e senha. A senha fica guardada só de forma cifrada: ninguém da barbearia consegue
            ver.
          </li>
          <li>
            <strong>Agendamentos:</strong> dia, horário, serviços, barbeiro, valor, a observação que você escrever e cancelamentos.
          </li>
          <li>
            <strong>Avaliações:</strong> a nota e o comentário que você der depois do atendimento.
          </li>
          <li>
            <strong>Segurança:</strong> data do cadastro e do último acesso. O serviço de login também registra o endereço IP e o tipo de
            aparelho para proteger a conta contra acessos indevidos.
          </li>
        </ul>

        <h2>3. Para que usamos</h2>
        <ul>
          <li>Marcar, organizar e mostrar seus horários e o seu histórico.</li>
          <li>Falar com você pelo WhatsApp sobre o seu horário (confirmação, lembrete, remarcação).</li>
          <li>Mostrar a nota média de cada barbeiro (sem o seu nome) e melhorar o atendimento.</li>
          <li>Proteger a sua conta, evitar abuso e cumprir obrigações legais.</li>
        </ul>
        <p>
          Os dados são usados para prestar o serviço que você pediu (art. 7º, V, da LGPD), por legítimo interesse na segurança da conta e
          na prevenção de fraudes (art. 7º, IX) e para cumprir obrigações legais quando houver (art. 7º, II).
        </p>

        <h2>4. Quem mais tem acesso</h2>
        <ul>
          <li>
            A equipe da barbearia, cada pessoa só com o necessário para a sua função. O barbeiro, por exemplo, vê só a própria agenda.
          </li>
          <li>
            Fornecedores de tecnologia que guardam e entregam o app: Supabase (banco de dados e login, com servidores em São Paulo) e
            GitHub Pages (entrega os arquivos do site e registra acessos técnicos, como qualquer site).
          </li>
          <li>Autoridades, só quando a lei exigir.</li>
        </ul>
        <p>Seus dados não são vendidos nem usados para propaganda.</p>

        <h2>5. Por quanto tempo</h2>
        <p>
          Enquanto a sua conta existir. Se você excluir a conta, apagamos na hora a conta, o perfil e as avaliações, e cancelamos os
          horários futuros. Os atendimentos que já aconteceram ficam sem o seu nome, telefone e observação, só para o controle da agenda e
          do caixa da barbearia.
        </p>

        <h2>6. Seus direitos</h2>
        <ul>
          <li>
            Ver e levar seus dados: em <Link to="/perfil">Perfil</Link>, toque em Baixar meus dados.
          </li>
          <li>
            Corrigir nome e WhatsApp: em <Link to="/perfil">Perfil</Link>.
          </li>
          <li>
            Excluir a conta: em <Link to="/perfil">Perfil</Link>, toque em Excluir minha conta.
          </li>
          <li>Saber com quem os dados são compartilhados (item 4), pedir informações e se opor a algum uso: pelo {whatsapp}.</li>
          <li>Reclamar à Autoridade Nacional de Proteção de Dados (ANPD), pelo site gov.br/anpd.</li>
        </ul>

        <h2>7. Segurança</h2>
        <p>
          Conexão sempre criptografada, senha forte, verificação em duas etapas obrigatória para a equipe, cada pessoa da equipe vê só o
          que precisa, registro das ações da equipe e limites contra abuso. Nenhum sistema é totalmente imune a falhas: se acontecer um
          incidente que possa trazer risco a você, avisamos você e a ANPD.
        </p>

        <h2>8. O que fica no seu aparelho</h2>
        <p>
          O app guarda no seu aparelho a sessão de login (para você não precisar entrar toda vez) e os arquivos do próprio app (para abrir
          rápido). Não usamos cookies de propaganda nem rastreadores de outras empresas.
        </p>

        <h2>9. Crianças e adolescentes</h2>
        <p>A conta deve ser criada por maiores de 18 anos. O horário de menores é marcado pelo responsável, na conta dele.</p>

        <h2>10. Mudanças nesta política</h2>
        <p>Se esta política mudar, o app avisa e pede o seu aceite de novo antes do próximo agendamento.</p>
      </section>
      <p className="small muted">
        Veja também os <Link to="/termos">Termos de uso</Link>.
      </p>
    </article>
  );
}

export function TermsPage() {
  const { shop, name, whatsapp } = useContact();
  const cancel = shop ? (shop.cancel_limit_minutes === 0 ? 'até a hora do horário' : `até ${relativeLimit(shop.cancel_limit_minutes)} antes`) : null;
  const active = shop?.max_active_per_client;
  return (
    <article className="stack lg legal">
      <div>
        <h1 className="page-title">Termos de uso</h1>
        <p className="page-sub">{versionLabel()}</p>
      </div>

      <section className="card card-pad stack">
        <h2>1. O que é o app</h2>
        <p>
          É o app de agendamento da {name}: você escolhe o barbeiro, os serviços, o dia e o horário, e acompanha seus horários. Usar o app é
          gratuito. O pagamento do atendimento é feito direto na barbearia.
        </p>

        <h2>2. Sua conta</h2>
        <ul>
          <li>Use seus dados verdadeiros e um WhatsApp que seja seu: é por ele que a barbearia fala com você.</li>
          <li>A senha é pessoal. Se desconfiar que alguém usou sua conta, troque a senha e use Encerrar as outras sessões no Perfil.</li>
          <li>A conta deve ser criada por maiores de 18 anos.</li>
        </ul>

        <h2>3. Agendamentos</h2>
        <ul>
          <li>O horário fica reservado quando o app mostra a confirmação.</li>
          {active ? <li>Cada conta pode ter até {active === 1 ? '1 horário marcado' : `${active} horários marcados`} ao mesmo tempo.</li> : null}
          <li>
            Dá para cancelar pelo app {cancel ?? 'dentro do prazo mostrado no horário'}. Depois disso, fale com a barbearia pelo {whatsapp}.
          </li>
          <li>Os preços e as durações mostrados no app são os da barbearia no momento do agendamento.</li>
          <li>
            A barbearia pode remarcar ou cancelar um horário quando precisar (por exemplo, se o barbeiro faltar) e avisa você pelo WhatsApp.
          </li>
        </ul>

        <h2>4. Uso correto</h2>
        <p>
          Não é permitido tentar acessar dados de outras pessoas, burlar os limites de agendamento, usar robôs ou atrapalhar o
          funcionamento do app. Em caso de abuso (por exemplo, muitas reservas sem comparecer), a barbearia pode recusar novos agendamentos.
        </p>

        <h2>5. Avaliações</h2>
        <p>Avalie com sinceridade e sem ofensas. A barbearia pode remover avaliações ofensivas.</p>

        <h2>6. Disponibilidade</h2>
        <p>
          O app pode ficar fora do ar em manutenções ou falhas de internet e de fornecedores. Na dúvida sobre um horário, confirme pelo
          WhatsApp da barbearia.
        </p>

        <h2>7. Privacidade</h2>
        <p>
          O uso dos seus dados está explicado na <Link to="/privacidade">Política de privacidade</Link>. Você pode baixar seus dados e
          excluir a conta a qualquer momento no Perfil.
        </p>

        <h2>8. Mudanças e contato</h2>
        <p>
          Se estes termos mudarem, o app avisa e pede o seu aceite de novo. Dúvidas: {whatsapp}. Vale a lei brasileira, inclusive o Código
          de Defesa do Consumidor.
        </p>
      </section>
    </article>
  );
}
