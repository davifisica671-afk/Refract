# Segredos do Refract — onde moram e como rotacionar

Auditoria de segurança (2026-09-11, achados F-01/F-02/F-13): o workspace
continha chaves reais em texto claro. Este runbook fixa o processo.

## Onde cada segredo deve morar

| Segredo | Lugar certo | Nunca |
|---|---|---|
| API keys do app (Groq/OpenAI/Gemini/...) | Tela Configurações (keychain via `safeStorage`) ou `.env` local (dev) | Commit, print, `site/`, bundle |
| `GOOGLE_CLIENT_SECRET` | Só no backend (`refract-api` / `fly secrets`) | Repo, app desktop, `.env` |
| Service account GCP (`*.json`) | `~/.secrets/` fora do repo, ACL restrita | Raiz do repo (mesmo gitignorado) |
| `LICENSE_SIGNING_KEY_PATH` (Ed25519) | `~/.refract/` + backup offline | Repo; `test-key.pem` é dev-only |
| `LEMONSQUEEZY_*` | `fly secrets` (prod) | `fly.toml`, código, `.env` commitado |

Travas automáticas (já no código):

- `lemonsqueezy-server/server.js` recusa subir em produção com valores
  placeholder (`your_*`, `changeme`, `test-*`, ...) e com
  `LICENSE_SIGNING_KEY_PATH` apontando para `*test-key*`.
- CI roda `scripts/check-no-secrets.mjs` (blocking): falha se padrão de
  segredo real aparecer em arquivo trackeado fora das fixtures conhecidas.

## Rotação passo a passo (quando vazar)

1. **Revogue primeiro no provedor**, depois gere a nova chave:
   - Groq: console.groq.com → API Keys → delete + create.
   - OpenAI: platform.openai.com → API keys → revoke + create (e restrinja
     permissões/projeto; considere limites de gasto).
   - Google (Gemini/OAuth): Google Cloud Console → Credenciais → exclua a
     chave/client-secret e crie outra; confira `GOOGLE_CLIENT_ID` usado no app.
   - Deepgram: console.deepgram.com → API Keys → revoke + create.
   - ElevenLabs: perfil → API keys → revoke + create.
   - Service account: IAM → Contas de serviço → Chaves → exclua a chave
     (`private_key_id` vazado) e crie outra; atualize quem consome.
2. Atualize onde a chave é consumida (`.env` local, `fly secrets set ...`).
3. Confira o histórico git: `git log --all -S '<trecho>' --oneline` e
   `git ls-files | grep -Ei '\.env$|\.pem$|service-account|gcp.*\.json'`.
   Se algo entrou no histórico, além de rotacionar considere o histórico
   contaminado (reescrever histórico público quase nunca vale a pena —
   a rotação já neutraliza).
4. Rode o check local: `node scripts/check-no-secrets.mjs`.

## Por que `.env` e `tonal-history-*.json` continuam no disco?

Estão no `.gitignore` (nunca foram commitados), mas disco/backup/sync não
são cofres. Plano: mover a service account para `~/.secrets/` e apontar
`GOOGLE_APPLICATION_CREDENTIALS` para lá; manter no `.env` só o necessário
para dev — ou melhor, na tela de Configurações.
