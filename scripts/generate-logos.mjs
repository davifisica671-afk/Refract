/**
 * generate-logos.mjs
 * ===================
 * Gera TODAS as variações de logo do app Electron a partir de 2 masters:
 *   - assets/logo nova/white.png   → símbolo branco (transparente)
 *   - assets/logo nova/dark 2.png  → símbolo escuro (transparente)
 *
 * Saídas:
 *   1. Ícone do app (quadrado escuro #111 arredondado + símbolo branco):
 *      - assets/icon.png (512)
 *      - assets/icons/png/icon_{16,32,64,128,256,512,1024}x*.png
 *      - assets/icons/win/icon.ico (multi-size, PNG-embedded)
 *      - assets/icon.icns, assets/icons/mac/icon.icns,
 *        src/icons/AppIcon.icns, assets/refract.icns (cria o que faltava)
 *      - src/icons/icon_*.png (cópias de assets/icons/png)
 *      - src/icons/natively.iconset/* (10 arquivos para iconutil)
 *   2. Logo da UI (símbolo branco transparente):
 *      - src/components/icon.png (644)
 *      - src/assets/logo.png (644)
 *      - src/assets/logo.webp
 *      - src/assets/logowebsite.png (1024)
 *   3. Tray template (símbolo escuro, 22×22):
 *      - src/components/iconTemplate.png
 *      - assets/iconTemplate.png
 *
 * Uso: node scripts/generate-logos.mjs
 * Requer: sharp (já instalado). Não instala nada.
 */
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const SRC_DIR = path.join(ROOT, 'assets', 'logo nova');
const WHITE_SRC = path.join(SRC_DIR, 'white.png');
const DARK_SRC = path.join(SRC_DIR, 'dark 2.png');

const APP_BG = '#111111';          // fundo escuro do ícone (igual ao atual)
const APP_RADIUS = 0.24;           // raio dos cantos ≈ rx=96/400 da logo atual
const APP_SYMBOL_FILL = 0.62;      // símbolo ocupa ~62% do canvas do ícone
const UI_LOGO_SIZE = 644;          // tamanho da logo da UI atual
const WEBSITE_LOGO_SIZE = 1024;
const TRAY_SIZE = 22;

// ---------------------------------------------------------------------------
// Helpers de formato binário (Node puro — sem dependências novas)
// ---------------------------------------------------------------------------

/** Empacota PNGs (com resolução) em um .ico (PNG-embedded, suportado Vista+) */
function buildIco(entries) {
  // ICONDIR
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);            // reserved
  header.writeUInt16LE(1, 2);            // type = icon
  header.writeUInt16LE(entries.length, 4);
  const dir = Buffer.alloc(16 * entries.length);
  let offset = 6 + 16 * entries.length;
  entries.forEach((e, i) => {
    const d = 16 * i;
    dir.writeUInt8(e.size >= 256 ? 0 : e.size, d);       // width (0 = 256)
    dir.writeUInt8(e.size >= 256 ? 0 : e.size, d + 1);   // height
    dir.writeUInt8(0, d + 2);                            // color count
    dir.writeUInt8(0, d + 3);                            // reserved
    dir.writeUInt16LE(1, d + 4);                         // planes
    dir.writeUInt16LE(32, d + 6);                        // bit count
    dir.writeUInt32LE(e.png.length, d + 8);              // bytes in resource
    dir.writeUInt32LE(offset, d + 12);                   // image offset
    offset += e.png.length;
  });
  return Buffer.concat([header, dir, ...entries.map((e) => e.png)]);
}

/** Empacota PNGs (com tamanho lógico) em um .icns (PNG-compressed, macOS 10.7+) */
function buildIcns(entries) {
  const chunks = entries.map((e) => {
    const data = Buffer.concat([
      Buffer.from(e.type, 'ascii'),
      Buffer.alloc(4),
      e.png,
    ]);
    data.writeUInt32BE(data.length, 4); // length inclui os 8 bytes do header
    return data;
  });
  const total = 8 + chunks.reduce((s, c) => s + c.length, 0);
  const header = Buffer.alloc(8);
  header.write('icns', 0, 'ascii');
  header.writeUInt32BE(total, 4);
  return Buffer.concat([header, ...chunks]);
}

