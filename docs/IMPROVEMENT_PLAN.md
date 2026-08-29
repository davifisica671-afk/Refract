# Refract — Plano de Melhorias para Lucratividade e Atratividade

> **Data:** 2026-08-11
> **Versão analisada:** v2.8.0
> **Objetivo:** Elevar o Refract a um nível lucrativo e atrativo, com foco em monetização, qualidade de código, UX e retenção.

---

## 1. Diagnóstico Geral

### O que já está forte ✅
- **Produto diferenciado:** Copilot de IA on-device para reuniões/entrevistas com transcrição <500ms, stealth mode, BYOK (GPT/Claude/Gemini/Groq/Ollama), OCR de screenshots, e sugestões "o que dizer".
- **Base de usuários:** 9.000+ usuários, 700+ DAU (segundo README).
- **Stack moderna:** Electron 43, React 19, TypeScript, Vite 5, Tailwind, Rust native audio, SQLite + sqlite-vec (RAG), Whisper local.
- **Monetização iniciada:** Licença Ed25519-signed, Pix checkout com ativação automática, DonationManager, feature gating (premium/).
- **Qualidade de engenharia:** Testes unitários, benchmarks de qualidade de resposta, CI em 4 tiers, Playwright E2E, docs extensas (20+ docs de arquitetura).

### O que está fraco ⚠️
- **God files:** `main.ts` (6.371 linhas), `ipcHandlers.ts` (8.030), `LLMHelper.ts` (6.410), `preload.ts` (2.542), `App.tsx` (1.116).
- **Monetização imatura:** Depende de Pix manual + licença local; sem assinatura recorrente internacional (Stripe/Paddle), sem trial estruturado, sem analytics de conversão.
- **Segurança:** DNS monkey-patch global, uso excessivo de `any`, `require()` dinâmico.
- **UX:** Onboarding fraco, sem tutorial de primeiro uso, sem analytics de produto.
- **Distribuição:** Publicação GitHub releases apenas; sem auto-update configurado de forma robusta, sem assinatura de código (hardenedRuntime: false).

---

## 2. Eixo 1 — Monetização (Prioridade Máxima)

### 2.1 Assinatura recorrente internacional
**Problema:** Pix é local (Brasil) e manual. Para escalar globalmente, precisa de assinatura recorrente.

**Ação:**
- Integrar **Stripe Billing** (ou Paddle/LemonSqueezy para vender como Merchant of Record e evitar VAT global).
- Modelo: **Freemium** com tier gratuito limitado (ex: 5 reuniões/mês, 30min cada) e **Pro** (ilimitado, RAG, code hints, language learning).
- Implementar webhook de assinatura → ativação automática de licença (reutilizar `LicenseManager` Ed25519).
- Adicionar **trial de 7 dias** com cartão.

**Arquivos afetados:** `premium/electron/services/LicenseManager.ts`, `electron/DonationManager.ts`, `electron/ipcHandlers.ts` (channels de license), `src/` (UI de upgrade).

### 2.2 Analytics de conversão
**Problema:** Sem dados de funil (instalação → ativação → trial → pagamento).

**Ação:**
- Integrar **PostHog** (self-hosted ou cloud) com `posthog-js` no renderer e `posthog-node` no main.
- Eventos: `app_installed`, `app_launched`, `trial_started`, `feature_used` (por feature), `upgrade_clicked`, `payment_succeeded`, `payment_failed`, `churn`.
- Dashboard de funil para medir conversão.

### 2.3 Preço e posicionamento
- Definir preço ancorado em concorrentes (ex: Otter.ai $16.99/mês, Fireflies $18/mês, Granola $18/mês).
- Sugestão: **$12/mês** (ou R$49/mês) com desconto anual de 20%.
- Criar **página de pricing** no site (`site/`) com comparação Free vs Pro.

### 2.4 Licença offline robusta
- `LicenseManager` já usa Ed25519. Melhorar:
  - Cache offline com `electron-store` (já presente).
  - Validação de expiração com tolerância de clock skew.
  - Revogação via lista de bloqueio (denylist) baixada periodicamente.

