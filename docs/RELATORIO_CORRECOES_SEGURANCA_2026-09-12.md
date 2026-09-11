# Relatório — Correções de segurança + limpeza de marca/slop (2026-09-11/12)

Data: 12 de setembro de 2026. Base: auditoria `docs/security-audit/` (14 achados F-01–F-14).
Nada foi commitado; todas as mudanças estão no working tree. Nenhum segredo é
reproduzido neste documento.

## PARTE 1 — Correções de segurança (todos os 14 achados)

### P3 · F-03 — Command injection no GitService (alta)
- `electron/services/GitService.ts`: `exec`/`execSync` com template string
  eliminados; novo `gitArgv(argv)` via `execFile` (sem shell) + `windowsHide`.
  Validadores exportados: `assertSafePathSpec` (tipo/tamanho/NUL, sem magia
  `:` de pathspec) e `assertSafeBranchName` (charset `^[A-Za-z0-9][…]`, sem
  `..`, `@{`, leading `-`). `getLog` coage count a inteiro 1–200; `commit`
  via `execFileSync('git', [...])` com stdin; `stash -m` como argv;
  `openInFileManager` via `execFileSync` (`/usr/bin/open` absoluto no macOS).
- Extra, mesma classe: `electron/services/AgentManager.ts` — `open_file`
  trocado de `execAsync(open …)` por `shell.openPath` (+ validação NUL).
  `run_command` mantido como shell intencional (ação aprovada na UI + blocklist).
- Teste novo: `electron/services/__tests__/GitServiceNoShell.test.mjs`.

### P4 · F-05/F-06/F-08 — Validação de paths no IPC (alta/média)
- `electron/ipcHandlers.ts`: helper `validateChatImagePaths` (teto de 5 +
  `validateImagePath` de userData); aplicado a `gemini-chat` (throw) e
  `gemini-chat-stream` (erro via `gemini-stream-error`, antes da probe e do
  `streamChat`).
- `electron/audio/whisper/modelManager.ts`: `assertKnownModelId` (allowlist do
  `MODEL_CATALOG`) + `resolveCatalogModelDir` (contenção); `deleteModel` usa
  ambos. `local-whisper-start-download` valida antes de baixar (bloqueia
  download de repo arbitrário do HF). `preload` inalterado (no-op p/ id
  desconhecido).
- `electron/repo-indexer/repoPathPolicy.ts` (novo, zero-dep): `validateRepoPath`
  (absoluto, existe, é dir, realpath, fora de locais do SO/home própria/raiz do
  drive, sem NUL) + tetos (5000 arquivos, 512 KB/arquivo, 50 MB total).
  `RepoIndexer.walkRepo` aplica tetos e ignora symlinks. `repo-index:scan` e
  `repo-index:query` validam antes de construir o indexer.
- Teste novo: `electron/services/__tests__/AuditFixesSep2026.test.mjs`.

### P5 · F-09/F-10 — Fronteiras locais (média)
- `electron/services/CalendarManager.ts`: OAuth com `state` aleatório (32 bytes,
  comparado com `timingSafeEqual`) + PKCE S256 (`code_verifier` de 64 bytes vai
  no exchange via proxy); servidor preso a `127.0.0.1` + checagem de
  `remoteAddress` loopback (403 caso contrário). **Contrato documentado no
  código: o proxy `refract-api` PRECISA encaminhar `code_verifier` ao Google —
  atualizar o proxy ANTES de distribuir o app novo.**
- `electron/ipcHandlers.ts`: `safeHandle`/`safeOn` rejeitam remetente que não
  seja `BrowserWindow` do app (`forbidden sender`); `delete-meeting` valida id.
  Limite honesto: não barra XSS dentro de janela legítima (fronteira = sanitização).

### P2 · F-04/F-07/F-12 — Servidor de licenças (alta/média/baixa)
- `lemonsqueezy-server/server.js`: estrito por padrão (`STRICT_HWID=true`,
  escape `LS_ALLOW_LEGACY_NO_HWID=1` com warning); linha sem hwid → 403
  (qualquer-hwid-não-vazio não é mais aceito); rate-limit próprio no POST
  checkout (`LS_CHECKOUT_LIMIT_PER_MIN`, default 20); `trustProxy` opt-in
  (`LS_TRUST_PROXY`); boot recusa placeholders, rate-zero e `*test-key*` em
  produção; chave privada com load lazy; `hwid`/`email` do POST com teto de
  tamanho. README + `fly.toml` (`LS_TRUST_PROXY=1`) atualizados.
- `server.test.mjs`: expectativa legada corrigida + testes novos (429 no POST,
  `isPlaceholderSecret`). **11/11 verdes.**

### P1/P6 · F-01/F-02/F-11/F-13/F-14 — Segredos e higiene
- `.env.example` (só placeholders), `docs/SECRETS.md` (runbook de rotação),
  `scripts/check-no-secrets.mjs` + gate blocking no CI (limpo; 2 canários de
  teste de redação entraram na allowlist após verificação manual).
