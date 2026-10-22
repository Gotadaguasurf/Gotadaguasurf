# Proposta: a app com menos tabs e um só número para cada coisa

Data: 22 Out 2026. Pedido do Miguel: «tens mesmo a certeza que não tenho tabs desnecessárias? … quero a info necessária sem tabs com basicamente o mesmo … olha para a app como a melhor de contabilidade e gestão de uma empresa, que facilite a vida e seja simples».

Base: inventário tab a tab de todas as páginas (o que cada uma mostra, de onde vêm os números, que ações tem), cruzado com os dados ao vivo.

## A regra que falta: cada número calcula-se uma vez

O problema não é só haver tabs a mais. É que o mesmo número é calculado em vários sítios, de maneiras diferentes, e por isso nem sempre bate:

| Número | Onde aparece | Calculado igual? |
|---|---|---|
| Lucro por location | HQ Overview, HQ P&L Report, gaveta de detalhe, camp hub Overview, digest semanal | **Não.** Quatro regras diferentes para decidir a que location pertence uma linha do ledger; a gaveta conta as faturas do HQ duas vezes; o digest usa valor bruto por data de check-in e inclui apagadas, pessoais e Manjar |
| Receita de reservas (bruto, líquido, direto) | Partners (2 tabs), HQ Overview, HQ P&L, HQ Cash flow, hub «Manage» | **Não.** Partners põe comissão 0 nas reservas não realizadas; o HQ usa o `net_amount` guardado sem filtro de estado |
| Total de faturas do HQ | Overview, Expenses, P&L, Cash flow, gaveta, Month close, Excel, página do contabilista | **Não.** Duplicados contam em uns e não noutros; **Cash flow conta faturas apagadas** |
| «Sem fatura» | Month close, Excel (2 sítios), página do contabilista, Suk, hq_todo | **Cinco regras.** O botão ∅ do Month close só escreve uma nota, por isso o contabilista continua a ver a linha em falta |
| Caixa de um camp | camp hub Overview, Operations Ledger, Weekly P&L | Weekly P&L conta levantamentos e depósitos como entradas |
| Comissões «tratadas» | Partners (estado Paid), Hoje (existe fatura), ledger de adiantamentos (banco) | Três noções de «feito» que não se lêem umas às outras |
| Aberto na escola | Surf School «Open», camp hub Overview | O camp hub filtra «aberto» pelo mês, por isso está errado |

**Proposta:** uma camada única no servidor (`hq_overview_rollup` alargada + uma função `hq_missing_docs`) com as regras escritas uma vez (location = attributed_location → paid_from → location da linha; excluir apagadas, duplicadas, pessoais e Manjar; reservas realizadas = estado pago/confirmado/sinal). Todas as páginas, o Excel, o contabilista, o digest e o «Hoje» lêem daí. Nenhuma página volta a somar à mão.

## Estrutura proposta, app a app

Legenda: **mantém** · *funde-se em* · ~~sai~~ (a informação vai para onde se diz).

### Hub (/)
- **Hoje** · **Cartões das apps** · **Settings → Team access** — mantêm.
- ~~número "Contacts 628" fixo no cartão do CRM~~ → lê a contagem real ou não mostra número.
- ~~Import CSV do Bookinglayer no hub~~ → vai para o HQ (é finança, e o HQ já tem a janela de importações).

### HQ (Water Movements) — de 6 tabs + 4 janelas para 5 tabs
| Hoje | Proposta |
|---|---|
| Overview | **Overview**: lucro, «precisa de atenção» (lido do `hq_todo`, o mesmo do hub), receita e despesa, tabela por location com detalhe. Ganha um botão «por mês» que mostra a grelha mês × location e exporta CSV. |
| P&L Report | ~~sai~~ → é a tabela do Overview virada ao contrário; a grelha mês × location e o CSV passam para o Overview. |
| Expenses | **Expenses** (uma só entrada «📦 Contabilista», hoje está duas vezes). |
| Month close | **Month close** (mantém; a lista «All expenses of the month» passa a ser um link para Expenses filtrado pelo mês; a janela «Contabilista» deixa de repetir os dois botões que já aqui estão). |
| Cash flow | **Cash flow** (corrigido: não conta apagadas; o chip de inter-empresas usa a mesma conta). ~~formulário «Log manual revenue»~~ (era da Wild antes de existir /wild/). |
| Investments | **Investments** (mantém). |
| janela «Import CSV» (Excel antigo) | ~~sai~~ (carregador único de 2025). |
| — | **Reservas** (novo, dentro de Overview ou como janela): importação do CSV do Bookinglayer que hoje está no hub. |

### Camp hub (por camp) — de 5 tabs para 4
| Hoje | Proposta |
|---|---|
| Overview | **Overview** (mantém; cartões de área, Balance/Bank/Cash por período). |
| Camp Tab | **Camp Tab** (mantém). |
| Operations Ledger | **Ledger** (mantém). Ganha o filtro «incluir faturas do HQ» e as tabelas por mês e por categoria que hoje estão em All Expenses, **sem contar duas vezes** (as faturas do HQ já estão espelhadas no ledger). |
| All Expenses | ~~sai~~ → conta as faturas do HQ duas vezes; a informação fica no Ledger. |
| Weekly P&L | **Weekly P&L** (mantém; corrigir: linhas falsas de Mar–Abr escritas na página, cabeçalho com 11 colunas para linhas de 12, levantamentos/depósitos contados como entradas). |
| escondidos | ~~painéis ocultos, POS antigo, categorias antigas nas janelas~~ → limpar. |