---

## 3. Eixo 2 — Qualidade de Código (Prioridade Alta)

### 3.1 Refatorar God files (maior risco técnico)
**Problema:** `main.ts` (6.371), `ipcHandlers.ts` (8.030), `LLMHelper.ts` (6.410), `preload.ts` (2.542), `App.tsx` (1.116) são insustentáveis.

**Ação (por fases, sem quebrar funcionalidade):**
1. **`ipcHandlers.ts`** → dividir em módulos por domínio:
   - `ipc/screenshots.ts`, `ipc/llm.ts`, `ipc/stt.ts`, `ipc/meetings.ts`, `ipc/settings.ts`, `ipc/license.ts`, `ipc/rag.ts`, `ipc/updates.ts`.
   - Cada módulo exporta `registerXxxHandlers(ipcMain, deps)`.
2. **`main.ts`** → extrair `AppState` para `state/AppState.ts` e inicialização de janelas para `windows/WindowFactory.ts`.
3. **`LLMHelper.ts`** → dividir em `llm/providers/` (um arquivo por provider: OpenAI, Anthropic, Gemini, Groq, Ollama) + `llm/AnswerBuilder.ts`.
4. **`App.tsx`** → extrair `useWindowRouter()` hook e componentes de janela para `src/windows/`.

**Benefício:** Testabilidade, manutenibilidade, onboarding de novos devs, menos bugs de regressão.

### 3.2 Remover DNS monkey-patch global
**Problema:** `main.ts:74-96` faz patch global de `dns.lookup` para forçar IPv4 no updater. Afeta todo o processo.

**Ação:**
- Escopar o patch ao `autoUpdater` usando um `net`/`agent` customizado, ou usar `app.commandLine.appendSwitch('host-resolver-rules', 'MAP *:443 ...')` de forma controlada.
- Ou usar `electron-updater` com `netSession` custom.

### 3.3 Endurecer TypeScript
- Eliminar `any` em pontos críticos (IPC handlers, config).
- Substituir `require()` dinâmico por `import()` tipado ou lazy-load com tipos.
- Adicionar `noImplicitAny: true` (já deve estar) e `strictFunctionTypes`.

### 3.4 Testes
- Adicionar testes para os módulos refatorados (unit + integration).
- Aumentar cobertura do renderer (hoje só há testes `.mjs` no main).
- Adicionar testes de regressão para o fluxo de licença (trial, expiração, revogação).

---

## 4. Eixo 3 — UX e Atratividade (Prioridade Alta)

### 4.1 Onboarding de primeiro uso
**Problema:** App complexo (7 janelas, stealth mode, BYOK) sem tutorial.

**Ação:**
- Criar **onboarding em 3 passos** na primeira execução:
  1. Escolher caso de uso (entrevista, reunião, aula, coding).
  2. Configurar LLM (BYOK ou trial com chave padrão).
  3. Testar captura de áudio (microfone + sistema).
- Adicionar **tooltips contextuais** (Radix Tooltip) nos primeiros usos.

### 4.2 Polir a UI do overlay
- O overlay é o coração do produto. Garantir:
  - Transparência/opacidade ajustável (já existe).
  - Modo "stealth" com hotkey global (já existe).
  - Animações suaves (Framer Motion já presente).
  - **Dark/light theme** consistente (já existe ThemeManager).
- Adicionar **modo compacto** para telas pequenas.

### 4.3 Dashboard de insights
- Criar uma **janela de dashboard** (`?window=dashboard`) mostrando:
  - Histórico de reuniões/entrevistas.
  - Estatísticas (tempo transcrito, palavras, tópicos).
  - "Revisão semanal" (já mencionado no changelog como "week summary").
- Isso aumenta retenção e percepção de valor.

### 4.4 Performance
- **Startup time:** medir e otimizar (lazy-load de módulos pesados como Whisper, RAG).
- **Memória:** verificar vazamentos no overlay (long sessions).
- **Bundle size:** code-splitting do renderer (Vite já suporta).