- `dompurify@3.4.13` em `dependencies` + `@types/dompurify` em dev,
  removido o shim `src/types/vendor.d.ts`. `test-key.pem`: trava de boot em
  produção (nunca referenciada por código — só `.gitignore`).
- `RoleTwinManager.researchCompany`: gate `isProOrTrialActive()` (nova função
  exportada, espelhando `ipcHandlers`), acabando a inconsistência com trial.

### Validação final
- `npm run build:electron` OK; `tsc` electron + renderer limpos; LS 11/11;
  suítes de auditoria+vizinhas 24/24; tier renderer 135/135; secrets-check OK.
- 2 falhas em suítes vizinhas (`Issue303`, `Issue301`) são **pré-existentes**
  (placar idêntico com `git stash`, sem minhas mudanças).

### Ações manuais restantes (só o dono faz)
1. Rotacionar as 6 chaves do `.env` + service account (`docs/SECRETS.md`).
2. Atualizar o proxy `refract-api` (encaminhar `code_verifier`) antes do app.
3. No deploy do LS: `LS_TRUST_PROXY=1` + `fly secrets`; avaliar clientes
   antigos sem hwid (hatch `LS_ALLOW_LEGACY_NO_HWID` se precisar).

## PARTE 2 — Limpeza de marca "natively" e slop

Metodologia: varredura case-insensitive de `natively` em todo o código-fonte
(excluídos `node_modules`, builds, `site/*` vendored, `resources/`, venv).

### Removido/neutralizado
- `InstallPingManager.ts`: URL hardcoded `*.natively.workers.dev` eliminada —
  ping agora só dispara com `REFRACT_INSTALL_PING_URL` explícito (default =
  desligado, zero exfiltração); cabeçalho + comentários reescritos em PT claro.
- `DatabaseManager.ts:1994`: removida piada com concorrente ("Cluely…").
- `ipcHandlers.ts (~1491)`: removida referência garbled "Aetherbot AI".
- `src/main.tsx`: comentário de migração reescrito de forma neutra ("chaves
  legadas → atuais"; a migração em si foi MANTIDA para não apagar prefs de
  usuários existentes).
- `whisperWorker.ts` (header) e `PromptAssembler.ts:82`: comentários
  PT-EN embaralhados reescritos em PT claro.
- `PhoneMirrorSettings.tsx:640`: comentário do chip "Coming soon" reescrito
  (o chip em si é UX honesta e correta — mantido).
- `refract-browser/dist`: rebuildado do `src` (já 100% "Refract"; protocolo
  `refract:*` nos dois lados, sem problema de compat).

### Mantido de propósito (invisível p/ clientes, funcional)
- Regexes de redação `natively_sk_` / `x-natively-key` (`TelemetryService`,
  `redactForLog`): apagam chaves LEGADAS de logs — remover pioraria a segurança.
- Migração `natively_*` → `refract_*` no localStorage: preserva dados de quem
  já usa o app.
- Palavra inglesa "natively" (= "de forma nativa") em 3 comentários: uso
  legítimo do idioma, sem vínculo com marca.

### Observações (não mexido, recomendado como follow-up)
- `site/v1` e `site/v4` contêm páginas raspadas do concorrente (hotlink p/
  `cluely.com/_next/...`) — é material de referência servido só pelo server
  dev local (`serve-all.mjs`), mas recomendo quarentenar/remover antes de
  qualquer deploy público.
- `scripts/translate-comments.mjs` (não ligado ao CI) é a origem provável dos
  comentários PT-EN embaralhados; milhares restam pelo código. Reescrita em
  massa = churn arriscado sem impacto p/ o cliente; recomendo aposentar o
  script e normalizar comentários aos poucos, nos arquivos que forem tocados.
- TODOs restantes (`OcrProvider`, `drivers.ts`, `dnsWorkaround`) são trabalho
  futuro legítimo com critério de remoção — não é slop.

## PARTE 3 — Logo sumida nos botões (pós-relatório)

Diagnóstico (verificado com screenshot do app rodando via Playwright): o
arquivo `icon.png` carrega normalmente (HTTP 200, 644x644) — o problema era
CSS. As classes `brightness-0 invert` achatavam a arte em vidro numa silhueta
branca ilegível em 14-15 px (borrão branco = "logo sumida").

Correção (`src/components/Launcher.tsx`, `HelpSettings.tsx`): botões "Start
Refract" e "Start a session" agora usam o componente oficial `RefractLogoMark`
(vetor prisma, `currentColor`, nítido em qualquer tamanho) em vez do PNG com
filtro destrutivo; removida a inversão condicional no item "Refract API".
Verificado visualmente (zoom 3x) + `tsc` limpo. Padrão `force-black-icon`
(theme-aware) mantido onde o monocromático é intencional.
