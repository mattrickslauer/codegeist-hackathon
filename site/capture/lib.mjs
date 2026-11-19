import { chromium } from 'playwright-core';
export async function attach() {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
  const ctx = browser.contexts()[0];
  const pages = ctx.pages().filter(p => p.url().startsWith('http'));
  const page = pages[pages.length - 1];
  return { browser, ctx, page };
}
// The Forge Custom UI iframe (Walkdown renders inside it).
export async function appFrame(page, timeout = 30000) {
  const start = Date.now();
  let reloaded = false;
  while (Date.now() - start < timeout) {
    if (!reloaded && Date.now() - start > 3000 && page.frames().length < 2) {
      reloaded = true; await page.reload({ waitUntil: 'domcontentloaded' });
    }
    for (const f of page.frames()) {
      const u = f.url();
      if (u.includes('cdn.prod.atlassian-dev.net') || u.includes('forge') && !u.includes('atlassian.net/jira')) {
        try { if (await f.locator('body').count()) return f; } catch {}
      }
    }
    await page.waitForTimeout(500);
  }
  throw new Error('app iframe not found: ' + page.frames().map(f => f.url().slice(0, 80)).join(' | '));
}
export async function hiRes(page, w = 1440, h = 900, dpr = 2) {
  const s = await page.context().newCDPSession(page);
  await s.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: dpr, mobile: false });
  return s;
}
export async function resetMetrics(page) {
  const s = await page.context().newCDPSession(page);
  await s.send('Emulation.clearDeviceMetricsOverride');
}
