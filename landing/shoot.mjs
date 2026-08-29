// Renderiza a landing em PNG via Playwright (o screenshot do preview-pane
// estava travando com backdrop-filter). Usa o chromium local já instalado.
import { chromium } from '@playwright/test';
import path from 'node:path';

const CHROME = path.join(process.env.LOCALAPPDATA || '', 'ms-playwright/chromium-1223/chrome-win64/chrome.exe');
const url = process.argv[2] || 'http://localhost:5188/';
const out = process.argv[3] || 'landing/shot-hero.png';
const full = process.argv[4] === 'full';

const browser = await chromium.launch({ executablePath: CHROME });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5 });
const p = await ctx.newPage();
await p.goto(url, { waitUntil: 'networkidle' });
// Full-page: o IntersectionObserver só revela o que entra na viewport; num
// print de página inteira as seções abaixo da dobra nunca "entram", então
// forçamos o .in pra capturar tudo.
if (full) await p.evaluate(() => document.querySelectorAll('[data-reveal]').forEach((e) => e.classList.add('in')));
await p.waitForTimeout(900); // deixa o reveal/aurora assentarem
await p.screenshot({ path: out, fullPage: full });
await browser.close();
console.log('escrito:', out, full ? '(full page)' : '(hero)');
