# Easy Cut · Agenda

App de agendamento da Easy Cut Studio & Barber Shop.

- **Cliente** (celular): escolhe o barbeiro (ou "Sem preferência"), os serviços, o dia e o horário livre, cria a conta e confirma. Depois vê os horários em "Meus horários", cancela dentro do prazo e avalia o atendimento.
- **Dono e equipe** (painel em `#/admin`): agenda do dia em grade ou lista, encaixe de cliente do balcão, bloqueio de horários (almoço, folga, férias), remarcar, marcar como concluído ou "não veio", clientes com histórico e planilha, serviços, barbeiros, horários de funcionamento, avaliações e ajustes (link e QR code para divulgar, WhatsApp, regras de agendamento, equipe).
- Dois clientes nunca ficam com o mesmo horário: o próprio banco recusa, mesmo se os dois tocarem em "Confirmar" no mesmo segundo.
- Instala na tela inicial do celular e abre mesmo com sinal fraco.

Feito com React + Vite (site estático no GitHub Pages) e Supabase (banco, login e regras de acesso).

---

## Colocar no ar (uma vez)

### 1. Banco de dados no Supabase (grátis)

1. Em [supabase.com/dashboard](https://supabase.com/dashboard) crie um projeto (New project). Região: São Paulo.
2. **SQL Editor** → cole o arquivo `supabase/migrations/20261110000000_easycut.sql` inteiro → **Run**.
3. **Authentication → Sign In / Providers** → desligue **Confirm email** → Save. Assim o cliente cria a conta e já agenda, sem esperar e-mail.
4. **Authentication → URL Configuration**:
   - Site URL: `https://enio-123.github.io/EasyCut/`
   - Redirect URLs: adicione `https://enio-123.github.io/EasyCut/**`

   Sem isso o link de "Esqueceu a senha?" abre no endereço errado.
5. Pegue a **URL do projeto** e a **chave publishable** (começa com `sb_publishable_`; projetos antigos mostram a "anon key", que também serve). As duas são públicas por natureza e vão dentro do app. **Nunca** use a secret key nem a service_role.

### 2. Ligar o app ao banco

Edite o arquivo `.env.production` na raiz:

```
VITE_SUPABASE_URL=https://SEU-PROJETO.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_...
```

### 3. Publicar no GitHub Pages

1. No repositório: **Settings → Pages → Source: GitHub Actions**.
2. Todo push publica sozinho (`.github/workflows/deploy.yml`). Leva uns 2 minutos.
3. Endereço: `https://enio-123.github.io/EasyCut/`

### 4. Primeiro acesso ao painel

Abra o app, crie a sua conta e entre em `https://enio-123.github.io/EasyCut/#/admin`. Enquanto o painel não tem dono aparece o botão **"Sou o dono, assumir o painel"**: a primeira conta que tocar vira dona e o botão some para sempre. Depois disso, outras pessoas da equipe só entram se um dono liberar o e-mail em **Ajustes → Equipe**.

O painel mostra 4 passos para deixar a agenda pronta: serviços, barbeiros, horários e WhatsApp com endereço.

---

## Antes de lançar para os clientes de verdade

- **Aprovação da Easy Cut.** O app usa o nome e a marca da barbearia.
- **Dados reais** no painel: serviços com preço e duração, barbeiros com foto, horários, WhatsApp, Instagram, endereço e link do Maps.
- **E-mail próprio (SMTP).** O e-mail padrão do Supabase só entrega para quem é da equipe do projeto e no máximo 2 por hora, então o "Esqueceu a senha?" não chega para os clientes. Configure um SMTP (Brevo, Resend ou outro) em **Authentication → Emails → SMTP Settings**. Os textos dos e-mails podem ser traduzidos em **Authentication → Emails → Templates**.
- **Aparecer no Google.** Hoje o app está fora das buscas de propósito. Para liberar, apague a linha `<meta name="robots" ...>` do `index.html`.

---

## Rodar no computador (para mexer no código)

Precisa de Node 20 ou mais novo e Docker.

```bash
npm install
dev/stack.sh up        # Supabase local: banco + login + API + caixa de e-mail de teste
node dev/proxy.mjs     # deixe aberto: junta tudo em http://127.0.0.1:54321
npm run dev            # app em http://127.0.0.1:5173
```

- O banco local já vem com dados de exemplo (`supabase/seed.sql`), que nunca vão para o projeto de verdade.
- Os e-mails do teste (troca de senha) aparecem em http://127.0.0.1:54324.
- `dev/stack.sh reset` apaga tudo e começa do zero. `dev/stack.sh down` desliga.
- `dev/local.env` tem as chaves de demonstração públicas do Supabase. Só funcionam nesse banco local.

### Testes

```bash
npm run test:db    # 25 testes das regras do banco (horário duplicado, permissões, cancelamento...)
npm run test:e2e   # 17 passos num navegador de verdade: cliente agenda, dono usa o painel, troca de senha
```

O teste no navegador usa o Playwright e salva prints de cada tela em `e2e-prints/` (ou na pasta passada como argumento).

---

## Onde fica cada coisa

| Pasta | O que tem |
| --- | --- |
| `supabase/migrations/` | Banco inteiro: tabelas, regras de acesso e funções |
| `src/client/` | Telas do cliente |
| `src/admin/` | Painel do dono (baixado só por quem abre o painel) |
| `src/state/` | Login, dados da barbearia e avisos na tela |
| `src/lib/` | Conexão com o Supabase, datas, fuso e mensagens de erro |
| `public/` | Ícones, manifesto e service worker (instalar no celular) |
| `tests/` | Testes do banco e do navegador |
| `dev/` | Supabase local para desenvolvimento |
