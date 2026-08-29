// Gera a arte do wizard NSIS a partir do ícone da marca.
// NSIS exige BMP: sidebar 164x314 e header 150x57.
import sharp from 'sharp';
import fs from 'node:fs';

fs.mkdirSync('build', { recursive: true });

const sidebarSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="164" height="314">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0b1020"/>
      <stop offset="0.55" stop-color="#141a33"/>
      <stop offset="1" stop-color="#0a0f1c"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.28" r="0.62">
      <stop offset="0" stop-color="#4b6bff" stop-opacity="0.40"/>
      <stop offset="1" stop-color="#4b6bff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="164" height="314" fill="url(#g)"/>
  <rect width="164" height="314" fill="url(#glow)"/>
  <text x="82" y="228" font-family="Segoe UI, sans-serif" font-size="19" font-weight="700"
        fill="#ffffff" text-anchor="middle">Refract</text>
  <text x="82" y="249" font-family="Segoe UI, sans-serif" font-size="9.5"
        fill="#8fa2d8" text-anchor="middle">private AI copilot</text>
</svg>`;

const headerSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="150" height="57">
  <rect width="150" height="57" fill="#0b1020"/>
</svg>`;

// sharp não escreve BMP (só heic/jpeg/png/webp/...). O NSIS exige BMP, então
// convertemos o RGB cru num BMP 24-bit sem compressão à mão — formato simples:
// header de 14 bytes + BITMAPINFOHEADER de 40 + linhas BGR de baixo para cima,
// cada linha alinhada em múltiplo de 4 bytes.
function rgbToBmp24(rgb, width, height) {
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const pixels = Buffer.alloc(rowSize * height, 0);
  for (let y = 0; y < height; y++) {
    const srcRow = y * width * 3;
    const dstRow = (height - 1 - y) * rowSize; // BMP é bottom-up
    for (let x = 0; x < width; x++) {
      const s = srcRow + x * 3;
      const d = dstRow + x * 3;
      pixels[d] = rgb[s + 2];     // B
      pixels[d + 1] = rgb[s + 1]; // G
      pixels[d + 2] = rgb[s];     // R
    }
  }
  const fileHeader = Buffer.alloc(14);
  fileHeader.write('BM', 0, 'ascii');
  fileHeader.writeUInt32LE(54 + pixels.length, 2);
  fileHeader.writeUInt32LE(54, 10);
  const dib = Buffer.alloc(40);
  dib.writeUInt32LE(40, 0);
  dib.writeInt32LE(width, 4);
  dib.writeInt32LE(height, 8);
  dib.writeUInt16LE(1, 12);
  dib.writeUInt16LE(24, 14);
  dib.writeUInt32LE(pixels.length, 20);
  return Buffer.concat([fileHeader, dib, pixels]);
}

async function writeBmp(pipeline, width, height, outPath) {
  const rgb = await pipeline
    .flatten({ background: { r: 11, g: 16, b: 32 } }) // sem alpha no BMP
    .removeAlpha()
    .raw()
    .toBuffer();
  fs.writeFileSync(outPath, rgbToBmp24(rgb, width, height));
}

const icon96 = await sharp('assets/icons/png/icon_128x128.png').resize(96, 96).png().toBuffer();
await writeBmp(
  sharp(Buffer.from(sidebarSvg)).composite([{ input: icon96, top: 60, left: 34 }]),
  164, 314, 'build/installerSidebar.bmp',
);

const icon40 = await sharp('assets/icons/png/icon_64x64.png').resize(40, 40).png().toBuffer();
await writeBmp(
  sharp(Buffer.from(headerSvg)).composite([{ input: icon40, top: 8, left: 9 }]),
  150, 57, 'build/installerHeader.bmp',
);

console.log('OK: build/installerSidebar.bmp (164x314) + build/installerHeader.bmp (150x57)');
