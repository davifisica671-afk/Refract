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
| `LEMONSQUEEZY_API_KEY` | ✅ | — | Chave de API do LemonSqueezy |
| `LEMONSQUEEZY_STORE_ID` | ✅ | — | ID da loja no LemonSqueezy |
| `LEMONSQUEEZY_WEBHOOK_SECRET` | ✅ | — | Segredo para validar webhooks |
| `LICENSE_SIGNING_KEY_PATH` | ❌ | `~/.refract/license-signing-key.pem` | Caminho da chave privada Ed25519 |
| `DB_PATH` | ❌ | `./data/refract-ls.db` | Caminho do SQLite |
| `PORT` | ❌ | `8787` | Porta HTTP |

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