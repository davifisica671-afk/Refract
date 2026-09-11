// Screenshots for blog verification. Run: node scripts/shot-blog.mjs
const { chromium } = require('playwright');

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  await p.goto('http://localhost:3000/blog', { waitUntil: 'networkidle' });
  await p.screenshot({ path: 'artifacts/site-v3-brand/blog-listing-full.png', fullPage: true });
  const counts = await p.evaluate(() => {
    const cards = [...document.querySelectorAll('#bpp-grid .bpp-card')];
    const btns = [...document.querySelectorAll('.z-10.flex.flex-wrap button')];
    const blogBtn = btns.find((x) => /blog/i.test(x.textContent));
    blogBtn.click();
    const visible = cards.filter((c) => c.style.display !== 'none');
    return { total: cards.length, visibleAfterBlogFilter: visible.length, allAreBlog: visible.every((c) => c.dataset.tags === 'Blog') };
  });
  console.log('filter test:', JSON.stringify(counts));
  await p.goto('http://localhost:3000/blog/building-refract-in-public', { waitUntil: 'networkidle' });
  await p.screenshot({ path: 'artifacts/site-v3-brand/blog-post.png' });
  await p.goto('http://localhost:3000', { waitUntil: 'networkidle' });
  await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await p.waitForTimeout(1500);
  const ok = await p.evaluate(() => !!document.querySelector('footer ul a[href="/blog"]'));
  console.log('footer blog link on home:', ok);
  await p.screenshot({ path: 'artifacts/site-v3-brand/home-footer.png' });
  await b.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
