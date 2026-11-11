# Easy Cut · Agenda

App de agendamento da Easy Cut Studio & Barber Shop.

- **Cliente** (celular): escolhe o barbeiro (ou "Sem preferência"), os serviços, o dia e o horário livre, cria a conta e confirma. Depois vê os horários em "Meus horários", cancela dentro do prazo e avalia o atendimento. No Perfil baixa os próprios dados, encerra sessões em outros aparelhos e exclui a conta.
- **Equipe** (painel em `#/admin`): agenda do dia em grade ou lista, encaixe de cliente do balcão, bloqueio de horários (almoço, folga, férias), remarcar, marcar como concluído ou "não veio", clientes com histórico e planilha, serviços, barbeiros, horários de funcionamento, avaliações e ajustes (link e QR code para divulgar, WhatsApp, regras de agendamento, equipe e histórico de ações).
- Dois clientes nunca ficam com o mesmo horário: o próprio banco recusa, mesmo se os dois tocarem em "Confirmar" no mesmo segundo.
- Instala na tela inicial do celular e abre mesmo com sinal fraco.

Feito com React + Vite (site estático no GitHub Pages) e Supabase (banco, login e regras de acesso).

## Segurança, em resumo

Quem decide o que cada pessoa pode ver e fazer é o banco, não a tela. Mesmo alguém que mexa no código do site no próprio navegador só recebe o que o seu papel permite.

- **Painel com verificação em duas etapas.** Toda a equipe cadastra um app autenticador (Google Authenticator, Microsoft Authenticator, 1Password, Authy...). Sem o código de 6 dígitos o banco não libera nenhum dado do painel, mesmo com a senha certa.
- **Primeiro dono só com código.** O painel sem dono só é assumido por quem tem o código gerado no Supabase (veja abaixo).
- **Papéis com o mínimo de acesso:** dono, gerente, recepção e barbeiro. O barbeiro vê só a própria agenda.
- **Sair de todos os aparelhos corta o acesso na hora**, sem esperar o login vencer.
- **Histórico das ações da equipe** que ninguém consegue apagar ou editar (só o dono lê). Telefone de cliente não fica no histórico.
- **Limites contra abuso:** até 6 agendamentos pelo app por conta em 24 horas, limite de horários marcados ao mesmo tempo, senha com 8 caracteres ou mais, letras e números.
- **Site:** política de segurança de conteúdo (CSP) que bloqueia scripts de fora, não abre dentro de outro site, não envia o endereço da página para outros sites.
- **LGPD:** rascunhos de Política de privacidade (`#/privacidade`) e Termos de uso (`#/termos`), aceite no cadastro, baixar os próprios dados e excluir a conta. **Os textos são rascunhos: um advogado precisa revisar antes do lançamento.**

---

## Colocar no ar (uma vez)

### 1. Banco de dados no Supabase (grátis)

