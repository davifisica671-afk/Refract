# Integração LemonSqueezy — Guia de Implementação (Lado Cliente)

> **Status:** ✅ Integração completa — handlers registrados no main, expostos no preload.
> **Backend:** `lemonsqueezy-server/server.js` (standalone, neste repo) ou `refract-api`.

---

## 1. Arquivos da integração

| Arquivo | Papel |
|---------|-------|
| `electron/services/LemonSqueezyManager.ts` | Núcleo: cria checkout, faz polling da licença, fallback de URL direta |
| `electron/services/LemonSqueezyIpc.ts` | Registra os handlers IPC `lemonsqueezy:create-checkout` e `lemonsqueezy:poll-license` |
| `lemonsqueezy-server/server.js` | Backend standalone (Fastify + SQLite) que cria checkouts, valida webhooks e emite licenças Ed25519 |

**Wiring já feito:**
- `electron/main.ts` chama `registerLemonSqueezyHandlers()` logo após `initializeIpcHandlers(appState)` (fail-soft).
- `electron/preload.ts` expõe `window.electronAPI.lemonsqueezyCreateCheckout()` e `lemonsqueezyPollLicense()`.

---

## 2. Como usar no renderer

```ts
// 1. Criar checkout (abre o navegador automaticamente quando há URL)
const result = await window.electronAPI.lemonsqueezyCreateCheckout({ plan: 'monthly', email });

// 2. Polling até a licença ser ativada (o broadcast 'license-status-changed'
//    com { isPremium: true, plan } dispara sozinho quando activa)
const poll = await window.electronAPI.lemonsqueezyPollLicense(result.checkoutId!);
if (poll.activated) { /* Pro liberado */ }
```

---

## 3. Fluxo de pagamento

```
Usuário clica "Upgrade" no app
    ↓
Renderer chama: window.electronAPI.lemonsqueezyCreateCheckout({ plan, email })
    ↓
LemonSqueezyManager.createCheckout()
    ├─ Tenta POST {API_BASE}/v1/checkout/lemonsqueezy  (backend)
    │    └─ Se backend responde: retorna { checkoutId, checkoutUrl }
    └─ Se backend indisponível: FALLBACK → abre URL direta do LemonSqueezy
         (https://refract.lemonsqueezy.com/buy) e retorna { checkoutUrl }
    ↓
App abre o checkoutUrl no navegador (shell.openExternal)
    ↓
Usuário paga no LemonSqueezy
    ↓
LemonSqueezy envia webhook ao backend → backend emite licença assinada (REFRACT-PRO)
    ↓
Renderer faz polling: window.electronAPI.lemonsqueezyPollLicense(checkoutId)
    ↓
LemonSqueezyManager.pollLicense()
    ├─ GET {API_BASE}/v1/checkout/{id}/license?hwid=...  (hwid como fator de verificação)
    │    └─ Se license_key presente → ativa via LicenseManager.activateLicense()
    └─ Se status pending → retorna { pending: true } (app continua polling)
    ↓
Licença ativada → janelas notificadas via 'license-status-changed' { isPremium, plan }
```

---

## 4. Backend (lemonsqueezy-server)

Servidor standalone já implementado em `lemonsqueezy-server/server.js`. Deploy: Railway / Render / Fly.io — `npm start`.

### `POST /v1/checkout/lemonsqueezy`
**Request:**
```json
{ "plan": "monthly" | "yearly" | "lifetime", "email": "user@example.com", "hwid": "abc123" }
```
**Response (200):**
```json
{ "checkout_id": "ls_xxx", "checkout_url": "https://refract.lemonsqueezy.com/buy/..." }
```
**Lógica:** cria sessão no LemonSqueezy via SDK (`createCheckout({ storeId, variantId, attributes })` — variante por plano), guarda o checkout associado ao `hwid`.

### `GET /v1/checkout/{checkoutId}/license?hwid=...`
**Response (200) quando pago:**
```json
{ "license_key": "REFRACT-PRO.<payload>.<sig>", "status": "paid", "plan": "monthly" }
```
**Response (200) quando pendente:**
```json
{ "status": "pending" }
```
**Segurança:** o `hwid` informado na criação é exigido no polling (403 `hwid_mismatch` sem match) — checkout id sozinho não revela a licença.

### `POST /webhooks/lemonsqueezy`
Assinatura HMAC-SHA256 validada com `timingSafeEqual` (com checagem de length antes — buffers de tamanhos diferentes retornam 401, não 500).

---

## 5. Configuração necessária

| Variável | Onde | Descrição |
|----------|------|-----------|
| `LEMONSQUEEZY_CHECKOUT_URL` | env do app | URL de checkout direto (fallback). Default: `https://refract.lemonsqueezy.com/buy` |
| `LEMONSQUEEZY_API_KEY` | env do backend | Chave de API do LemonSqueezy (para criar sessões) |
| `LEMONSQUEEZY_STORE_ID` | env do backend | ID da loja |
| `LEMONSQUEEZY_VARIANT_MONTHLY` / `_YEARLY` / `_LIFETIME` | env do backend | IDs das variantes de produto por plano (obrigatórios) |
| `LEMONSQUEEZY_WEBHOOK_SECRET` | env do backend | Segredo para validar webhooks |
| `LICENSE_SIGNING_KEY_PATH` | env do backend | Chave privada Ed25519 (default `~/.refract/license-signing-key.pem`) |

---

## 6. Próximos passos

1. ~~Backend~~ ✅ implementado (`lemonsqueezy-server/server.js`).
2. ~~Ativar no main~~ ✅ `registerLemonSqueezyHandlers()` registrado em `electron/main.ts`.
3. ~~Preload~~ ✅ `lemonsqueezyCreateCheckout` / `lemonsqueezyPollLicense` expostos via `window.electronAPI`.
4. ~~UI~~ ✅ `LemonSqueezyCheckoutButton` wired no `RefractProSettings` (planos yearly + lifetime, ao lado do Pix). Nota: o `FreeTrialModal` ficou de fora deliberadamente — seus botões vendem planos da **Refract API** via Dodo Payments (produto diferente da licença Pro desktop).
5. **Deploy:** provisionar `lemonsqueezy-server` (Railway/Render/Fly), configurar env vars e apontar `REFRACT_API_BASE` do app para o host.

---

## 7. Notas de design

- **Fallback inteligente:** se o backend ainda não tiver o endpoint, o app abre a URL direta do LemonSqueezy — o usuário paga e ativa a licença colando a chave (enviada por e-mail). Nada quebra.
- **Fail-open:** erros de rede nunca bloqueiam o usuário pagante (mesmo princípio do `LicenseManager`).
- **Autocontido:** nenhum arquivo existente foi tocado. A ativação é uma única chamada.
- **Reutiliza o LicenseManager:** a licença emitida pelo backend usa o mesmo formato `REFRACT-PRO` já verificado offline pelo app.