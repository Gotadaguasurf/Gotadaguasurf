# Shared Gmail backend — setup (one-time, admin only)

Turns the CRM from "each user connects their own Gmail in the browser" into
**one shared mailbox** (`groups@gotadaguasurf.com`) authenticated ONCE
server-side, with display-name-per-sender on every outbound. Token never
leaves the server. Auto-refresh runs even with the CRM tab closed.

You do this **once**. Tu (admin) precisas:
- Acesso ao Google Cloud Console (a mesma conta que já criou o OAuth client)
- Acesso ao Supabase dashboard do projeto
- Supabase CLI instalado localmente (`brew install supabase/tap/supabase`)

## 1. Google Cloud — adicionar o redirect URI server-side

Vais a https://console.cloud.google.com → **APIs & Services → Credentials**
e abres o teu OAuth Client ID existente (Web application).

Em **Authorized redirect URIs**, click **+ Add URI** e cola:

```
https://<TEU-PROJETO>.supabase.co/functions/v1/gmail-oauth/callback
```

Substitui `<TEU-PROJETO>` pelo subdomínio do teu projeto Supabase (vê em
Supabase → Project Settings → API → Project URL — algo tipo
`https://xxxxxxxxxxxx.supabase.co`).

Save.

> **Important**: also need a **Client Secret**. Se nunca o copiaste antes,
> abre o mesmo OAuth client → secção **Client secrets** → **+ Create new
> secret** (se não existir). Copia o valor — vais precisar dele já a
> seguir e não consegues vê-lo de novo.

## 2. Supabase — guardar os secrets

No terminal, no diretório do repo:

```bash
cd ~/Documents/GitHub/gotadagua-deploy-clean

supabase login          # uma vez por máquina
supabase link --project-ref <PROJECT-REF>   # vê em Project Settings → General

supabase secrets set \
  GOOGLE_OAUTH_CLIENT_ID="186665395783-83sd7vhbbub8b9h6m4pfu2pml69dqf4k.apps.googleusercontent.com" \
  GOOGLE_OAUTH_CLIENT_SECRET="<COLA O SECRET AQUI>" \
  SHARED_GMAIL_ADDRESS="groups@gotadaguasurf.com"
```

## 3. Correr a migration SQL

No Supabase SQL Editor, cola e corre o conteúdo de
`supabase/crm-shared-gmail-schema.sql`. Cria a tabela `gmail_account` (com
RLS service-role-only) e adiciona `email_messages.sender_user_id`.

## 4. Deploy das Edge Functions

```bash
supabase functions deploy gmail-oauth
supabase functions deploy gmail-send
```

Cada deploy dura ~30 segundos. No fim a Supabase mostra o URL final
(`https://<projeto>.supabase.co/functions/v1/gmail-oauth` e
`.../gmail-send`).

## 5. Ligar o `groups@` UMA vez

Abre **no browser, logado na conta `groups@gotadaguasurf.com`** (é
mesmo importante ser ESSA conta no popup):

```
https://<TEU-PROJETO>.supabase.co/functions/v1/gmail-oauth/start
```

Vais para o consent screen do Google. Escolhe a conta `groups@…`,
aceita os scopes (Read + Send). Sucesso → vais ver uma página
"✓ Shared Gmail connected".

Se o popup diz **"This app isn't verified"** → clica **Advanced → Go to
Gota CRM (unsafe)**. Em Workspace podes tornar a app "Internal" para
não veres mais este aviso.

## 6. (Próximo turno) — Client refactor

Depois disto deployed e ligado, no próximo turno eu:
- Remove o per-user OAuth no Settings
- Refactor Compose / Send now / Batch send para chamar a Edge Function
  `gmail-send` em vez de bater no Gmail API directamente
- Add a "Shared Gmail: connected as groups@" status no Settings (read-only,
  só admin liga)

E no turno depois:
- Edge Function `gmail-sync` (puxa inbound da inbox `groups@` via polling)
- Cron job (supabase functions schedule) para correr cada 2-5 min
- Remove o "Sync inbox" button manual (passa a ser server-side)

## Troubleshooting

**"No refresh token returned"** → o Google só emite refresh_token na PRIMEIRA
consent por client+account. Vai a https://myaccount.google.com/permissions
(logado em `groups@…`), remove a CRM, depois tenta a /start outra vez.

**"Wrong account"** → o `SHARED_GMAIL_ADDRESS` secret tem de bater certo com
a conta que consentes. Se mudaste, refaz o secret + re-run /start.

**"Token exchange failed"** → 99% das vezes é o redirect URI no Google Cloud
não bater certo com o que a função usa. Confirma o URI exacto na consola.

**"DB upsert failed: permission denied"** → o `SUPABASE_SERVICE_ROLE_KEY` não
está disponível à função. Edge Functions têm-no por default; se mudaste
algo, re-deploy: `supabase functions deploy gmail-oauth`.

## Sobre o display name no From

Cada outbound vai com `From: "Miguel Pereira" <groups@gotadaguasurf.com>`
(ou Ricardo, ou quem clicou Send). Não há aliases Workspace nem mailbox
delegation — tecnicamente é tudo a mesma conta, apenas o **display name**
muda por sender. Replies caem na inbox `groups@` (Reply-To explícito), e
o `email_messages.sender_user_id` guarda quem clicou Send para o audit
trail.