---

## 5. Eixo 4 — Distribuição e Confiabilidade (Prioridade Média)

### 5.1 Assinatura de código
- **macOS:** habilitar `hardenedRuntime: true` + notarização (já tem `@electron/notarize` e `electron-builder.signed.cjs`).
- **Windows:** assinar com certificado EV (ou pelo menos code signing) para evitar SmartScreen.
- **Linux:** AppImage + deb (já configurado).

### 5.2 Auto-update robusto
- `electron-updater` já está. Garantir:
  - Canal stable/beta.
  - Rollback automático em falha.
  - Notificação de atualização com changelog.

### 5.3 Site de marketing
- O `site/` existe. Melhorar:
  - Hero com demo animada (GIF já existe em `assets/natively-ai-meeting-assistant-demo.gif`).
  - Seção de pricing.
  - Testemunhos/casos de uso.
  - SEO (meta tags, Open Graph).
  - Blog/guia de uso (para SEO orgânico).

---

## 6. Eixo 5 — Retenção e Comunidade (Prioridade Média)

### 6.1 Feedback in-app
- Botão "Enviar feedback" com screenshot anexada (reutilizar ScreenshotHelper).
- Coletar NPS (Net Promoter Score) após 3 usos.

### 6.2 Comunidade
- Discord/Telegram para suporte e comunidade.
- Changelog público (já existe `CHANGELOG.md`).
- Roadmap público (já existe `ROADMAP.md`).

### 6.3 Referral program
- "Convide um amigo, ganhe 1 mês grátis" — integrado ao LicenseManager.

---

## 7. Roadmap Sugerido (Ordem de Execução)

| Fase | Prazo | Entregáveis |
|------|-------|-------------|
| **Fase 1 (Monetização)** | 2-4 semanas | Stripe/Paddle + trial 7d + analytics PostHog + pricing page |
| **Fase 2 (Qualidade)** | 4-8 semanas | Refatorar ipcHandlers + main.ts + App.tsx; remover DNS patch; endurecer TS |
| **Fase 3 (UX)** | 4-6 semanas | Onboarding 3 passos + dashboard de insights + polir overlay |
| **Fase 4 (Distribuição)** | 2-4 semanas | Code signing macOS/Windows + auto-update robusto + site de marketing |
| **Fase 5 (Retenção)** | contínuo | Feedback in-app + comunidade + referral |

---

## 8. Métricas de Sucesso (KPIs)

| Métrica | Meta (90 dias) |
|---------|----------------|
| Conversão free→pro | 3-5% |
| MRR | $5k-10k |
| Churn mensal | <5% |
| DAU/MAU | >30% |
| NPS | >40 |
| Tempo de startup | <2s |
| Crash-free sessions | >99% |

---

## 9. Riscos e Mitigações

| Risco | Mitigação |
|-------|-----------|
| Refatoração quebra funcionalidade | Fazer por fases, com testes de regressão e feature flags |
| Dependência de API de terceiros (STT relay) | Manter fallback local (Whisper) e BYOK |
| Concorrência (Otter, Fireflies, Granola) | Focar em stealth mode + BYOK + preço agressivo |
| Custo de LLM alto | Otimizar prompts, cache, e modelos baratos (Gemini Flash Lite) |
| Regulamentação (LGPD/GDPR) | Dados locais (já é diferencial), documentar privacidade (PRIVACY.md existe) |

---

## 10. Conclusão

O Refract tem **fundação técnica sólida** e um **produto com diferencial real** (on-device, stealth, BYOK). O maior gap para lucratividade é a **monetização recorrente internacional** e a **qualidade de código** (god files) que limita velocidade de iteração.

**Prioridade imediata:** Fase 1 (Stripe/Paddle + trial + analytics) — é o que gera receita. Depois Fase 2 (refatoração) para sustentar o crescimento.

---

*Documento gerado a partir de análise automatizada do código-fonte em 2026-08-11.*