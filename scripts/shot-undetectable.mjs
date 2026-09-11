// Screenshots the "undetectable" section viewport to verify the Rive animation renders.
import { chromium } from 'playwright';

const base = process.argv[2] || 'http://localhost:5000';
const out = process.argv[3] || 'artifacts/site-v3-brand/undetectable-after.png';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(base, { waitUntil: 'networkidle', timeout: 60000 });
await page.evaluate(() => {
  const el = [...document.querySelectorAll('h2,h3,p,span,div')].find((e) =>
    e.textContent?.trim().startsWith('Poof. Completely undetectable')
  );
  if (el) el.scrollIntoView({ block: 'center' });
});
await page.waitForTimeout(1000);
await page.mouse.move(720, 500);
await page.waitForTimeout(5000); // riv load + state machine + hover
await page.mouse.move(730, 450);
await page.waitForTimeout(3000);
await page.screenshot({ path: out });
console.log('saved:', out);
await browser.close();
