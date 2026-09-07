# Relatório de Features e Monetização — Refract v2.8.0

**Data:** 2026-09-05
**Commit analisado:** `ff50c8b` (+ PR #1)
**Objetivo:** responder a uma pergunta — *o que este projeto precisa ter, ou precisa consertar, para que alguém coloque o cartão?*

> Inventário auditado direto do código. Todo item tem o caminho do arquivo para você conferir.

---

## Parte 0 — O diagnóstico em uma frase

O Refract tem **~90% do motor técnico** de um produto de US$ 50–150/mês e **~10% do empacotamento**. O que falta não é capacidade de engenharia — é que nenhuma feature atual foi desenhada em torno de uma dor que alguém tem **orçamento** para resolver.

---

## Parte 1 — Inventário de features (auditado)

Legenda de status: ✅ produção · ⚠️ parcial/flag OFF · ❌ não existe

### Núcleo técnico

| Feature | Onde está | Status | Veredito de monetização |
|---|---|---|---|
| Captura de áudio dual-channel (Rust + NAPI, zero-copy) | `native-module/src/`, `electron/audio/` | ✅ | **Base.** Não se vende isolado, mas é o fosso. |
| STT 100% local (Moonshine/Whisper ONNX, CoreML/DirectML) | `electron/audio/LocalWhisperSTT.ts` | ✅ | **Altíssimo.** É o argumento de compliance. |
| 8 provedores de STT em nuvem | `electron/audio/*StreamingSTT.ts` | ✅ | **Negativo.** Custo de manutenção, quase zero receita. Cortar para 2–3. |
| Captura de tela + OCR | `electron/ScreenshotHelper.ts` | ✅ | Baixo. Só serve ao caso de entrevista. |
| Teclado global invisível (CGEventTap) | `native-module/src/keyboard_tap.rs` | ✅ | **Negativo.** Risco jurídico > valor. |
| Disfarce de processo / evasão de dock | `native-module/src/stealth_window.rs`, `process_name.rs` | ✅ | **Negativo.** Ver Parte 4. |
| Extensão de browser (Readability + código) | `refract-browser/` | ✅ | Médio. Bom para reuniões web. |
| Celular como microfone remoto | `electron/services/PhoneMirrorService.ts` | ✅ | **Alto** — único jeito de capturar **visita presencial**. |

### Inteligência e memória

| Feature | Onde está | Status | Veredito |
|---|---|---|---|
| 9 modos/personas + templates de nota | `electron/services/ModesManager.ts` (`general`, `negotiation`, `lecture`, `coding`, `sales`, `technical-interview`, `recruiting`, `team-meet`, `looking-for-work`) | ✅ | **Altíssimo.** Já é 80% do mecanismo de templates verticais. |
| RAG local + memória entre reuniões (`sqlite-vec`) | `electron/rag/` | ✅ | **Altíssimo.** Custo marginal zero → "memória infinita". |
| Memória de longo prazo (Hindsight) | `electron/services/HindsightManager.ts` | ⚠️ flag OFF | Baixo. Não é o que faz alguém pagar. |
| Intelligence OS (34 flags, roteador, fusão de contexto, PromptAssemblerV2) | `electron/intelligence/` | ⚠️ **todas default OFF** | **Zero hoje** — é P&D parado. |
| Diagramas / Lecture intelligence | `electron/intelligence/DiagramIntelligenceService.ts` | ⚠️ flag OFF | Baixo. |
| Perfil do candidato / conhecimento / negociação | `premium/electron/knowledge/*` | ❌ **submódulo inexistente** | Bloqueia tudo (ver Parte 3). |

### Produto / saída

| Feature | Onde está | Status | Veredito |
|---|---|---|---|
| Dashboard de reuniões + busca + detalhes | `src/components/Launcher.tsx`, `MeetingDetails.tsx` | ✅ | Médio. É esperado, não é diferencial. |
| Exportação PDF | `src/utils/pdfGenerator.ts` | ✅ | **Alto** — é o "entregável" profissional. |
| Email de follow-up gerado | `src/components/FollowUpEmailModal.tsx` | ✅ | Médio-alto. |
| Integração com calendário (Google/Outlook) | `electron/services/CalendarManager.ts` | ⚠️ parcial | **Alto** — preparação automática de consulta. |
| Codex CLI / agentes / Git | `electron/services/CodexCliService.ts`, `AgentManager.ts`, `GitService.ts` | ✅ | Baixo. Fora do foco de reunião. |
| Billing (LemonSqueezy + Dodo) | `electron/services/LemonSqueezyManager.ts`, `PurchaseActivationService.ts` | ⚠️ **quebrado** | Bloqueante (ver Parte 3). |
| Transcrição por locutor (diarização real) | — | ❌ **NÃO EXISTE** | 🔴 **Bloqueia o pivô.** Ver Parte 2. |

---

## Parte 2 — O teste da disposição a pagar

Classifiquei cada feature por **qual orçamento ela acessa**. Só três dores fazem alguém pagar sem negociar:

| Tipo de dor | Exemplo | Disposição a pagar |
|---|---|---|
| **1. Risco legal / compliance** | "Meu cliente não pode ter o áudio em nuvem" | 💰💰💰💰💰 |
| **2. Hora faturável recuperada** | "Escrever memorando não é hora bilável" | 💰💰💰💰 |
| **3. Receita gerada** | "Fecho mais deals se o CRM estiver preenchido" | 💰💰💰 |
| 4. Conveniência | "Resumo bonitinho" | 💰 |

**A matemática que vende**, para um advogado ou consultor a R$ 400/h:

- 30 min/dia escrevendo memorando × 22 dias = **11 h/mês** de hora não faturável
- 11 h × R$ 400 = **R$ 4.400/mês de receita perdida**
- Cobrar R$ 250/mês = **5,7% do valor recuperado** → venda trivial

Para um psicólogo: 25 sessões/semana × 10 min de nota = **~16 h/mês** de vida devolvida.

> **Regra prática:** se a feature não aparece na linha 1, 2 ou 3 da tabela, ela é decoração. O README atual vende conveniência e disfarce — por isso ninguém paga.

---

## Parte 3 — Os 6 gargalos que impedem alguém de pagar

### 🔴 G1. Diarização não cobre reunião presencial — e é aí que está o dinheiro

> **✅ CORRIGIDO em 2026-09-05 (commit `f04e3c3`).** O texto abaixo descreve o
> problema corretamente, mas **a minha afirmação anterior de que "não existe
> diarização" estava errada** — eu havia lido o plano e não o código. O que existe
> de verdade, verificado no fonte: `SpeakerLabelService`, `TranscriptSegment.speakerId`,
> IDs canônicos e **diarização do Deepgram já implementada** (`setDiarization` +
> `dominantSpeakerIndex`), atrás da flag `speakerDiarizationV1`. O que faltava era
> outra coisa — ver o fim desta seção.

`docs/speaker-diarization-plan.md` é explícito:

> *"Two-channel capture, not diarization (…) So 'who' is really 'which audio source,' and **all remote speakers collapse into one `interviewer` label**."*

Hoje vocês rodam **dois streams de STT separados**: mic → `user`, áudio do sistema → `interviewer`. Isso funciona bem em **chamada remota** (Zoom/Meet).

**Mas quebra completamente no consultório, no escritório e na visita domiciliar** — que é exatamente onde está o dinheiro. Médico e paciente estão na mesma sala, no mesmo microfone, e tudo cai num locutor só. Uma nota SOAP sem saber quem falou o quê é inutilizável.

**É o item de engenharia mais valioso do projeto.**

#### O que o commit `f04e3c3` entrega

Lendo o código em vez do plano, o gap real era outro — e havia um bug latente junto:

1. **A diarização só era ligada no canal remoto.** `main.ts` habilitava
   `setDiarization` apenas quando `speaker === 'interviewer'`, com o comentário
   *"o canal mic é sempre o usuário local, então diarizá-lo adiciona custo sem
   benefício"*. Em chamada isso é verdade. **Em reunião presencial é justamente o
   contrário**: não existe canal de sistema, logo o microfone contém todos. Agora a
   flag `inPersonDiarizationV1` liga a diarização no microfone.

2. **Bug latente de colisão de locutores.** Provedores numeram locutores por
   *conexão*, não por reunião. Jogar esses números direto na transcrição fazia o
   speaker 0 do microfone e o speaker 0 do sistema colapsarem num único
   "Speaker 1" — duas pessoas diferentes virando uma nas notas e nos action
   items — e permitia que uma reconexão renumerasse a mesma voz.
   `SpeakerIdRegistry` chaveia por (canal, índice) e entrega ids `speaker_<n>` sem
   colisão, no formato que `SpeakerLabelService` e `TranscriptNormalizer` já
   entendem (nenhum código a jusante muda).

3. **Desacoplado do Deepgram.** Nova interface estrutural `DiarizableSTT` +
   type guard, para que qualquer provedor que implemente `setDiarization()`
   participe — inclusive um diarizador local.

#### O que ainda falta

- **A diarização continua sendo de nuvem.** O único provedor que a implementa
  hoje é o Deepgram, o que conflita com a tese de compliance on-device.
  **Um diarizador local (VAD + embeddings + clustering) é o trabalho grande que
  resta** — estimativa 2–3 semanas, e é o que fecha o argumento de "nenhum elo
  na cadeia".
- A flag `inPersonDiarizationV1` está **default OFF**: ninguém testou com áudio
  real de duas pessoas numa sala. Precisa de validação antes de ligar.
- Em reunião presencial nenhuma voz é rotulada "Me" (não há como saber qual é a
  do usuário) — o usuário renomeia depois, via `SpeakerLabelService`.

### 🔴 G2. O repositório não compila, e o CI está vermelho

> **✅ CORRIGIDO em 2026-09-05 (commit `b0d1c7a`).** Build e CI estão verdes.
> O que permanece: `LicenseManager` continua não existindo, então **o billing
> segue sem funcionar de verdade**.

`npm run build:electron` falhava porque o submódulo `premium/` aponta para `Natively-AI-assistant/natively-premium` (inexistente). **Confirmado no GitHub Actions**: o job do PR #1 parou no passo 7, "Build electron (esbuild)".

Consequência direta: **o tier bloqueante do CI nem chega a rodar**. Hoje o CI valida quase nada, e todo PR nasce vermelho.

Isso também significa que o billing (`PurchaseActivationService`, `LemonSqueezyManager`) depende de `LicenseManager`, que está no submódulo morto. **Vocês não conseguem cobrar de ninguém enquanto isso não for resolvido.**

### 🔴 G3. Setup exige conhecimento técnico

O README lista em *Known Limitations*: *"a configuração inicial exige trazer suas próprias chaves de API ou instalar o Ollama"*.

Um psicólogo não sabe o que é uma chave de API. **Cada etapa de setup é uma desistência.** E o BYOK cria um problema pior: quem é técnico o bastante para configurar é exatamente quem nunca vai pagar.

**Correção:** empacotar o Moonshine-tiny (que já roda via ONNX com CoreML/DirectML) para funcionar no primeiro launch, offline, sem chave nenhuma. BYOK vira *upgrade*, não *pré-requisito*.

### 🟠 G4. Os templates são todos de entrevista de emprego

Os 9 modos são `general`, `negotiation`, `lecture`, `coding`, `sales`, `technical-interview`, `recruiting`, `team-meet`, `looking-for-work`. **Sete dos nove são sobre conseguir emprego.**

Nenhum produz um artefato que um profissional é obrigado a arquivar.

**Correção — 2 semanas, maior ROI por linha de código do projeto:** reaproveitar o `ModesManager` e trocar o conteúdo:

| Vertical | Template | Quem paga |
|---|---|---|
| Clínico | SOAP, DAR | Médico, psicólogo, enfermeiro |
| Jurídico | Memo de atendimento, ata de reunião com cliente | Advogado |
| Vendas | MEDDIC, preenchimento de CRM | SDR/AE |
| Corporativo | 1:1, standup, retro | Gestor |

### 🟠 G5. A saída termina em PDF

Existe `src/utils/pdfGenerator.ts` e pronto. O profissional recebe o PDF e **digita de novo no sistema dele**. O valor real não é o resumo — é o resumo **chegar no campo certo**.

**Caminho em três degraus, do barato ao caro:**
1. **"Copiar como..."** — um seletor de formato (SOAP, memo, CSV de CRM) que põe o texto estruturado no clipboard. ~2 dias. Resolve 60% do problema.
2. **Integrações diretas** — HubSpot, Salesforce, Clio, SimplePractice. APIs públicas, ~1 semana cada.
3. **Preenchimento de EHR** — o mais valioso e o mais difícil. Deixar para depois do product-market fit.

### 🟠 G6. Não existe plano de equipe

Tudo é por usuário individual. Mas quem tem orçamento é a **clínica de 5 terapeutas**, o **escritório de 10 advogados**, a **equipe de 12 vendedores**. Não há admin, templates compartilhados, gestão de assentos.

---

## Parte 4 — O que cortar (libera tempo para o que dá dinheiro)

| Cortar | Por quê |
|---|---|
| **Stealth / disfarce de processo** | Não pode ser anunciado, barra a App Store, barra venda empresarial, cria risco jurídico. **Manter o código é uma decisão; fazer disso o argumento de venda é o que trava a distribuição.** Remover do README. |
| **Solver de LeetCode / coding interview** (`CodeHintLLM`, `codeVerification/`) | A superfície mais tóxica e a menos monetizável. Custo de manutenção alto. |
| **Intelligence OS (34 flags OFF)** | ~4,4 mil linhas de P&D parado. Congelar: ou shipa em 30 dias ou arquiva. Código desligado é dívida, não ativo. |
| **6 dos 8 provedores de STT** | Manter local Whisper + 1 cloud + 1 fallback. Cada provider é superfície de bug e custo de suporte. |
| **Codex CLI, agentes, GitService, RoleTwin, Skills** | Interessante, mas fora do foco de reunião. Congelar. |
| **Hindsight (memória longa)** | Over-engineering para o problema de hoje. |
| **`renderer/`** (scaffold CRA morto) e 83 MB de binários duplicados | Lixo. |

---

## Parte 5 — Backlog priorizado

### P0 — Destravar a receita (semanas 1–2)

| # | Item | Esforço | Desbloqueia |
|---|---|---|---|
| 1 | **Resolver o submódulo `premium`** — publicar stubs tipados, tornar os 34 `require()` opcionais, ou documentar que o repo é parcial | 2–3 d | Build, CI, **e o billing** |
| 2 | **Tornar o CI honesto** — `typecheck:electron` a blocking (hoje passa com 0 erros), adicionar matrix macOS/Windows | 0,5 d | Confiança para iterar |
| 3 | **Empacotar modelo local** para funcionar com zero chaves | 1 sem | Ativação (provavelmente o maior ganho de conversão do projeto) |

### P1 — Criar valor pelo qual se paga (semanas 3–6)

| # | Item | Esforço | Dor |
|---|---|---|---|
| 4 | **Diarizador LOCAL** (G1) — VAD + embeddings + clustering on-device | 2–3 sem | 🔴 Fecha o argumento de compliance; hoje só existe via Deepgram (nuvem) |
| 4b | ~~Diarização no canal do microfone + ids sem colisão~~ | — | ✅ **feito** em `f04e3c3` (flag `inPersonDiarizationV1`, default OFF) |
| 5 | **5 templates verticais** no `ModesManager` (G4) | 2 sem | Transforma transcrição em documento arquivável |
| 6 | **"Copiar como..."** com formatos estruturados (G5) | 2 d | Elimina a redigitação |
| 7 | **Painel "Prove"** — contador de bytes que saíram da máquina + relatório de auditoria exportável | 1 sem | Transforma privacidade em documento de compra |

### P2 — Multiplicar o ticket (semanas 7–12)

| # | Item | Esforço | Impacto |
|---|---|---|---|
| 8 | **Plano Practice/Team** (G6) | 3 sem | Ticket 5–10× |
| 9 | **Exportar "memória infinita"** — busca across todo o histórico, custo marginal zero | 1 sem | Diferencial impossível para concorrente de nuvem |
| 10 | **Preparação automática por calendário** (completar `CalendarManager`) | 1 sem | Contexto antes da reunião |
| 11 | **Integração com 1 CRM e 1 sistema jurídico** | 2 sem | Retenção |

---

## Parte 6 — Packaging e preço

**Não compitam com o Otter por preço** (US$ 17–30). Compitam com o **Microsoft Dragon Copilot por aprovação de compliance** — que custa **US$ 369–1.000+ por profissional/mês**, com piso de 10 provedores, contrato de 1–3 anos e implementação de 3–6 meses.

O detalhe decisivo: **o piso de 10 provedores exclui justamente o consultório individual e o grupo de 2–5**, que não conseguem comprar nem pagando. Já existe um mercado validado na fenda: Freed US$ 39–99, Twofold US$ 49, Vero US$ 69, Scribing.io US$ 149.

| Plano | Preço sugerido | Conteúdo |
|---|---|---|
| **Free** | R$ 0 | 5 reuniões/mês, STT local, zero-config, 1 template |
| **Pro** | **R$ 99–149/mês** (US$ 29–49) | Ilimitado, todos os templates verticais, diarização, memória infinita, "Copiar como…" |
| **Practice** | **R$ 199–349/assento/mês** (US$ 49–79) | + templates compartilhados, admin, pacote de compliance, integrações |

A R$ 149 vocês ainda são **~1/15 do preço do líder** e, diferente dele, vendem self-serve para o profissional sozinho.

### A vantagem que nenhum concorrente de nuvem alcança

> Um AI scribe é tão compliance quanto o elo mais fraco da cadeia: **cada** fornecedor que toca o dado (STT, LLM, storage) precisa do seu próprio acordo de confidencialidade assinado.

Se STT e LLM rodam no dispositivo, **não existe elo**. Não é "mais seguro" — é uma categoria jurídica diferente. Para chegar lá, um concorrente de nuvem precisa re-arquitetar do zero.

Isso precisa virar o centro do site, não uma linha no README.

---

## Parte 7 — O risco da tese

A tese só vale se o pipeline for **genuinamente** sem elo externo. Isso é trabalho de engenharia chato e inegociável:

- Telemetria (PostHog) sem nenhum traço de conteúdo de sessão
- Servidor de ativação de licença sem conteúdo
- Relay STT desligado por padrão no modo profissional
- Cada saída de rede documentada no painel "Prove"

Hoje existem `api.refract.software` (18 referências) e PostHog no produto. Cada um é um elo que precisa ser fechado **e documentado**. Se vocês venderem "on-device" e vazar metadado de sessão, o dano reputacional é pior que não vender — numa categoria onde o concorrente que vocês citam no README já sofreu um vazamento de 83 mil usuários.

---

## Parte 8 — Primeiros 30 dias

1. **Resolva o G2.** Sem build verde, nada mais anda. O CI de vocês hoje nem executa o tier bloqueante.
2. **Pesquisa de 1 pergunta para os 9.000 usuários:** "para que você usa o Refract?" Custa zero e é a pesquisa de mercado mais rápida disponível.
3. **Empacote o modelo local** (P0 #3). Meça ativação antes/depois.
4. **Suba 5 templates verticais** (P1 #5). Meça conversão para pago.
5. **Landing alternativa:** "O único assistente de reunião que o seu compliance aprova." Meça signup contra a atual.

---

## Resumo

| | Situação |
|---|---|
| Motor técnico | ✅ 90% pronto — áudio nativo, STT local, RAG, modos, dashboard |
| Empacotamento | ❌ ~10% — templates de entrevista, setup técnico, sem plano de equipe |
| Bloqueio absoluto | 🔴 Submódulo `premium` inexistente → **billing quebrado** (build: ✅ corrigido em `b0d1c7a`) |
| Maior lacuna técnica | 🔴 Diarizador **local** (o de nuvem existe; o mic-channel foi corrigido em `f04e3c3`) |
| Maior alavancagem | 🎯 Templates verticais no `ModesManager` — 2 semanas, reusa 80% do que existe |
| Mercado-alvo | 🎯 Profissional impedido de usar nuvem (clínico, jurídico) |
| Preço-alvo | 🎯 R$ 99–349/mês — 1/15 do líder, self-serve para quem ele não atende |
