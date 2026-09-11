// Finds all elements using blob: image sources on the site and reports their section context.
// Usage: node scripts/find-blob-images.mjs [baseURL]
import { chromium } from 'playwright';

const base = process.argv[2] || 'http://localhost:5000';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(base, { waitUntil: 'networkidle', timeout: 60000 });
// scroll through the page so lazy sections load
await page.evaluate(async () => {
  for (let y = 0; y < document.body.scrollHeight; y += 600) {
    window.scrollTo(0, y);
    await new Promise((r) => setTimeout(r, 120));
  }
  window.scrollTo(0, 0);
});
await page.waitForTimeout(2000);

const report = await page.evaluate(() => {
  const out = [];
  const describe = (el) => {
    const section = el.closest('section, [data-section]');
    const heading = section?.querySelector('h1,h2,h3,h4');
    return {
      tag: el.tagName,
      id: el.id || undefined,
      cls: (typeof el.className === 'string' ? el.className : '').slice(0, 120),
      src: el.src || el.currentSrc || (el.style?.backgroundImage || '').slice(0, 100),
      sectionText: (heading?.textContent || section?.textContent || '').trim().slice(0, 140),
      size: el.tagName === 'CANVAS' || el.tagName === 'IMG' ? `${el.width}x${el.height}` : undefined,
    };
  };
  for (const el of document.querySelectorAll('img,canvas,video,image,div[style*="blob:"]')) {
    const src = el.src || el.currentSrc || el.style?.backgroundImage || '';
    if (String(src).startsWith('blob:')) out.push(describe(el));
  }
  // also canvases w/o blob src (rive renders into canvas) — list with their sections
  for (const c of document.querySelectorAll('canvas')) {
    const d = describe(c);
    d.src = d.src || '(canvas)';
    if (!out.some((o) => o.cls === d.cls && o.sectionText === d.sectionText)) out.push(d);
  }
  return out;
});
console.log(JSON.stringify(report, null, 2));
await browser.close();