// ---------------------------------------------------------------------------
// Composição do ícone do app: quadrado escuro arredondado + símbolo branco
// ---------------------------------------------------------------------------

async function cropSymbol(srcPath, paddingRatio = 0.02) {
  const { data, info } = await sharp(srcPath).raw().toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height;
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 20) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  const pad = Math.round(Math.max(maxX - minX, maxY - minY) * paddingRatio);
  const left = Math.max(0, minX - pad);
  const top = Math.max(0, minY - pad);
  const width = Math.min(w - left, maxX - minX + 1 + pad * 2);
  const height = Math.min(h - top, maxY - minY + 1 + pad * 2);
  return sharp(srcPath).extract({ left, top, width, height });
}

/** Canvas quadrado escuro com cantos arredondados (SVG → sharp) */
function darkSquareBuffer(size) {
  const r = Math.round(size * APP_RADIUS);
  const svg = `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${size}" height="${size}" rx="${r}" fill="${APP_BG}"/>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/** Compõe o ícone do app em um dado tamanho (retorna PNG buffer).
 *
 * CORREÇÃO (2026-08-28): os masters em `assets/logo nova/` NÃO são símbolos
 * transparentes — são ícones de app JÁ FINALIZADOS (placa arredondada + glifo).
 * A versão anterior desta função embrulhava o master num segundo quadrado
 * escuro, produzindo "ícone dentro de ícone" — foi isso que apareceu na capa do
 * instalador. Agora o master é usado COMO ESTÁ, apenas redimensionado,
 * preservando os cantos arredondados e o glow do original.
 */
async function composeAppIcon(size, masterIcon) {
  // Sem .trim() aqui: cropSymbol() já recortou a moldura transparente. Um trim
  // extra estoura ("bad extract area") quando não resta borda a cortar.
  return masterIcon
    .clone()
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
}

/** Símbolo puro (transparente) em um canvas quadrado de tamanho fixo */
async function plainSymbol(size, symbol) {
  return symbol
    .clone()
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  if (!fs.existsSync(WHITE_SRC) || !fs.existsSync(DARK_SRC)) {
    console.error('ERRO: masters não encontrados em assets/logo nova/');
    process.exit(1);
  }

  const whiteSymbol = await cropSymbol(WHITE_SRC);
  const darkSymbol = await cropSymbol(DARK_SRC);
  const whiteMeta = await whiteSymbol.metadata();
  const darkMeta = await darkSymbol.metadata();
  console.log(`símbolo branco recortado: ${whiteMeta.width}x${whiteMeta.height}`);
  console.log(`símbolo escuro recortado: ${darkMeta.width}x${darkMeta.height}`);

  const SIZES = [16, 32, 64, 128, 256, 512, 1024];
  const out = (p) => path.join(ROOT, p);

  // ---- 1. Ícone do app: composições + PNGs por tamanho ---------------------
  const appPngs = {};
  for (const s of SIZES) {
    appPngs[s] = await composeAppIcon(s, darkSymbol);
  }
  // assets/icon.png (512 — ícone de janela/tray no runtime)
  fs.writeFileSync(out('assets/icon.png'), appPngs[512]);
  console.log('✓ assets/icon.png (512)');

  // assets/icons/png/ + src/icons/ (cópias idênticas, 7 tamanhos)
  for (const s of SIZES) {
    const name = `icon_${s}x${s}.png`;
    fs.writeFileSync(out(`assets/icons/png/${name}`), appPngs[s]);
    fs.writeFileSync(out(`src/icons/${name}`), appPngs[s]);
    console.log(`✓ assets/icons/png/${name} + src/icons/${name}`);
  }

  // ---- 2. .ico (Windows) ----------------------------------------------------
  const icoSizes = [16, 24, 32, 48, 64, 128, 256];
  const icoEntries = [];
  for (const s of icoSizes) {
    const png = await composeAppIcon(s, darkSymbol);
    icoEntries.push({ size: s, png });
  }
  fs.writeFileSync(out('assets/icons/win/icon.ico'), buildIco(icoEntries));
  console.log('✓ assets/icons/win/icon.ico (16-256 multi-size)');

  // ---- 3. .icns (macOS) — 4 arquivos, incl. criar assets/refract.icns ------
  // Tipos padrão PNG-compressed do ICNS
  const icnsTypes = [
    { type: 'icp4', size: 16 },
    { type: 'icp5', size: 32 },
    { type: 'icp6', size: 64 },
    { type: 'ic07', size: 128 },
    { type: 'ic08', size: 256 },
    { type: 'ic09', size: 512 },
    { type: 'ic10', size: 1024 },
  ];
  const icnsEntries = [];
  for (const { type, size } of icnsTypes) {
    const png = await composeAppIcon(size, darkSymbol);
    icnsEntries.push({ type, png });
  }
  const icns = buildIcns(icnsEntries);
  for (const target of [
    'assets/icon.icns',
    'assets/icons/mac/icon.icns',
    'src/icons/AppIcon.icns',
    'assets/refract.icns',
  ]) {
    fs.writeFileSync(out(target), icns);
    console.log(`✓ ${target}`);
  }

  // ---- 4. iconset (para iconutil no macOS) ---------------------------------
  const iconsetDir = out('src/icons/natively.iconset');
  fs.mkdirSync(iconsetDir, { recursive: true });
  const iconsetPairs = [
    ['icon_16x16.png', 16],
    ['icon_16x16@2x.png', 32],
    ['icon_32x32.png', 32],
    ['icon_32x32@2x.png', 64],
    ['icon_128x128.png', 128],
    ['icon_128x128@2x.png', 256],
    ['icon_256x256.png', 256],
    ['icon_256x256@2x.png', 512],
    ['icon_512x512.png', 512],
    ['icon_512x512@2x.png', 1024],
  ];
  for (const [name, size] of iconsetPairs) {
    const png = await composeAppIcon(size, darkSymbol);
    fs.writeFileSync(path.join(iconsetDir, name), png);
    console.log(`✓ src/icons/natively.iconset/${name}`);
  }

  // ---- 5. Logo da UI (símbolo branco transparente) --------------------------
  const uiLogo = await plainSymbol(UI_LOGO_SIZE, whiteSymbol);
  fs.writeFileSync(out('src/components/icon.png'), uiLogo);
  fs.writeFileSync(out('src/assets/logo.png'), uiLogo);
  console.log('✓ src/components/icon.png + src/assets/logo.png (644, branca)');

  const webp = await sharp(uiLogo).webp({ quality: 92 }).toBuffer();
  fs.writeFileSync(out('src/assets/logo.webp'), webp);
  console.log('✓ src/assets/logo.webp');

  const websiteLogo = await plainSymbol(WEBSITE_LOGO_SIZE, whiteSymbol);
  fs.writeFileSync(out('src/assets/logowebsite.png'), websiteLogo);
  console.log('✓ src/assets/logowebsite.png (1024, branca)');

  // ---- 6. Tray template (símbolo ESCURO 22×22, monocromático) ---------------
  const tray = await plainSymbol(TRAY_SIZE, darkSymbol);
  fs.writeFileSync(out('src/components/iconTemplate.png'), tray);
  fs.writeFileSync(out('assets/iconTemplate.png'), tray);
  console.log('✓ src/components/iconTemplate.png + assets/iconTemplate.png (22, escura)');

  // ---- 7. Validação de magic bytes dos binários ---------------------------
  const icoBuf = fs.readFileSync(out('assets/icons/win/icon.ico'));
  const icnsBuf = fs.readFileSync(out('assets/refract.icns'));
  const icoOk = icoBuf.length > 6 && icoBuf.readUInt16LE(0) === 0 && icoBuf.readUInt16LE(2) === 1;
  const icnsOk = icnsBuf.length > 8 && icnsBuf.toString('ascii', 0, 4) === 'icns';
  console.log(icoOk ? '✓ .ico válido (magic bytes OK)' : '✗ .ico INVÁLIDO');
  console.log(icnsOk ? '✓ .icns válido (magic bytes OK)' : '✗ .icns INVÁLIDO');

  console.log('\n✅ Todas as logos geradas com sucesso.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