1. Em [supabase.com/dashboard](https://supabase.com/dashboard) crie um projeto (New project). Região: São Paulo.
2. **SQL Editor** → rode os arquivos de `supabase/migrations/` **na ordem do nome**, um de cada vez (cole o arquivo inteiro → **Run**):
   1. `20261110000000_easycut.sql` (tabelas e agenda)
   2. `20261111000000_seguranca.sql` (papéis, verificação em duas etapas, histórico, LGPD)
3. **Authentication → Sign In / Providers → Email**: veja a seção [Ajustes de segurança no Supabase](#ajustes-de-segurança-no-supabase) (confirmação de e-mail, senha forte).
4. **Authentication → URL Configuration**:
   - Site URL: `https://enio-123.github.io/Barber-app/`
   - Redirect URLs: adicione `https://enio-123.github.io/Barber-app/**`

   Sem isso o link de "Esqueceu a senha?" abre no endereço errado.
5. Pegue a **URL do projeto** e a **chave publishable** (começa com `sb_publishable_`; projetos antigos mostram a "anon key", que também serve). As duas são públicas por natureza e vão dentro do app. **Nunca** coloque no app a secret key nem a service_role.

### 2. Ligar o app ao banco

Edite o arquivo `.env.production` na raiz:

```
VITE_SUPABASE_URL=https://SEU-PROJETO.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_...
```

### 3. Publicar no GitHub Pages

1. No repositório: **Settings → Pages → Source: GitHub Actions**.
2. Todo push na `main` passa pelos testes e, se todos passarem, publica sozinho (`.github/workflows/deploy.yml`). Leva uns 5 minutos. Se algum teste falhar, nada é publicado e o site continua na versão anterior.
3. Endereço: `https://enio-123.github.io/Barber-app/`

### 4. Primeiro acesso ao painel (dono)

1. No Supabase, **SQL Editor** → rode:

   ```sql
   select private.new_owner_code();
   ```

   Aparece um código como `ABCDE-23456`. Ele só aparece essa vez (o banco guarda só uma versão cifrada). Rodar de novo gera outro e o anterior para de valer.
2. Abra o app, crie a sua conta e entre em `https://enio-123.github.io/Barber-app/#/admin`.
3. Digite o código em **Código de primeiro acesso**. Depois de 10 códigos errados ele trava: gere outro no passo 1.
4. Cadastre o app autenticador: escaneie o QR code (ou toque em "Não consegue escanear?" e digite a chave no app) e digite os 6 dígitos que o app mostrar.
5. Pronto. Daqui em diante, cada vez que entrar no painel o app pede a senha e o código de 6 dígitos.

Assim que existe um dono, o código não serve para mais nada.

O painel mostra 4 passos para deixar a agenda pronta: serviços, barbeiros, horários e WhatsApp com endereço.

### 5. Liberar a equipe

1. A pessoa cria a conta no app (Perfil → Criar conta).
2. O dono, em **Ajustes → Equipe com acesso ao painel**, digita o e-mail dela e escolhe o papel. Para barbeiro, escolhe também qual barbeiro da lista é ele.
3. No primeiro acesso ao painel a pessoa cadastra o app autenticador dela.

**Confira com a pessoa, ao vivo, que a conta é dela antes de liberar** (o nome aparece na lista). Enquanto a confirmação de e-mail estiver desligada, qualquer um consegue criar uma conta com o e-mail de outra pessoa.

| Papel | O que pode |
| --- | --- |
| Dono | Tudo, inclusive a equipe, zerar a verificação de alguém e o histórico de ações. |
| Gerente | Agenda de todos, clientes (com planilha), serviços, barbeiros, horários, avaliações e ajustes. Não mexe na equipe. |
| Recepção | Agenda de todos os barbeiros e lista de clientes. Não mexe em preços, horários nem ajustes, não baixa planilha. |
| Barbeiro | Só a própria agenda (encaixe, bloqueio, remarcar e concluir os próprios horários) e as próprias avaliações. |

Tirar o acesso (ícone de pessoa com menos) ou mudar o papel vale na hora, inclusive em celulares que já estavam no painel. O último dono não pode ser removido.

### Perdeu o celular do app autenticador?

- **Alguém da equipe:** o dono abre **Ajustes → Equipe**, toca na chave ao lado da pessoa (Zerar a verificação). A pessoa sai de todos os aparelhos e cadastra o autenticador de novo no próximo acesso.
- **O único dono:** no Supabase, **SQL Editor**, troque o e-mail e rode:

  ```sql
  delete from auth.mfa_factors where user_id = (select id from auth.users where email = 'email-do-dono@exemplo.com');
  delete from auth.sessions where user_id = (select id from auth.users where email = 'email-do-dono@exemplo.com');
  ```

  Depois entre no painel e cadastre o autenticador de novo. Para não depender disso, tenha um segundo dono ou guarde a chave do autenticador (o texto que aparece em "Não consegue escanear?") num lugar seguro.

---

## Ajustes de segurança no Supabase

Estes ficam no painel do Supabase e não dá para fazer pelo código. Os nomes podem mudar um pouco com o tempo.

**Faça agora:**

- **Senha forte** em **Authentication → Sign In / Providers → Email**: tamanho mínimo **8** e exigência de **letras e números** (ou mais forte). O app já confere isso, mas a regra que vale de verdade é a do Supabase.
- **Exigir a senha atual para trocar de senha** (opção "Require current password" ou "Secure password change", na mesma tela). O app já pede a senha atual.
- **Verificação em duas etapas (MFA) → App Authenticator (TOTP)** em **Authentication → Multi-Factor**: deixe ligada (é o padrão). Sem ela ninguém da equipe entra no painel.
- **Data API → Exposed schemas** em **Project Settings → Data API** (ou API): deixe só `public` (e o `graphql_public` padrão). **Nunca** adicione o `private`: é ali que ficam o histórico e o código do dono.
- **Forçar SSL** em **Database → Settings → SSL Configuration → Enforce SSL on incoming connections**. O site já usa só HTTPS; isso protege conexões diretas ao banco. Ao ligar, o banco reinicia em alguns segundos.
- **Verificação em duas etapas nas suas contas** do Supabase (Account → Security) e do GitHub. Quem entra nelas controla tudo.
- **Limites de tentativas** em **Authentication → Rate Limits**: deixe os padrões (ou menores). Eles já barram robôs tentando senhas.

**Antes do lançamento:**

- **E-mail próprio (SMTP).** O e-mail padrão do Supabase só entrega para quem é da equipe do projeto e no máximo 2 por hora, então o "Esqueceu a senha?" não chega para os clientes. Configure um SMTP (Brevo, Resend ou outro) em **Authentication → Emails → SMTP Settings**. Os textos dos e-mails podem ser traduzidos em **Authentication → Emails → Templates**.
- **Ligar de novo a confirmação de e-mail** (**Confirm email**, em Sign In / Providers → Email) depois do SMTP. Hoje ela está desligada para o cliente criar a conta e já agendar, mas assim ninguém prova que o e-mail é seu.
- **Backup.** No plano grátis o Supabase não faz backup automático (só Pro, Team e Enterprise). Faça um por semana com a [Supabase CLI](https://supabase.com/docs/guides/cli): `supabase db dump --db-url "<connection string>" -f banco.sql` e `supabase db dump --db-url "<connection string>" --data-only -f dados.sql`. Guarde os arquivos fora do computador (eles têm dados de clientes).
- **Senhas vazadas** (Leaked password protection): recusa senhas que já vazaram na internet. Só existe no plano Pro.
- **CAPTCHA** (Authentication → Attack Protection): só ligue junto com a mudança no app que mostra o CAPTCHA. Ligar sozinho trava o login e o cadastro.

### Desfazer a blindagem

`supabase/rollback/20261111000000_seguranca_rollback.sql` volta as regras e funções para como eram antes de `20261111000000_seguranca.sql`. Rode no SQL Editor. Não apaga dados: o histórico, o código do dono e as colunas novas continuam guardados. Dono e gerente voltam a ser "admin"; recepção e barbeiro voltam a ser cliente.

---

## Antes de lançar para os clientes de verdade

- **Aprovação da Easy Cut.** O app usa o nome e a marca da barbearia.
- **Revisão jurídica** da Política de privacidade e dos Termos (`src/client/LegalPages.tsx`). Ao mudar o texto, troque a data em `src/lib/legal.ts` (`TERMS_VERSION`): todo cliente aceita de novo antes do próximo agendamento.
- **Dados reais** no painel: serviços com preço e duração, barbeiros com foto, horários, WhatsApp, Instagram, endereço e link do Maps.
- Os itens de **Antes do lançamento** da seção de ajustes acima.
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
- Para entrar no painel local: crie uma conta e gere o código com `docker exec -e PGPASSWORD=postgres ec-db psql -h 127.0.0.1 -U postgres -tAc "select private.new_owner_code();"`.
- Os e-mails do teste (troca de senha) aparecem em http://127.0.0.1:54324.
- `dev/stack.sh reset` apaga tudo e começa do zero. `dev/stack.sh down` desliga.
- `dev/local.env` tem as chaves de demonstração públicas do Supabase. Só funcionam nesse banco local.

### Testes

```bash
npm run test:db    # 45 testes das regras do banco
npm run test:e2e   # 21 passos num navegador de verdade
```

- **Banco:** horário duplicado, senha fraca, código do dono (errado, travado, duas pessoas ao mesmo tempo), painel recusado sem a verificação em duas etapas, o que cada papel pode e não pode, ninguém escreve direto nas tabelas, histórico, sair de todos os aparelhos cortando o acesso, token falsificado recusado, baixar dados e excluir conta.
- **Navegador:** cliente agenda e cancela, dono assume o painel com o código e o autenticador, usa o painel no computador e no celular, barbeiro vê só a própria agenda, cliente baixa os dados e exclui a conta, o site não abre dentro de outro site e a política de segurança bloqueia script injetado.
- O teste no navegador usa o Playwright e salva prints de cada tela em `e2e-prints/` (ou na pasta passada como argumento). Para testar a versão de produção, com a política de segurança (CSP), veja o começo de `tests/e2e.mjs`.
- No GitHub, todo push roda os tipos (TypeScript), a checagem de bibliotecas com falha conhecida (`npm audit`) e os 45 testes do banco. Só a `main` publica, e só se tudo passar. O Dependabot abre um pull request por semana quando sai correção para alguma biblioteca.

---

## Onde fica cada coisa

| Pasta | O que tem |
| --- | --- |
| `supabase/migrations/` | Banco inteiro: tabelas, regras de acesso e funções (rodar na ordem) |
| `supabase/rollback/` | Como desfazer a blindagem de segurança |
| `src/client/` | Telas do cliente, Política de privacidade e Termos |
| `src/admin/` | Painel da equipe (baixado só por quem abre o painel) |
| `src/state/` | Login, dados da barbearia e avisos na tela |
| `src/lib/` | Conexão com o Supabase, papéis, senha, datas, fuso e mensagens de erro |
| `public/` | Ícones, manifesto e service worker (instalar no celular) |
| `tests/` | Testes do banco e do navegador |
| `dev/` | Supabase local para desenvolvimento |
| `tools/` | Gerador da estampa camuflada (`camuflado.py`) e dos ícones do app (`icones.mjs`) |