### The Suk — de 5 tabs para 3
| Hoje | Proposta |
|---|---|
| Overview | **Overview** (mantém; os cartões «linhas sem PDF» e «por fornecedor» ficam aqui). |
| Expenses | **Expenses** com o filtro «Sem PDF» e as ações Anexar / Sem fatura. |
| Missing PDFs | ~~sai~~ → é a lista de Expenses filtrada; o resumo por fornecedor vai para o Overview. |
| Bank | **Bank** (mantém; o filtro «débitos sem fatura» passa a usar a mesma função SQL do HQ, em vez do cálculo próprio) + secção **Water ↔ Manjar**. |
| Water ↔ Manjar | *funde-se em* Bank. |

### Wild Wednesday — de 3 tabs para 2
- **Overview** (época, rubrica × mês, noites com Editar) · **Close night** (formulário, noites, comissões).
- ~~Ledger~~ → linhas em bruto; o que o Max precisa (editar uma noite, apagar uma comissão) já está nas outras duas.

### Partners — de 3 tabs para 1
| Hoje | Proposta |
|---|---|
| Partners | **Partners**: quem deve a quem, estado do mês, faturas, adiantamentos, extratos. É o único sítio da app com este trabalho. |
| Direct Booking Engine | ~~sai~~ → números fixos de Jan–Mar escritos no HTML; o HQ Overview já tem direct bookings por mês. |
| Overview & Charts | ~~sai~~ → a mesma faixa de KPIs da tab Partners + gráficos que o HQ Overview cobre. |
| faixa de KPIs (bruto, líquido, direto, total) | ~~sai~~ → passa a ler o rollup do HQ (uma fórmula). |
| janela «Partners & Rates» | **mantém mas corrigir**: hoje gravar as taxas **reescreve todas as reservas** (perde noites, email, valor pago, e zera comissões) — é o bug mais grave encontrado. |
| import/export sem botão, snapshot de HTML com números de Jan–Mar | ~~sai~~. |

### CRM — de 8 tabs para 7
- **Dashboard** (absorve Analytics: mesmos KPIs, os gráficos por país/segmento entram como secção) · **Inbox** · **Contacts** · **Tasks** · **Pipeline** · **Templates** · **Sequences**.
- ~~Analytics~~ → mesmas fórmulas do Dashboard. ~~janela «My Day»~~ → é o herói do Dashboard. Limpar a vista de pipeline morta.
- Continua a ser a ferramenta da equipa de vendas; não mistura com finanças.

### Surf School — mantém 6 (4 são do balcão)
- **+ New · Open · Camp · History** (balcão) · **Vendas · Clientes** (gestão).
- Corrigir: cabeçalho duplicado quando embutida no camp hub; o resumo «por pessoa» em History sai (Vendas é o certo, History só vê 500 linhas); preços passam a vir do catálogo em vez da tabela fixa no código; % de comissão passa a ser guardada na base de dados e não no browser.

### Instructors — mantém 4
- **Dashboard · Monthly payroll · Lesson entries · Instrutores**. A vista «Resumo» dentro de Lesson entries sai (é o Dashboard).

### Prices e Contabilista — mantêm
- Prices: Edit + Price List (a lista é para parceiros e PDF). A tab «Costs» é um «em breve»: ou se faz ou sai.
- Contabilista: mantém; passa a usar a regra única de «sem fatura» (fica igual ao Month close).

## Contagem
Antes: 44 tabs/vistas principais. Depois: 36. Mais importante do que as 8 a menos: cada número passa a existir uma vez.

## Bugs encontrados que se corrigem de qualquer forma
1. Partners & Rates reescreve todas as reservas ao gravar (perda de dados).
2. camp hub All Expenses e a gaveta do HQ contam as faturas do HQ duas vezes.
3. HQ Cash flow soma faturas apagadas.
4. Weekly P&L: linhas falsas, colunas desalinhadas, levantamentos como entradas.
5. Digest semanal com base diferente do HQ (bruto por check-in, inclui apagadas/pessoais/Manjar).
6. Month close «∅ sem fatura» não chega ao contabilista.
7. camp hub «ainda abertos» (surf school) filtrado pelo mês.
8. Surf School embutida mostra dois cabeçalhos.
9. Chip «inter-co unreconciled» marca sempre pares só num sentido.
10. hub: «Contacts 628» fixo; partners: números de Jan–Mar fixos no HTML.

## Como executar (por ondas, cada uma publicada e testada)
- **A — corrigir e limpar** (1 sessão): os 10 bugs; remover P&L Report, All Expenses, Missing PDFs, Wild Ledger, Partners Direct + Overview, CRM Analytics + My Day, botões duplicados, código morto. Nenhuma informação se perde: cada remoção leva a sua parte para a tab que fica.
- **B — um número, uma fórmula** (1 sessão): rollup único no servidor + `hq_missing_docs`; HQ, Partners, Suk, contabilista, Excel, digest e «Hoje» a ler daí; decisão do Miguel sobre reservas realizadas vs todas.
- **C — fundir** (1 sessão): Import CSV para o HQ; Ledger do camp hub com faturas do HQ; Suk Bank + Water↔Manjar; Surf School com preços do catálogo e comissão na base de dados.

Decisões para o Miguel antes da onda B:
1. Receita de reservas: contar só as realizadas (pago/confirmado/sinal), como o Partners faz, ou todas, como o HQ faz hoje? (Proposta: só realizadas, em todo o lado.)
2. Weekly P&L: fica como tabela própria ou passa a ser a vista «semana» do Overview do camp hub? (Proposta: fica, corrigida — é a tabela que os managers usam.)
3. Wild Ledger: sai mesmo? (Proposta: sim.)
