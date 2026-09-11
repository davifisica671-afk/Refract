# Refract LemonSqueezy Server

Servidor standalone de checkout LemonSqueezy para o Refract Pro. Emite licenças assinadas Ed25519 no formato `REFRACT-PRO` — o mesmo formato que o `LicenseManager` do app verifica offline.

## Endpoints

| Método | Rota | Descrição |
|--------|------|-----------|
| `POST` | `/v1/checkout/lemonsqueezy` | Cria sessão de checkout no LemonSqueezy |
| `GET` | `/v1/checkout/:id/license` | Devolve a licença assinada (ou `pending`) |
| `POST` | `/webhooks/lemonsqueezy` | Recebe eventos do LemonSqueezy (robustez) |
| `GET` | `/health` | Healthcheck |

## Variáveis de ambiente

| Variável | Obrigatória | Default | Descrição |
|----------|-------------|---------|-----------|
| `LEMONSQUEEZY_API_KEY` | ✅ | — | Chave de API do LemonSqueezy (placeholders recusados no boot) |
| `LEMONSQUEEZY_STORE_ID` | ✅ | — | ID da loja no LemonSqueezy |
| `LEMONSQUEEZY_WEBHOOK_SECRET` | ✅ | — | Segredo para validar webhooks |
| `LEMONSQUEEZY_VARIANT_MONTHLY` / `_YEARLY` / `_LIFETIME` | ✅ | — | IDs das variantes por plano |
| `LICENSE_SIGNING_KEY_PATH` | ❌ | `~/.refract/license-signing-key.pem` | Chave privada Ed25519. `*test-key*` é recusado em produção |
| `DB_PATH` | ❌ | `./data/refract-ls.db` | Caminho do SQLite |
| `PORT` | ❌ | `8787` | Porta HTTP |
| `LS_RATE_LIMIT_PER_MIN` | ❌ | `120` | Rate-limit/min/IP nas rotas de licença (`0` recusado em produção) |
| `LS_CHECKOUT_LIMIT_PER_MIN` | ❌ | `20` | Rate-limit/min/IP na criação de checkout (anti-spam) |
| `LS_TRUST_PROXY` | ❌ | `0` | `=1` atrás de proxy (Fly.io) para `req.ip` real via X-Forwarded-For |
| `LS_ALLOW_LEGACY_NO_HWID` | ❌ | `0` | `=1` reativa o bypass de poll p/ linhas sem hwid (compat. temporária; loga warning). Padrão é estrito: linha sem hwid → 403 |

## Deploy (Railway / Render / Fly.io)

1. **Suba o diretório `lemonsqueezy-server/` como um serviço separado** (não o app Electron inteiro).

2. **Configure as variáveis de ambiente** no painel do provedor.

3. **Copie a chave privada** para o servidor (ex.: via secret/env file). A chave privada NUNCA deve ir para o repositório.

4. **Start command:** `npm start`

5. **No painel do LemonSqueezy:**
   - Configure o webhook para `https://SEU-DOMINIO/webhooks/lemonsqueezy`
   - Use o mesmo `LEMONSQUEEZY_WEBHOOK_SECRET`

## Fluxo

```
App (Electron)                          Servidor (este)                    LemonSqueezy
     │  POST /v1/checkout/lemonsqueezy       │                                  │
     │──────────────────────────────────────>│  createCheckout()                 │
     │  { checkout_id, checkout_url }        │<─────────────────────────────────│
     │<──────────────────────────────────────│                                  │
     │                                       │                                  │
     │  (abre checkout_url no navegador)     │                                  │
     │                                       │  usuário paga ──────────────────>│
     │                                       │                                  │
     │  GET /v1/checkout/:id/license         │  webhook order_created ─────────>│
     │──────────────────────────────────────>│  (ou polling)                     │
     │  { license_key }                      │  issueLicense()                   │
     │<──────────────────────────────────────│                                  │
     │                                       │                                  │
     │  LicenseManager.activateLicense()     │                                  │
     │  (verifica offline, Ed25519)          │                                  │
```

## Notas

- **Segurança:** a chave privada Ed25519 vive apenas no servidor. O app só tem a pública.
- **Fail-open:** se o LemonSqueezy estiver fora, o polling retorna `pending` — o app continua tentando.
- **Webhook + polling:** ambos funcionam; o webhook é mais rápido, o polling é o fallback.