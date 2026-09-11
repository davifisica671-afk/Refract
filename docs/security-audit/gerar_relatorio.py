#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Gerador do Relatório de Auditoria de Segurança — refract.
Uso (ambiente isolado, nada global):
  docs/security-audit/.venv/Scripts/python.exe docs/security-audit/gerar_relatorio.py
Saída:
  docs/security-audit/relatorio-auditoria-seguranca.pdf
  docs/security-audit/grafico_severidade_rosca.png
  docs/security-audit/grafico_categoria_barras.png
"""
import os
import html

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import cm, mm
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_LEFT
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    PageBreak, Image, KeepTogether, HRFlowable,
)

BASE = os.path.dirname(os.path.abspath(__file__))
PDF_PATH = os.path.join(BASE, "relatorio-auditoria-seguranca.pdf")
DONUT_PATH = os.path.join(BASE, "grafico_severidade_rosca.png")
BAR_PATH = os.path.join(BASE, "grafico_categoria_barras.png")

DATA_RELATORIO = "11 de setembro de 2026"

C_CRIT = "#B91C1C"
C_ALTA = "#EA580C"
C_MEDIA = "#D97706"
C_BAIXA = "#2563EB"
C_FORTE = "#059669"
C_INFO = "#6B7280"

SEV_COLORS = {"Crítica": C_CRIT, "Alta": C_ALTA, "Média": C_MEDIA,
              "Baixa": C_BAIXA, "Informativa": C_INFO}
SEV_ORDER = ["Crítica", "Alta", "Média", "Baixa", "Informativa"]
SEV_COUNT = {"Crítica": 2, "Alta": 4, "Média": 4, "Baixa": 2, "Informativa": 2}
CAT_COUNT = {"Cat. 1 — Banco sem tranca": 3, "Cat. 2 — Permissão no navegador": 2,
             "Cat. 3 — IDOR": 5, "Cat. 4 — Chaves expostas": 3, "Cat. 5 — Inputs/XSS": 1}


def styles():
    s = {}
    s["Title"] = ParagraphStyle("Title", fontName="Helvetica-Bold", fontSize=26,
                                leading=30, textColor=colors.HexColor("#0F172A"), alignment=TA_CENTER)
    s["Subtitle"] = ParagraphStyle("Subtitle", fontName="Helvetica", fontSize=12,
                                   leading=16, textColor=colors.HexColor("#475569"), alignment=TA_CENTER)
    s["H1"] = ParagraphStyle("H1", fontName="Helvetica-Bold", fontSize=15, leading=19,
                             textColor=colors.HexColor("#0F172A"), spaceBefore=14, spaceAfter=8,
                             keepWithNext=True)
    s["H2"] = ParagraphStyle("H2", fontName="Helvetica-Bold", fontSize=12, leading=15,
                             textColor=colors.HexColor("#1E3A5F"), spaceBefore=10, spaceAfter=6,
                             keepWithNext=True)
    s["Body"] = ParagraphStyle("Body", fontName="Helvetica", fontSize=9.5, leading=13.5,
                               textColor=colors.HexColor("#1F2937"), alignment=TA_JUSTIFY, spaceAfter=4)
    s["Bullet"] = ParagraphStyle("Bullet", fontName="Helvetica", fontSize=9.5, leading=13.5,
                                 textColor=colors.HexColor("#1F2937"),
                                 leftIndent=14, bulletIndent=4, spaceAfter=3)
    s["Small"] = ParagraphStyle("Small", fontName="Helvetica", fontSize=8.5, leading=11.5,
                                textColor=colors.HexColor("#475569"), alignment=TA_JUSTIFY, spaceAfter=3)
    s["Cell"] = ParagraphStyle("Cell", fontName="Helvetica", fontSize=8.3, leading=11,
                               textColor=colors.HexColor("#1F2937"), alignment=TA_LEFT)
    s["Chip"] = ParagraphStyle("Chip", fontName="Helvetica-Bold", fontSize=8, leading=10,
                               textColor=colors.white, alignment=TA_CENTER)
    s["Caption"] = ParagraphStyle("Caption", fontName="Helvetica-Oblique", fontSize=8,
                                  leading=10.5, textColor=colors.HexColor("#64748B"),
                                  alignment=TA_CENTER, spaceBefore=2, spaceAfter=8)
    s["Code"] = ParagraphStyle("Code", fontName="Courier", fontSize=7.1, leading=9.4,
                               textColor=colors.HexColor("#1F2937"), alignment=TA_LEFT,
                               leftIndent=2, spaceAfter=1)
    s["CodeBold"] = ParagraphStyle("CodeBold", fontName="Courier-Bold", fontSize=7.4,
                                   leading=9.8, textColor=colors.HexColor("#0F172A"),
                                   alignment=TA_LEFT, spaceAfter=2, spaceBefore=4)
    return s


S = styles()


def make_charts():
    plt.rcParams["font.family"] = "DejaVu Sans"
    vals = [SEV_COUNT[k] for k in SEV_ORDER]
    cols = [SEV_COLORS[k] for k in SEV_ORDER]
    fig, ax = plt.subplots(figsize=(4.6, 3.4))
    ax.pie(vals, colors=cols, startangle=90, counterclock=False,
           wedgeprops=dict(width=0.46, edgecolor="white", linewidth=2),
           autopct=lambda p: f"{p:.0f}%" if p > 0 else "",
           pctdistance=0.78, textprops=dict(fontsize=9, color="#0F172A", weight="bold"))
    ax.legend([f"{k} — {SEV_COUNT[k]}" for k in SEV_ORDER], loc="center left",
              bbox_to_anchor=(1.0, 0.5), fontsize=8.5, frameon=False)
    ax.set_title("Achados por severidade (total 14)", fontsize=10.5, weight="bold",
                 color="#0F172A", pad=10)
    fig.tight_layout()
    fig.savefig(DONUT_PATH, dpi=200, bbox_inches="tight")
    plt.close(fig)

    cats = list(CAT_COUNT.keys())
    short = ["Cat. 1", "Cat. 2", "Cat. 3", "Cat. 4", "Cat. 5"]
    cvals = [CAT_COUNT[c] for c in cats]
    barcols = ["#1E3A5F", "#1E3A5F", "#1E3A5F", "#1E3A5F", "#059669"]
    fig, ax = plt.subplots(figsize=(5.6, 3.2))
    bars = ax.bar(range(len(cats)), cvals, color=barcols, edgecolor="white", width=0.62)
    ax.set_xticks(range(len(cats)))
    ax.set_xticklabels(short, fontsize=9, color="#334155")
    ax.set_ylabel("nº de achados", fontsize=8.5, color="#475569")
    ax.set_title("Achados por categoria (F-04 conta na Cat. 1; também é IDOR)",
                 fontsize=10, weight="bold", color="#0F172A", pad=10)
    ax.set_ylim(0, max(cvals) + 1.2)
    ax.yaxis.set_major_locator(plt.MaxNLocator(integer=True))
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    for b, v in zip(bars, cvals):
        ax.text(b.get_x() + b.get_width() / 2, v + 0.08, str(v), ha="center",
                va="bottom", fontsize=10, weight="bold", color="#0F172A")
    fig.tight_layout()
    fig.savefig(BAR_PATH, dpi=200, bbox_inches="tight")
    plt.close(fig)


def chip(sev):
    return Table([[Paragraph(sev, S["Chip"])]], colWidths=[2.1 * cm],
                 style=TableStyle([
                     ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor(SEV_COLORS[sev])),
                     ("ROUNDEDCORNERS", [3, 3, 3, 3]),
                     ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                     ("TOPPADDING", (0, 0), (-1, -1), 3),
                     ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                     ("LEFTPADDING", (0, 0), (-1, -1), 4),
                     ("RIGHTPADDING", (0, 0), (-1, -1), 4),
                 ]))


def mono_file(text):
    return Paragraph(f'<font face="Courier" size="7.6">{html.escape(text)}</font>', S["Cell"])


def styled_table(headers, rows, widths):
    data = [[Paragraph(f"<b>{h}</b>", S["Cell"]) for h in headers]]
    data.extend(rows)
    t = Table(data, colWidths=widths, repeatRows=1)
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1E3A5F")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#CBD5E1")),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F1F5F9")]),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
    ]))
    return t


def issue_block(num, md_lines):
    story = [Paragraph(f"--- ISSUE {num} ---", S["CodeBold"])]
    rows = []
    for ln in md_lines:
        if ln.strip() == "":
            rows.append([Paragraph("<br/>", S["Code"])])
            continue
        esc = html.escape(ln)
        if ln.startswith("```"):
            rows.append([Paragraph(f"<b>{esc}</b>", S["Code"])])
        elif ln.startswith("# "):
            rows.append([Paragraph(f"<b><font size='9'>{esc[2:]}</font></b>", S["Code"])])
        elif ln.startswith("## "):
            rows.append([Paragraph(f"<b>{esc[3:]}</b>", S["Code"])])
        elif ln.startswith("- [ ]"):
            rows.append([Paragraph("[ ] " + esc[5:], S["Code"])])
        else:
            rows.append([Paragraph(esc, S["Code"])])
    t = Table(rows, colWidths=[17.0 * cm])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#F8FAFC")),
        ("BOX", (0, 0), (-1, -1), 0.6, colors.HexColor("#94A3B8")),
        ("INNERGRID", (0, 0), (-1, -1), 0.15, colors.HexColor("#E2E8F0")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 1),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
    ]))
    story += [t, Paragraph(f"--- FIM ISSUE {num} ---", S["CodeBold"]), Spacer(1, 6)]
    return story


FINDINGS = [
    dict(id="F-04", cat="1", sev="Alta",
         file="lemonsqueezy-server/server.js:65, 193–198, 281, 294–310",
         title="Poll de licença devolve license_key sem exigir hwid (bypass legado ativo por padrão)",
         desc="O mecanismo de isolamento do servidor de licenças é o fator de posse <b>hwid</b> "
              "(<i>hwidAllowsAccess</i>). Com <b>LS_REQUIRE_HWID ≠ 1 (padrão)</b>, linhas de checkout "
              "sem hwid (clientes antigos gravam <i>hwid = NULL</i>) liberam a <i>license_key</i> para "
              "qualquer um que conheça o <i>checkout id</i> — IDs numéricos sequenciais do LemonSqueezy, "
              "enumeráveis; as respostas 404/403/200 viram oráculo. O próprio teste documenta o bypass "
              "(<i>server.test.mjs:65–66</i>) e o comentário :290–293 admite o risco.",
         code="const STRICT_HWID = process.env.LS_REQUIRE_HWID === '1'; // :65 default off\n"
              "if (r && r !== 'unknown') return q === r; return strict ? q.length > 0 : true; // :193–198\n"
              "const row = db.prepare('SELECT * FROM checkouts WHERE id = ?').get(id); // :296\n"
              "if (row.license_key) return { license_key, status: 'paid', plan }; // :309–310"),
    dict(id="F-07", cat="1", sev="Média",
         file="lemonsqueezy-server/server.js:248–288 (vs :294, :340)",
         title="POST /v1/checkout/lemonsqueezy sem rate-limit (spam/DoS de SQLite)",
         desc="A criação de checkout é pública por design, mas é a única rota de escrita sem "
              "<i>rateLimitPreHandler</i>. Cada chamada insere uma linha <i>open</i> no SQLite e custa "
              "uma chamada à API do LemonSqueezy — spam intencional enche o disco/banco e gera custo.",
         code="app.post('/v1/checkout/lemonsqueezy', async (req, reply) => { // :248 sem preHandler\n"
              "  db.prepare('INSERT INTO checkouts ...').run(checkoutId, plan, ...); // :278–281"),
    dict(id="F-12", cat="1", sev="Baixa",
         file="lemonsqueezy-server/server.js:64, 161–212",
         title="Rate-limit em memória por IP, sem trustProxy; zero desativa; strict ainda aceita hwid qualquer",
         desc="O bucket é um <i>Map</i> em memória (morre no restart, não escala além de 1 instância, "
              "conta <i>req.ip</i> — falsificável via <i>X-Forwarded-For</i> sem <i>trustProxy</i>); "
              "<i>LS_RATE_LIMIT_PER_MIN=0</i> desativa. E mesmo com <i>STRICT_HWID=1</i>, linha legada aceita "
              "qualquer hwid não-vazio (<i>server.test.mjs:69 — hwidAllowsAccess('', 'q', true) === true</i>), "
              "ou seja, não é prova de posse.",
         code="const RATE_LIMIT_PER_MIN = Number(process.env.LS_RATE_LIMIT_PER_MIN ?? 120); // :64\n"
              "if (max <= 0) return { allowed: true, ... }; // :164  (0 = ilimitado)"),
    dict(id="F-10", cat="2", sev="Média",
         file="electron/ipcHandlers.ts:105–111 (vs :385–419)",
         title="Canais IPC sem validação de remetente (qualquer janela invoca tudo)",
         desc="<i>safeHandle()</i> só remove o handler anterior e registra — não valida <i>event.sender</i>. "
              "Apenas 2 handlers conferem <i>sender.id</i>. Qualquer janela (launcher/overlay/settings) ou "
              "renderer comprometido via XSS pode invocar canais destrutivos (<i>flush-database :5051</i>, "
              "<i>delete-meeting :2208</i>, <i>set-*-api-key</i>). Mitiga parcialmente: "
              "<i>contextIsolation + nodeIntegration:false</i> nas janelas.",
         code="const safeHandle = (channel, listener) => {\n"
              "  ipcMain.removeHandler(channel); ipcMain.handle(channel, listener); }; // :105–111"),
    dict(id="F-14", cat="2", sev="Informativa",
         file="electron/services/RoleTwinManager.ts:224–226",
         title="Inconsistência de gate: RoleTwin exige premium puro; demais gates aceitam trial",
         desc="O dossier do RoleTwin usa <i>isPremium()</i> puro (trial não libera), enquanto todos os "
              "demais gates usam <i>isProOrTrialActive()</i> (<i>ipcHandlers.ts:148–169</i>). Sem impacto de "
              "segurança — apenas inconsistência de produto a uniformizar.",
         code="if (!LicenseManager.getInstance().isPremium()) return null; // RoleTwinManager.ts:224–226"),
    dict(id="F-03", cat="3", sev="Alta",
         file="electron/services/GitService.ts:114–124, 207–208, 279, 348–349, 385, 397",
         title="Command injection via shell no GitService (filePath/branch/message do renderer)",
         desc="<i>git()</i> interpola argumentos em shell (<i>execAsync(`git ${args}`)</i>). O escaping cobre "
              "apenas aspas duplas — <i>$(...)</i>, backticks e <i>$VAR</i> expandem dentro de <i>\"...\"</i>. "
              "Os IPCs <i>git:diff / git:commit / git:create-branch / git:switch-branch / git:stash</i> "
              "(<i>ipcHandlers.ts:7989–8034</i>) repassam strings cruas do renderer. Pré-requisito: renderer "
              "comprometido (XSS) ou janela maliciosa → <b>RCE no processo main</b>. O <i>commit</i> usa "
              "<i>git commit -F -</i> para a mensagem (correto), mas o <i>add -- \"...\"</i> anterior segue injetável.",
         code="return execAsync(`git ${args}`, { cwd: this.cwd, ... }); // GitService.ts:118\n"
              "const target = filePath ? `-- \"${filePath}\"` : ''; // :207\n"
              "await this.git(`checkout -b \"${name.replace(/\"/g, '\\\\\"')}\"`); // :385"),
    dict(id="F-05", cat="3", sev="Alta",
         file="electron/ipcHandlers.ts:610–622 e 714+ (vs :5229, :5455, :5512)",
         title="gemini-chat / gemini-chat-stream aceitam imagePaths sem validateImagePath",
         desc="Os dois canais de chat repassam <i>imagePaths</i> direto ao LLM, sem a validação de "
              "confinamento a <i>userData</i> que outros 3 handlers aplicam (<i>curlUtils.ts:285–374</i>: "
              "realpath + allowlist + bloqueio de symlink). Renderer/XSS pode apontar para arquivos "
              "arbitrários (ex.: chaves, backups) e exfiltrar o conteúdo via respostas do LLM.",
         code="const result = await appState.processingHelper.getLLMHelper()\n"
              "  .chatWithGemini(message, imagePaths, context, ...); // :620–622 sem validação"),
    dict(id="F-06", cat="3", sev="Alta",
         file="electron/ipcHandlers.ts:4344–4352 + electron/audio/whisper/modelManager.ts:90–92, 309–315",
         title="local-whisper-delete-model: traversal permite apagar fora do cache",
         desc="<i>modelIdToCacheDir()</i> devolve o id sem checar pertinência ao <i>MODEL_CATALOG</i>; o IPC "
              "repassa o id cru a <i>path.join(cacheDir, modelId) + rmSync(recursive)</i>. "
              "<i>modelId = ../../...</i> escapa do diretório de modelos e apaga dados arbitrários do usuário "
              "com privilégios do app.",
         code="function modelIdToCacheDir(modelId) { return modelId; } // modelManager.ts:90–92\n"
              "const modelDir = path.join(cacheDir, modelIdToCacheDir(modelId)); // :311\n"
              "fs.rmSync(modelDir, { recursive: true, force: true }); // :313"),
    dict(id="F-08", cat="3", sev="Média",
         file="electron/ipcHandlers.ts:7557–7573 + electron/repo-indexer/RepoIndexer.ts:22–23, 56–75",
         title="repo-index:scan lê qualquer caminho do disco sem confinamento",
         desc="O <i>repoPath</i> vindo do renderer é usado cru; <i>walkDir</i> faz <i>readdir/readFile</i> "
              "recursivo sem <i>realpath</i>, allowlist ou limite de tamanho/quantidade — leitura arbitrária "
              "de código-fonte/segredos + DoS de CPU/disco/DB vetorial. Condição de explorabilidade: flag "
              "<i>repoIndexer</i> ligada (<i>RepoIndexer.ts:42</i> — <i>scanRepo</i> retorna vazio se off).",
         code="safeHandle('repo-index:scan', async (_event, repoPath: string) => { // :7557\n"
              "  const indexer = new RepoIndexer({ repoPath, ... }); // :7560 sem validação"),
    dict(id="F-09", cat="3", sev="Média",
         file="electron/services/CalendarManager.ts:88–127",
         title="OAuth do calendário em loopback sem state/PKCE (CSRF local)",
         desc="O callback <i>http://localhost:11111/auth/callback</i> aceita <i>?code=</i> sem <i>state/nonce/"
              "PKCE</i> nem validação de <i>Origin</i>. Qualquer site aberto no navegador ou malware local pode "
              "chamar a URL com um <i>code</i> do atacante — fixação/login CSRF da conta Google conectada. "
              "Janela de exposição: 5 min por fluxo (:119–121).",
         code="const server = http.createServer(async (req, res) => { // :88\n"
              "  if (req.url?.startsWith('/auth/callback')) { // :90 sem state\n"
              "server.listen(11111, ...); // :123 porta fixa"),
    dict(id="F-01", cat="4", sev="Crítica",
         file=".env:1–11 (raiz do projeto)",
         title="Seis segredos reais de API/OAuth em .env na raiz do workspace",
         desc="GOOGLE_CLIENT_SECRET (:2), GROQ_API_KEY (:3), OPENAI_API_KEY sk-proj (:4), GEMINI_API_KEY (:6), "
              "DEEPGRAM_API_KEY (:10) e ELEVENLABS_API_KEY (:11), além de path disclosure (:7). "
              "Chaves de billing: uso indevido gera custo direto; OAuth secret permite takeover de consentimento. "
              "Verificado: <b>não commitado</b> (<i>.gitignore:119</i>; <i>git ls-files</i> vazio; fora do "
              "histórico) — exposição é em disco/backup/sync/prints. Placeholders (:5, :12–15, :36) estão OK.",
         code=".env:2  GOOGLE_CLIENT_SECRET=GOCSPX-… (OAuth, crítica)\n"
              ".env:3  GROQ_API_KEY=gsk_… | .env:4  OPENAI_API_KEY=sk-proj-…\n"
              ".env:6  GEMINI_API_KEY=AQ.Ab8… | .env:10 DEEPGRAM… | .env:11 ELEVENLABS sk_…"),
    dict(id="F-02", cat="4", sev="Crítica",
         file="tonal-history-500223-e0-a9ad29ad1df4.json:1–11",
         title="Service account GCP completa no workspace, referenciada em claro pelo .env",
         desc="Arquivo com <i>private_key</i> (1,7 KB), <i>private_key_id</i>, <i>client_email</i> e "
              "<i>project_id tonal-history-500223-e0</i>; o <i>.env:7</i> aponta o caminho absoluto "
              "(vaza usuário Windows <i>davif</i>). Quem lê o workspace assume o projeto GCP. Verificado: "
              "<b>não commitado</b> (<i>.gitignore:404</i>), mas sem criptografia em repouso.",
         code='"type": "service_account",            // :2\n'
              '"private_key": "-----BEGIN PRIVATE KEY-----…", // :5 (1679 chars)\n'
              '"client_email": "sdas-372@…iam.gserviceaccount.com"  // :6'),
    dict(id="F-13", cat="4", sev="Informativa",
         file="lemonsqueezy-server/test-key.pem:1–3",
         title="Chave privada Ed25519 de teste em disco",
         desc="Par de desenvolvimento citado no próprio <i>.gitignore (:9 *.pem)</i> — fora do git (verificado). "
              "Risco apenas se <i>LICENSE_SIGNING_KEY_PATH</i> apontar para ela em produção; o default é "
              "<i>~/.refract/license-signing-key.pem</i> (<i>server.js:62</i>) — OK hoje. Manter longe de prod.",
         code="-----BEGIN PRIVATE KEY----- // test-key.pem:1\n"
              "MC4C…Wmn                     // :2 (Ed25519 de teste)"),
    dict(id="F-11", cat="5", sev="Baixa",
         file="src/components/RefractInterface.tsx:215, 2580–2581 + package.json (ausente) + src/types/vendor.d.ts:1",
         title="DOMPurify usado corretamente, mas é dependência transitiva não declarada",
         desc="O único <i>innerHTML</i> com input do LLM é sanitizado (<i>marked.parse → DOMPurify.sanitize</i>), "
              "e o <i>ReactMarkdown</i> roda sem <i>rehype-raw</i> (HTML cru não executa) — <b>nenhum XSS "
              "explorável hoje</b>. A fragilidade: <i>dompurify</i> não está em <i>dependencies</i> (só "
              "transitiva via <i>package-lock.json:10053</i>, com shim em <i>vendor.d.ts:1</i>). Se a transitiva "
              "sumir, o build quebra — ou pior, alguém remove o import e o stream vira XSS fail-open.",
         code="import DOMPurify from 'dompurify'; // :215 (não declarada em package.json)\n"
              "const rawHtml = marked.parse(streamingTextRef.current, { async: false }); // :2580\n"
              "node.innerHTML = DOMPurify.sanitize(rawHtml); // :2581 OK"),
]

STRENGTHS = [
    ("Webhook íntegro e idempotente",
     "HMAC-SHA256 com <i>timingSafeEqual</i> + proteção de tamanhos diferentes (401 em vez de 500), "
     "idempotência por <i>event_key</i> e emissão única (<i>WHERE license_key IS NULL</i>) — "
     "<i>lemonsqueezy-server/server.js:145–154, 360–393</i>. Startup fail-fast sem segredos e sem chave "
     "privada (:72–89)."),
    ("Self-service de licença exige dupla posse",
     "<i>POST /v1/license/lookup</i> só responde com <b>email + hwid exatos</b> "
     "(<i>server.js:340–356</i>) — saber só o e-mail não basta."),
    ("Confinamento de paths onde importa",
     "<i>delete-screenshot</i> e <i>analyze-image-file</i> rejeitam tudo fora de <i>userData</i> "
     "(<i>ipcHandlers.ts:454–462, 594–601</i>); uploads de perfil usam allowlist via diálogo nativo com TTL "
     "(:6195–6219); 3 geradores validam imagem (:5229, :5455, :5512)."),
    ("XSS sob controle no frontend",
     "Zero <i>dangerouslySetInnerHTML</i> em <i>src/</i>; streaming sanitizado (:2580–2581); "
     "<i>ReactMarkdown</i> sem <i>rehype-raw</i>; renderer de markdown do phone com escape total; bloqueio de "
     "<i>javascript:</i> em URLs (<i>curlUtils.ts:207</i>); <i>open-external/mailto</i> com allowlist; "
     "<i>encodeURIComponent</i> no poll LS."),
    ("Premium verificado no main, não no navegador",
     "Todos os gates <i>isPremium/isTrial</i> da UI têm enforcement equivalente com <i>pro_required</i> no main "
     "(<i>modes:*</i> :6721–7159, <i>profile:*</i> :6221–6627); licença é criptografia Ed25519 offline verificada, "
     "não booleano do renderer."),
    ("Segredos locais bem guardados em runtime",
     "<i>CredentialsManager</i> criptografa com <i>safeStorage</i>, grava atômico (tmp+rename) e apaga o JSON "
     "legado; o <i>preload</i> expõe só booleanos <i>has*Key</i>, nunca a chave crua."),
    ("Cobertura real da auditoria",
     "5 rotas Fastify + ~215 canais <i>safeHandle</i> + IPCs diretos (<i>RoleTwin, PurchaseActivation, "
     "LemonSqueezy, Keybinds, main.ts</i>) + 2 loopbacks HTTP (<i>Calendar :11111</i>, <i>PhoneMirror</i>) + "
     "estáticos <i>site/serve-all</i> — todos percorridos; sem RLS/Supabase/multi-tenant (N/A declarado)."),
]

WEAKNESSES = [
    "O ativo que gera receita (license_key) vaza por ID enumerável no modo padrão (F-04).",
    "O processo main executa shell com input do renderer (F-03), apaga arquivos por id cru (F-06) e lê arquivos arbitrários via LLM (F-05).",
    "Chaves de billing reais dormem em texto claro no workspace (F-01, F-02).",
    "Fronteiras locais (loopback OAuth, sender IPC) confiam em quem chegar primeiro (F-09, F-10).",
]

RECOMMENDATIONS = [
    ("P1", "Rotacionar as 6 chaves do .env + a service account GCP; mover segredos para env do SO/keychain e "
           ".env.example só com placeholders; validação de startup que recuse placeholders em prod.", "F-01, F-02"),
    ("P2", "Ligar LS_REQUIRE_HWID=1 em prod; exigir o hwid da criação para TODAS as linhas (migração das legadas); "
           "rate-limit no POST /v1/checkout; trustProxy; checkout ids opacos.", "F-04, F-07, F-12"),
    ("P3", "Eliminar shell no GitService: execFile/spawn com argv + allowlist de filePath/branch; confinar set-cwd.", "F-03"),
    ("P4", "validateImagePath em gemini-chat/stream; allowlist MODEL_CATALOG no whisper-delete; confinar "
           "repo-index:scan (realpath + limites).", "F-05, F-06, F-08"),
    ("P5", "OAuth com state/PKCE + porta efêmera + check de Origin; validar event.sender nos IPCs sensíveis.", "F-09, F-10"),
    ("P6", "Declarar dompurify em dependencies; confinar test-key.pem ao dev; uniformizar gate do RoleTwin.", "F-11, F-13, F-14"),
]

ISSUES = [
    (1, "segredos", ["security", "critical"],
     [
        "# [Segurança] Segredos reais em disco: .env + service account GCP + chave de teste",
        "",
        "Labels sugeridas: `security`, `severity:critical`",
        "",
        "## Descrição do problema e por que é explorável",
        "",
        "O workspace contém segredos reais em texto claro: 6 chaves de API/OAuth no `.env` da raiz e uma service "
        "account GCP completa (`private_key` de 1,7 KB). Qualquer leitura do diretório (backup, sync em nuvem, "
        "screenshot, suporte remoto, infostealer) compromete billing (Groq/OpenAI/Gemini/Deepgram/ElevenLabs), "
        "consentimento OAuth e o projeto GCP. O `.env:7` ainda referencia a service account por caminho absoluto. "
        "A `test-key.pem` é de teste, mas é chave privada em disco.",
        "Verificado: nenhum dos três está no git (`.gitignore:119`, `:404`, `lemonsqueezy-server/.gitignore:9`; "
        "`git ls-files` vazio; fora do histórico) — o risco é disco/backup, não histórico público.",
        "",
        "## Evidência",
        "",
        "```",
        ".env:1  GOOGLE_CLIENT_ID=1858… (ID público, enumera projeto)",
        ".env:2  GOOGLE_CLIENT_SECRET=GOCSPX-… (OAuth, CRÍTICO)",
        ".env:3  GROQ_API_KEY=gsk_… (billing)",
        ".env:4  OPENAI_API_KEY=sk-proj-… (billing, 164 chars)",
        ".env:6  GEMINI_API_KEY=AQ.Ab8… (billing)",
        ".env:7  GOOGLE_APPLICATION_CREDENTIALS=C:\\Users\\…\\tonal-history-….json",
        ".env:10 DEEPGRAM_API_KEY=10d5… (40 hex)",
        ".env:11 ELEVENLABS_API_KEY=sk_9e78…",
        "tonal-history-500223-e0-a9ad29ad1df4.json:2-11 (type/PRIVATE KEY/client_email)",
        "lemonsqueezy-server/test-key.pem:1-3 (Ed25519 de teste)",
        "```",
        "",
        "## Impacto",
        "",
        "- Uso indevido de APIs pagas (custo direto) e abuso de quotas.",
        "- Takeover de consentimento OAuth Google; acesso ao projeto GCP via service account.",
        "- Assinatura de licenças se a chave real vazar por vizinhança (a de teste não assina prod hoje).",
        "",
        "## Sugestão de correção",
        "",
        "1. Rotacionar IMEDIATAMENTE as 6 chaves e a service account (revogar as antigas).",
        "2. Remover segredos do `.env` da raiz; usar env do SO/keychain; commitar só `.env.example`.",
        "3. Mover a service account para fora do repo com ACL restrita (ou workload identity).",
        "4. Garantir que `LICENSE_SIGNING_KEY_PATH` nunca aponte para `test-key.pem` em prod.",
        "5. Validação de startup que recuse placeholders (`your_*`) em produção.",
        "",
        "## Critérios de aceite",
        "",
        "- [ ] Chaves antigas revogadas nos provedores.",
        "- [ ] `grep` por `sk-proj|gsk_|GOCSPX|BEGIN PRIVATE` retorna só fixtures de teste.",
        "- [ ] `.env` sem valores reais; `.env.example` só com placeholders.",
        "- [ ] Service account fora do workspace (ou permissão mínima + rotação).",
        "- [ ] CI falha se placeholder for usado em prod.",
     ]),
    (2, "git-rce", ["security", "high"],
     [
        "# [Segurança] Command injection no GitService via interpolação em shell (RCE pelo renderer)",
        "",
        "Labels sugeridas: `security`, `severity:high`",
        "",
        "## Descrição do problema e por que é explorável",
        "",
        "`GitService.git()` executa `execAsync(`git ${args}`)` — shell real. O escaping cobre só aspas duplas, mas "
        "`$(...)`, backticks e `$VAR` expandem dentro de `\"...\"`. Os canais `git:diff`, `git:commit`, "
        "`git:create-branch`, `git:switch-branch`, `git:stash` e `git:set-cwd` repassam strings cruas do renderer. "
        "Pré-requisito: renderer comprometido (XSS) ou janela maliciosa → RCE no processo main.",
        "",
        "## Evidência",
        "",
        "```",
        "electron/services/GitService.ts:114-124",
        "  private async git(args: string) {",
        "    return execAsync(`git ${args}`, { cwd: this.cwd, ... });",
        "  }",
        "electron/services/GitService.ts:207-208",
        "  const target = filePath ? `-- \"${filePath}\"` : '';  // $(...) ainda expande",
        "electron/services/GitService.ts:279, 348-349, 385, 397 (mesmo padrão)",
        "electron/ipcHandlers.ts:7989-8034 (git:diff/commit/create-branch/switch-branch/stash/set-cwd)",
        "```",
        "PoC conceitual (NÃO executar em prod): `filePath = 'a$(calc).txt'` → o shell avalia `$(calc)`.",
        "",
        "## Impacto",
        "",
        "- Execução arbitrária de comandos com privilégios do usuário; leitura/escrita total de arquivos.",
        "- Transforma qualquer XSS futuro em comprometimento total do host.",
        "",
        "## Sugestão de correção",
        "",
        "1. Trocar `execAsync(string)` por `execFile('git', argv)` / `spawn` sem shell em todos os métodos.",
        "2. Validar `filePath` contra `git ls-files` + confinamento ao `cwd`; branch por allowlist "
        "(`^[A-Za-z0-9/_.-]+$`) + `git check-ref-format`.",
        "3. Confinar `set-cwd` a raízes permitidas.",
        "",
        "## Critérios de aceite",
        "",
        "- [ ] Nenhum `execAsync`/`execSync` com template string contendo input em `GitService.ts`.",
        "- [ ] `filePath='a$(id).txt'` e similares não executam nada (só erro de path inválido).",
        "- [ ] `git:diff` de arquivo válido continua funcionando.",
     ]),
    (3, "ls-hwid", ["security", "high"],
     [
        "# [Segurança] Bypass de hwid no poll de licença + checkout sem rate-limit (endurecer lemonsqueezy-server)",
        "",
        "Labels sugeridas: `security`, `severity:high`",
        "",
        "## Descrição do problema e por que é explorável",
        "",
        "(a) Com `LS_REQUIRE_HWID≠1` (padrão), checkouts sem hwid (clientes antigos gravam NULL) liberam a "
        "`license_key` para quem conhecer o checkout id — IDs LS sequenciais e enumeráveis, com oráculo 404/403/200. "
        "(b) `POST /v1/checkout` não tem rate-limit (as outras rotas têm) → spam de linhas `open` + custo de API. "
        "(c) Rate-limit em memória/por-IP sem `trustProxy` (spoof de XFF) e `=0` desativa; mesmo em modo estrito, "
        "qualquer hwid não-vazio libera linha legada.",
        "",
        "## Evidência",
        "",
        "```",
        "lemonsqueezy-server/server.js:65   STRICT_HWID default off",
        "lemonsqueezy-server/server.js:193-198 hwidAllowsAccess (bypass: ('','',false)===true)",
        "lemonsqueezy-server/server.js:281  hwid || null (linha legada nasce sem hwid)",
        "lemonsqueezy-server/server.js:294-310 GET /v1/checkout/:id/license devolve license_key",
        "lemonsqueezy-server/server.js:248  POST /v1/checkout sem preHandler (vs :294 e :340 com)",
        "lemonsqueezy-server/server.test.mjs:65-69 (bypass documentado em teste)",
        "```",
        "",
        "## Impacto",
        "",
        "- Vazamento de licenças pagas (bypass de pagamento) por enumeração de checkout ids.",
        "- DoS de disco/SQLite + custo de API LemonSqueezy via spam de checkouts.",
        "",
        "## Sugestão de correção",
        "",
        "1. `LS_REQUIRE_HWID=1` em prod + migração: exigir o hwid do POST para TODAS as linhas.",
        "2. `rateLimitPreHandler` no POST (+ captcha se o spam persistir).",
        "3. `trustProxy` + limite distribuído (ou documentar single-instance); recusar `=0` em prod.",
        "4. Considerar checkout ids opacos (UUID).",
        "",
        "## Critérios de aceite",
        "",
        "- [ ] `GET /:id/license` sem `?hwid=` correto retorna 403 para qualquer linha.",
        "- [ ] Linha legada (`hwid NULL`) + `?hwid=qualquer` retorna 403.",
        "- [ ] POST sob flood (>120/min/IP) retorna 429 sem inserir linhas.",
        "- [ ] `server.test.mjs` atualizado cobrindo os 3 casos.",
     ]),
    (4, "ipc-paths", ["security", "high"],
     [
        "# [Segurança] Validação de paths ausente em 3 IPCs: chat (leitura), whisper-delete, repo-scan",
        "",
        "Labels sugeridas: `security`, `severity:high`",
        "",
        "## Descrição do problema e por que é explorável",
        "",
        "Três canais confiam em path/id cru do renderer: (1) `gemini-chat/stream` repassa `imagePaths` ao LLM sem "
        "`validateImagePath` (leitura arbitrária + exfiltração via respostas); (2) `local-whisper-delete-model` faz "
        "`path.join(cache, modelId) + rmSync(recursive)` sem allowlist (traversal `../../` apaga dados); "
        "(3) `repo-index:scan` percorre `repoPath` arbitrário com `readdir/readFile` recursivo (leitura + DoS). "
        "O projeto JÁ tem o padrão correto — só não aplicado aqui.",
        "",
        "## Evidência",
        "",
        "```",
        "electron/ipcHandlers.ts:610-622  gemini-chat → chatWithGemini(message, imagePaths…) sem validação",
        "electron/ipcHandlers.ts:714+     gemini-chat-stream idem (vs :5229, :5455, :5512 que validam)",
        "electron/ipcHandlers.ts:4344-4352 local-whisper-delete-model → deleteModel(modelId) cru",
        "electron/audio/whisper/modelManager.ts:90-92 modelIdToCacheDir retorna id; :309-315 join+rmSync",
        "electron/ipcHandlers.ts:7557-7573 repo-index:scan → new RepoIndexer({ repoPath }) cru",
        "electron/repo-indexer/RepoIndexer.ts:22-23, 56-75 walkDir recursivo sem confinamento",
        "```",
        "",
        "## Impacto",
        "",
        "- Leitura de arquivos sensíveis e exfiltração via LLM; destruição de dados; DoS de CPU/disco.",
        "",
        "## Sugestão de correção",
        "",
        "1. Chamar `validateImagePath()` em `gemini-chat/stream` (rejeitar fora de userData).",
        "2. `deleteModel`: allowlist `id ∈ MODEL_CATALOG` + `path.resolve` contido no cache.",
        "3. `repo-index:scan`: `realpath` + confinamento a raízes configuradas + limite de arquivos/tamanho.",
        "",
        "## Critérios de aceite",
        "",
        "- [ ] `imagePaths` fora de userData rejeitado com erro.",
        "- [ ] `deleteModel('../../x')` e id fora do catálogo rejeitados; catálogo válido ok.",
        "- [ ] `repo-index:scan` fora das raízes rejeitado.",
        "- [ ] Testes de regressão espelhando `validateImagePath.test.mjs`.",
     ]),
    (5, "loopback-ipc", ["security", "medium"],
     [
        "# [Segurança] CSRF no OAuth loopback do calendário + IPCs sem checagem de remetente",
        "",
        "Labels sugeridas: `security`, `severity:medium`",
        "",
        "## Descrição do problema e por que é explorável",
        "",
        "(a) O callback OAuth `http://localhost:11111/auth/callback` aceita `?code=` sem `state/PKCE` nem Origin — "
        "site malicioso ou processo local injeta `code` do atacante (login CSRF/fixação, janela de 5 min). "
        "(b) `safeHandle()` não valida `event.sender`; só 2 handlers conferem remetente — qualquer janela/XSS invoca "
        "canais destrutivos (`flush-database`, `delete-meeting`, troca de API keys).",
        "",
        "## Evidência",
        "",
        "```",
        "electron/services/CalendarManager.ts:88-127 (loopback, :90 sem state, :123 porta fixa)",
        "electron/ipcHandlers.ts:105-111 safeHandle sem sender check (vs :385-419 que checam)",
        "electron/ipcHandlers.ts:5051 flush-database, :2208 delete-meeting (sem confirmação de origem)",
        "```",
        "",
        "## Impacto",
        "",
        "- Conexão da conta Google da vítima a credenciais do atacante; destruição de dados locais via IPC.",
        "",
        "## Sugestão de correção",
        "",
        "1. OAuth: `state` aleatório + PKCE, validar `state`, porta efêmera (0) e check de Origin; timeout curto.",
        "2. IPC: helper validando `event.sender` nos canais sensíveis; confirmação para `flush-database`.",
        "",
        "## Critérios de aceite",
        "",
        "- [ ] Callback com `state` errado/ausente rejeitado; fluxo válido funciona.",
        "- [ ] Canal sensível de webContents não autorizado rejeitado.",
        "- [ ] `flush-database` exige confirmação explícita.",
     ]),
    (6, "higiene", ["security", "low"],
     [
        "# [Segurança] Higiene: declarar dompurify + confinar chave de teste + uniformizar gate RoleTwin",
        "",
        "Labels sugeridas: `security`, `severity:low`",
        "",
        "## Descrição do problema e por que é explorável",
        "",
        "Três higienes de baixo risco: (a) `dompurify` — que sustenta TODA a sanitização do stream do LLM — é "
        "dependência transitiva não declarada (se sumir, o build quebra ou a sanitização some); (b) `test-key.pem` "
        "é privada em disco (hoje fora de prod, mas sem trava); (c) RoleTwin usa `isPremium()` puro enquanto o resto "
        "usa `isProOrTrialActive()` (inconsistência trial). Nenhum é explorável hoje: zero XSS ativo, default da "
        "chave correto, gates premium enforced no main.",
        "",
        "## Evidência",
        "",
        "```",
        "src/components/RefractInterface.tsx:215, 2580-2581 (import + uso correto)",
        "package.json (dompurify ausente) vs package-lock.json:10053 + src/types/vendor.d.ts:1",
        "lemonsqueezy-server/test-key.pem:1-3 + server.js:62 (default correto)",
        "electron/services/RoleTwinManager.ts:224-226 vs ipcHandlers.ts:148-169",
        "```",
        "",
        "## Impacto",
        "",
        "- Regressão futura: transitiva removida reabre XSS no stream; assinatura com chave de teste invalidaria "
        "licenças; UX inconsistente no trial.",
        "",
        "## Sugestão de correção",
        "",
        "1. `npm i -S dompurify` (+ `@types/dompurify` em dev); teste que falha se `sanitize` sumir do bundle.",
        "2. Mover `test-key.pem` para `fixtures/` com README dev-only + trava anti-prod.",
        "3. RoleTwin para `isProOrTrialActive()` (ou documentar a exceção).",
        "",
        "## Critérios de aceite",
        "",
        "- [ ] `dompurify` em `dependencies`; build sem hoisting ambíguo.",
        "- [ ] Fumaça: `<img src=x onerror=…>` no stream não executa.",
        "- [ ] Nenhum caminho de prod referencia `test-key.pem`.",
        "- [ ] Gate do RoleTwin documentado/testado.",
     ]),
]

CAT_NAMES = {"1": "BANCO SEM TRANCA (isolamento de inquilino/dono)",
             "2": "PERMISSÃO DEFINIDA NO NAVEGADOR",
             "3": "IDOR (objeto por ID sem checar dono)",
             "4": "CHAVES EXPOSTAS (hardcode)",
             "5": "INPUTS SEM TRATAMENTO (XSS)"}


def on_cover(canvas, doc):
    canvas.saveState()
    canvas.setFont("Helvetica", 7.5)
    canvas.setFillColor(colors.HexColor("#64748B"))
    canvas.drawCentredString(A4[0] / 2, 1.4 * cm, "Uso interno — contém trechos de código sensíveis redigidos.")
    canvas.restoreState()


def on_inner(canvas, doc):
    canvas.saveState()
    canvas.setFont("Helvetica", 7.5)
    canvas.setFillColor(colors.HexColor("#64748B"))
    canvas.drawString(2 * cm, A4[1] - 1.25 * cm, "Relatório de Auditoria de Segurança — refract")
    canvas.drawRightString(A4[0] - 2 * cm, A4[1] - 1.25 * cm, DATA_RELATORIO)
    canvas.drawCentredString(A4[0] / 2, 1.25 * cm,
                             f"Relatório de Auditoria de Segurança — refract  •  pág. {doc.page}")
    canvas.setStrokeColor(colors.HexColor("#E2E8F0"))
    canvas.line(2 * cm, A4[1] - 1.45 * cm, A4[0] - 2 * cm, A4[1] - 1.45 * cm)
    canvas.restoreState()


def main():
    make_charts()
    doc = SimpleDocTemplate(
        PDF_PATH, pagesize=A4, leftMargin=2 * cm, rightMargin=2 * cm,
        topMargin=1.9 * cm, bottomMargin=1.7 * cm,
        title="Relatório de Auditoria de Segurança — refract",
        author="Auditoria de código (assistente)")
    story = []

    # ---- capa
    story.append(Spacer(1, 2.2 * cm))
    story.append(Paragraph("Relatório de Auditoria de Segurança", S["Title"]))
    story.append(Spacer(1, 4 * mm))
    story.append(Paragraph("projeto <b>refract</b> — app desktop (Electron) + servidor de licenças",
                           S["Subtitle"]))
    story.append(Spacer(1, 6 * mm))
    story.append(HRFlowable(width="100%", thickness=1, color=colors.HexColor("#1E3A5F")))
    story.append(Spacer(1, 6 * mm))
    cover_rows = [
        [Paragraph("<b>Data</b>", S["Cell"]), Paragraph(DATA_RELATORIO, S["Cell"])],
        [Paragraph("<b>Escopo auditado</b>", S["Cell"]),
         Paragraph("Raiz do repo (app Electron + React 19 + SQLite local), "
                   "<i>lemonsqueezy-server/</i> (Fastify), <i>electron/</i> (main/IPC), "
                   "<i>src/</i> (renderer), deploy (<i>Dockerfile, fly.toml, CI</i>). Excluídos: "
                   "<i>node_modules, dist, release</i>.", S["Cell"])],
        [Paragraph("<b>Categorias</b>", S["Cell"]),
         Paragraph("1) Banco sem tranca &nbsp; 2) Permissão no navegador &nbsp; 3) IDOR &nbsp; "
                   "4) Chaves expostas &nbsp; 5) Inputs/XSS", S["Cell"])],
        [Paragraph("<b>Metodologia</b>", S["Cell"]),
         Paragraph("Somente achados verificados no código (arquivo:linha + trecho). "
                   "Mapeamento por stack na nota abaixo; o que não se aplica é declarado N/A com motivo.",
                   S["Cell"])],
    ]
    ct = Table(cover_rows, colWidths=[3.6 * cm, 13.4 * cm])
    ct.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#EFF6FF")),
        ("BOX", (0, 0), (-1, -1), 0.6, colors.HexColor("#93C5FD")),
        ("INNERGRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#BFDBFE")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
    ]))
    story.append(ct)
    story.append(Spacer(1, 6 * mm))
    story.append(Paragraph(
        "<b>Nota metodológica — como cada categoria foi mapeada para a stack.</b> O refract é um app "
        "<b>desktop single-user</b> (Electron 43 + React 19 + Vite; SQLite via <i>better-sqlite3</i> cru, sem ORM; "
        "auth por licença Ed25519 offline + trial local; deploy por <i>electron-builder</i> e CI GitHub; o único "
        "backend multiusuário é o <i>lemonsqueezy-server</i> em Fastify). Assim: <b>Cat. 1</b> foi avaliada no "
        "fator de posse <i>hwid</i> do servidor de licenças (o SQLite desktop é N/A por design — sem coluna de "
        "dono, isolamento via userData do SO); <b>Cat. 2</b> cruzou cada gate <i>isPremium/isTrial</i> do renderer "
        "com o enforcement no main; <b>Cat. 3</b> percorreu as 5 rotas Fastify + ~215 canais IPC + loopbacks; "
        "<b>Cat. 4</b> varreu código, configs, Docker/CI e histórico git; <b>Cat. 5</b> verificou sanitização no "
        "renderer e nos e-mails/templates.", S["Small"]))
    story.append(Spacer(1, 4 * mm))
    sev_line = " &nbsp; ".join(
        f"<font color='{SEV_COLORS[k]}'><b>■ {k}: {SEV_COUNT[k]}</b></font>" for k in SEV_ORDER)
    story.append(Paragraph(f"Total de achados: <b>14</b> &nbsp;—&nbsp; {sev_line}", S["Body"]))
    story.append(Paragraph("Detalhes, evidências linha a linha e 6 issues prontas para o GitHub nas seções seguintes.",
                           S["Small"]))

    # ---- resumo
    story.append(PageBreak())
    story.append(Paragraph("1 &nbsp; Resumo executivo", S["H1"]))
    story.append(Paragraph(
        "Quatro riscos centrais: <b>(i)</b> a licença paga vaza por ID enumerável no modo padrão do servidor "
        "(F-04); <b>(ii)</b> o processo main executa shell e apaga arquivos com input do renderer (F-03, F-06) e "
        "lê arquivos arbitrários via LLM (F-05); <b>(iii)</b> chaves de billing reais dormem em texto claro no "
        "workspace (F-01, F-02); <b>(iv)</b> fronteiras locais confiam em quem chegar primeiro (F-09, F-10). Em "
        "compensação, webhook, lookup de licença, gates premium e sanitização XSS estão corretos — ver §3.",
        S["Body"]))
    sdata = [[Paragraph("<b>Severidade</b>", S["Cell"]), Paragraph("<b>Qtd</b>", S["Cell"]),
              Paragraph("<b>Leitura</b>", S["Cell"])]]
    leitura = {"Crítica": "ação imediata (rotação de segredos).",
               "Alta": "correção no próximo ciclo; exploráveis com pré-requisito local.",
               "Média": "endurecimento programado.",
               "Baixa": "higiene / defesa em profundidade.",
               "Informativa": "sem risco direto; agrupada nas issues."}
    for k in SEV_ORDER:
        sdata.append([chip(k), Paragraph(f"<b>{SEV_COUNT[k]}</b>", S["Cell"]),
                      Paragraph(leitura[k], S["Cell"])])
    sdt = Table(sdata, colWidths=[3.6 * cm, 1.6 * cm, 11.8 * cm], repeatRows=1)
    sdt.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1E3A5F")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#CBD5E1")),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F1F5F9")]),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
    ]))
    story.append(sdt)
    story.append(Spacer(1, 4 * mm))
    story.append(Table([[Image(DONUT_PATH, width=8.2 * cm, height=6.0 * cm),
                         Image(BAR_PATH, width=8.2 * cm, height=4.7 * cm)]],
                       colWidths=[8.5 * cm, 8.5 * cm],
                       style=TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"),
                                         ("LEFTPADDING", (0, 0), (-1, -1), 2),
                                         ("RIGHTPADDING", (0, 0), (-1, -1), 2)])))
    story.append(Paragraph("Figura 1 — distribuição por severidade e por categoria "
                           "(Cat. 1 = Banco sem tranca · Cat. 2 = Permissão no navegador · "
                           "Cat. 3 = IDOR · Cat. 4 = Chaves expostas · Cat. 5 = Inputs/XSS). "
                           "F-04 é contabilizado na Cat. 1 (isolamento) e discutido também como IDOR.",
                           S["Caption"]))

    # ---- stack
    story.append(Paragraph("2 &nbsp; Stack detectada", S["H1"]))
    stack = [
        ("Linguagem", "TypeScript + Node ≥ 20 (CI com Node 24)."),
        ("Frontend", "React 19 + Vite 5 + Tailwind (<i>src/</i>); <i>renderer/</i> legado sem gates."),
        ("Backend desktop", "Electron 43 (main) — <i>ipcHandlers.ts</i> + <i>services</i> + <i>db</i> locais."),
        ("ORM / queries", "Nenhum — <i>better-sqlite3</i> + SQL cru com prepared statements; sem Supabase/Prisma."),
        ("Auth", "Licença Ed25519 offline (<i>REFRACT-PRO</i>) + trial local (<i>safeStorage</i>); sem JWT/sessão/RBAC."),
        ("Servidor remoto", "<i>lemonsqueezy-server</i> (Fastify 5 + <i>better-sqlite3</i>) — único multiusuário."),
        ("Deploy", "<i>electron-builder</i> (Win/macOS/Linux) + CI/release GitHub; LS via <i>Dockerfile</i> + "
                   "<i>fly.toml</i> (gru, SQLite em volume). Sem Helm/Terraform/docker-compose."),
    ]
    story.append(styled_table(
        ["Camada", "Detecção / evidência"],
        [[Paragraph(f"<b>{a}</b>", S["Cell"]), Paragraph(b, S["Cell"])] for a, b in stack],
        [3.6 * cm, 13.4 * cm]))

    # ---- fortes / fracos
    story.append(Paragraph("3 &nbsp; Pontos fortes (verificado, com evidência)", S["H1"]))
    for title, body in STRENGTHS:
        story.append(Paragraph(
            f"<b><font color='{C_FORTE}'>■</font> {html.escape(title)}</b> — {body}", S["Bullet"]))
    story.append(Paragraph("4 &nbsp; Pontos fracos (riscos centrais)", S["H1"]))
    for w in WEAKNESSES:
        story.append(Paragraph(f"<b><font color='{C_CRIT}'>■</font></b> {html.escape(w)}", S["Bullet"]))

    # ---- achados
    story.append(Paragraph("5 &nbsp; Achados detalhados por categoria", S["H1"]))
    story.append(Paragraph("Severidade, arquivo:linha exatos, descrição + por que é explorável. "
                           "Trechos de segredos aparecem redigidos (prefixo + …).", S["Small"]))
    for cat in ["1", "2", "3", "4", "5"]:
        items = [f for f in FINDINGS if f["cat"] == cat]
        story.append(Paragraph(
            f"5.{cat} &nbsp; Categoria {cat} — {CAT_NAMES[cat]} ({len(items)} achados)", S["H2"]))
        for f in items:
            head = Table([[chip(f["sev"]),
                           Paragraph(f"<b>{f['id']}</b> &nbsp; {html.escape(f['title'])}", S["Cell"])]],
                         colWidths=[2.5 * cm, 14.5 * cm])
            head.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"),
                                      ("LEFTPADDING", (0, 0), (-1, -1), 0),
                                      ("RIGHTPADDING", (0, 0), (-1, -1), 4),
                                      ("TOPPADDING", (0, 0), (-1, -1), 2),
                                      ("BOTTOMPADDING", (0, 0), (-1, -1), 2)]))
            snippet = "<br/>".join(html.escape(l) for l in f["code"].split("\n"))
            story.append(KeepTogether([
                head,
                Paragraph(f"<b>Arquivo:linha:</b> <font face='Courier' size='8'>"
                          f"{html.escape(f['file'])}</font>", S["Cell"]),
                Paragraph(f["desc"], S["Cell"]),
                Paragraph(f"<b>Trecho:</b><br/><font face='Courier' size='7.4'>{snippet}</font>",
                          S["Cell"]),
                Spacer(1, 2 * mm),
            ]))

    # ---- recomendações
    story.append(Paragraph("6 &nbsp; Recomendações priorizadas", S["H1"]))
    story.append(styled_table(
        ["Pri", "Ação", "Achados"],
        [[Paragraph(f"<b>{p}</b>", S["Cell"]), Paragraph(a, S["Cell"]), mono_file(c)]
         for p, a, c in RECOMMENDATIONS],
        [1.4 * cm, 12.4 * cm, 3.2 * cm]))

    # ---- issues
    story.append(Paragraph("7 &nbsp; Issues para o GitHub (texto pronto para copiar e colar)", S["H1"]))
    story.append(Paragraph("Cada issue está entre marcadores <b>--- ISSUE n ---</b> e <b>--- FIM ISSUE n ---</b>. "
                           "Achados triviais relacionados foram agrupados para evitar spam "
                           "(6 issues para 14 achados).", S["Small"]))
    for num, _slug, _labels, lines in ISSUES:
        for el in issue_block(num, lines):
            story.append(el)

    doc.build(story, onFirstPage=on_cover, onLaterPages=on_inner)
    print("PDF:", PDF_PATH)


if __name__ == "__main__":
    main()
