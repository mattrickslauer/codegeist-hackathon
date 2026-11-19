// Work-order scenes on FAC-279: panel still, comment still, blocked transition clip.
import { attach, hiRes } from './lib.mjs';
import { record } from './rec.mjs';
const VW = 1600, VH = 1000;
const { page } = await attach();
await hiRes(page, VW, VH, 2);
await page.goto('https://one-atlas-uyqa.atlassian.net/browse/FAC-279', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(14000);
const fr = page.frames().find(f => f.url().includes('atlassian-dev.net'));
const el = await fr.frameElement();
await el.evaluate(e => e.scrollIntoView({ block: 'center' }));
await page.waitForTimeout(2500);
await el.screenshot({ path: 's4-panel.png' });

// Comment: find the Walkdown comment block.
const c = page.getByText('this work order conflicts with a standing decision').first();
await c.scrollIntoViewIfNeeded(); await page.waitForTimeout(1500);
const cb = await c.boundingBox();
await page.screenshot({ path: 's5-comment.png', clip: { x: cb.x - 70, y: cb.y - 70, width: Math.min(1100, VW - cb.x + 70), height: cb.height + 110 } });

// Blocked transition: back to top, open status, pick In Progress.
await page.mouse.wheel(0, -4000); await page.waitForTimeout(1500);
const box = { x: 330, y: 0, width: VW - 330, height: VH };
await record(page, 'blocked', async () => {
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: /^To Do/ }).first().click();
  await page.waitForTimeout(1500);
  const opt = page.getByText(/In Progress|Start/).first();
  await opt.hover(); await page.waitForTimeout(500); await opt.click();
  await page.waitForTimeout(5000);
}, box, { vw: VW, vh: VH });
await page.screenshot({ path: 's6-blocked.png', clip: box });
process.exit(0);
