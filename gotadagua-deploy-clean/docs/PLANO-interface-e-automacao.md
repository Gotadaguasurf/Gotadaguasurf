# Plano: interface única + automação do dia a dia

Data: 22 Out 2026. Pedido do Miguel: «uma grande interface, simples e intuitiva… tudo o mais automatizado possível… melhorar o workflow das minhas tarefas diárias e a organização da app».

Resultado da pesquisa (três auditorias: rotina diária, estrutura da app, fontes de entrada de dados) e o plano por ondas. Cada onda é publicada e testada em separado.

## O que a pesquisa encontrou

### Interface (o que o Miguel nota)
- 4 sistemas de cabeçalho diferentes (hub, HQ/CRM/Partners, camp hub, surf school, instructors), 7 tipos de modal, 6 de botões, 6 de toasts.
- Menus de apps diferentes em cada página: 8 links no hub, 7 no HQ/camp hub/prices/partners/CRM, 4 no Wild/Suk, nenhum na Surf School e nos Instructors. O Suk e os Instructors não aparecem em menu nenhum. Junior Camp falta no seletor de localização do camp hub.
- Só o hub e o CRM têm «Sair». Três ecrãs de login diferentes (hub, CRM, partners com password própria).
- Fundos (#f0f5fa, #f3f7fb, #f5f5f3), larguras (640 a 1400 px), tamanhos de KPI (22 a 30 px) e cabeçalhos de tabela diferentes por página.
- Partners e Prices ainda usam `alert()`/`prompt()` (≈47 vezes); Instructors não tem feedback nenhum.
- Os menus pendentes do Wild e do Suk estavam estragados pela regra `nav{}` global do business-shell.css.

### Rotina diária (o que consome tempo)
- A rotina «faturas-diario» corre à mão desde 13 Out. Quase todo o trabalho manual é apanhar PDFs em 5 caixas de correio e no Downloads via Chrome, dar nome e arquivar na Drive. A parte de base de dados (extrato → ligar ou criar linhas) já é automática desde 22 Out.
- A CGD não tem importador (carregada por SQL). O Santander e o BCP têm.
- Linhas mensais em dinheiro (renda do escritório, surf school, João Girbal, Maxime) verificadas à mão todos os meses.

### Infra (o que está partido)
- `drive-sync` (ingestão automática da Drive, 4×/dia) nunca funcionou: o cron tem o segredo de exemplo «COLOCA_AQUI_O_SEGREDO» → 401 em todas as 195 execuções. Além disso usa a lista antiga de categorias e marca tudo como needs_review.
- `run-sri-lanka-month-end` idem («COLE_AQUI_O_TEU_SECRET»).
- Dois crons iguais do gmail-sync (5 e 10 min).
- O backup diário não inclui `hq_invoices` nem `hq_bank_movements`.
- O token Gmail do servidor só lê groups@ (CRM). Não há leitura de accounting@/cafe@/ricardo@/miguel@ no servidor, nem leitura de anexos.

## Ondas

### Onda 1 — interface única (feito nesta sessão)
- `lib/app-shell.css` + `lib/app-shell.js`: um só cabeçalho (logo, pill da app, pill da localização, tabs, chip do utilizador, Sair), um só registo de apps (Overview, HQ, Camp hub, Prices, Surf School, Partners, CRM, Instructors, Businesses: Wild, The Suk), tokens, cartões, KPIs, tabelas, botões, badges, modal, toast, campos de formulário, splash.
- Todas as páginas passam a usar o mesmo cabeçalho e o mesmo menu. Junior Camp entra no seletor do camp hub.
- `business-shell.css/.js` ficam como alias.
- Infra: tabelas de faturas e extratos no backup diário; cron duplicado do gmail-sync removido; crons com segredo de exemplo desativados até serem refeitos.

### Onda 2 — «Hoje»: um só sítio com o que falta fazer (feito 22 Out, exceto CGD)
- `hq_todo()` (supabase/hq-todo.sql): uma função devolve as pendências reais: linhas sem categoria (Water e Suk), duplicados, débitos sem linha por banco, linhas sem PDF desde Setembro, «[pending HQ invoice]» do Wild, linhas mensais por criar, idade de cada extrato, faturas a parceiros por emitir (reservas com comissão e mês fechado sem fatura; Juvigo, Ocean Adventure e os que pagam direto ficam fora), fecho do mês anterior.
- Painel «Hoje» no topo do hub, só para quem abre o HQ: um cartão por pendência, cada um abre a tab certa já filtrada (`/hq/?tab=fecho`, `/hq/?tab=invoices&filter=review`, `/suk/#missing`, `/wild/#ledger`, `/partners/`).
- Linhas mensais em dinheiro (renda do escritório 1.300 dia 1, renda da escola 400 dia 1, João Girbal +200 dia 28, Maxime +50 dia 28) são templates em `hq_recurring_expenses`; `hq_recurring_run()` corre todos os dias às 06:10 UTC (cron `hq-recurring-daily`) e cria a linha do mês uma única vez. Setembro e Outubro da renda da escola, que faltavam, foram criados.
- Quando uma fatura «Wild · …» entra no HQ, a linha «[pending HQ invoice]» da Wild com o mesmo valor (±14 dias) é removida automaticamente (trigger `tr_wild_pending_cleanup`).
- **Por fazer:** importador CGD no HQ — preciso de um export da CGD (CSV/Excel do homebanking) para escrever o parser; até lá a CGD carrega-se por SQL.

### Onda 3 — entrada automática de faturas (código feito 22 Out; falta o deploy e os consentimentos)
Estado: `supabase/functions/mail-ingest` escrita e no repositório; SQL aplicado (tabelas `mail_ingest_account`, `mail_ingest_items`, função `hq_invoice_to_bank`, cron `mail-ingest-30min` de 30 em 30 min das 7 às 22 UTC); segredo `MAIL_INGEST_SECRET` definido. **Falta (só o Miguel pode):** (1) `supabase functions deploy mail-ingest --no-verify-jwt` (o assistente não tem permissão para esta flag); (2) no Google Cloud Console, juntar `https://wnksmcjqnbxaagyhfxlt.supabase.co/functions/v1/mail-ingest` aos «Authorized redirect URIs» do cliente OAuth; (3) abrir o link de consentimento uma vez por caixa (accounting@, cafe@, miguel@, info@, ricardo.gasurfcamp@) com sessão nessa caixa. Depois, as faturas entram sozinhas; o que a app não percebe fica «por decidir» no Month close (botões Water / Manjar / Ignorar).

Desenho original:
- Função `mail-ingest`: lê accounting@ (e cafe@, ricardo@, miguel@) só em leitura, guarda os PDFs, chama o parse (com NIF do comprador, ATCUD, «anulado»), encaminha por NIF (Water → app + Drive; Manjar → /suk/ + Drive do Manjar; pessoal → ignora), arquiva na pasta do mês e cria/liga a linha. Nunca responde nem envia.
- `hq_invoice_to_bank`: ao entrar uma fatura, procura o débito no extrato (valor ±0,01, ±20 dias, fornecedor) e liga. Contrário do `hq_bank_to_expenses`.
- `drive-sync` refeito para as pastas do mês (renomear + ligar/criar), com a lista de categorias atual, e ligado com o segredo certo.
- Tabela de aliases de fornecedores (grafias, NIF → categoria/local) para os matchers serem determinísticos.

### Onda 4 — fechos e parceiros
- Vista «faturas a parceiros por emitir» com alerta, comparação da lista e-Fatura da contabilista (só relatório), limpeza automática do «[pending HQ invoice]» do Wild quando a fatura entra.

## Regras que se mantêm
Nunca enviar emails · nunca duplicar (ligar, não criar) · soft-delete apenas · Manjar fora do HQ da Water, PDFs do Manjar só na Drive do Manjar · Paid só com movimento bancário · ativos não são despesas · Pedro Barata fica em general · Jan–Ago sem PDF não é prioridade · ids de categoria, nunca nomes escritos.
