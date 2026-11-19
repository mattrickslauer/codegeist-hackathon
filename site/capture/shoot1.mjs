// Building scenes: hero still, orbit clip, failure cascade clip, RTU-1 card, decisions list.
import { attach, appFrame, hiRes } from './lib.mjs';
import { record } from './rec.mjs';
const VW = 1600, VH = 1000;
const { page } = await attach();
await hiRes(page, VW, VH, 2);
let f = await appFrame(page);
// Fresh state: go back to the site page.
await page.reload({ waitUntil: 'domcontentloaded' });
f = await appFrame(page);
await page.waitForTimeout(4000);
if (!(await f.getByText('Building', { exact: true }).first().isVisible().catch(() => false))) {
  await f.getByText('Example Office Building').first().click();
}
await f.getByText('Building', { exact: true }).first().waitFor({ timeout: 30000 });
await page.waitForTimeout(6000);
// Close the "Try this" helper if present.
await f.getByText('×', { exact: true }).first().click({ timeout: 2000 }).catch(() => {});
const canvas = f.locator('canvas').first();
await canvas.scrollIntoViewIfNeeded();
await f.locator('body').evaluate(() => {
  const c = document.querySelector('canvas'); const r = c.getBoundingClientRect();
  window.scrollBy(0, r.top - 8);
});
await page.waitForTimeout(1500);
const vb = await canvas.boundingBox();
const box = { x: vb.x, y: vb.y, width: vb.width, height: Math.min(vb.height, VH - vb.y) };
console.log('viewer box', box);
await page.screenshot({ path: 's1-hero.png', clip: box });

// Orbit: slow horizontal drag across the canvas.
const cx = box.x + box.width * 0.55, cy = box.y + box.height * 0.55;
await record(page, 'orbit', async () => {
  await page.waitForTimeout(400);
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 0; i < 90; i++) { await page.mouse.move(cx + i * 3.5, cy - i * 0.3); await page.waitForTimeout(16); }
  await page.mouse.up();
  await page.waitForTimeout(800);
}, box, { vw: VW, vh: VH });

// Failure cascade.
await f.getByText('Try this').first().isVisible().catch(() => false);
await record(page, 'cascade', async () => {
  await page.waitForTimeout(500);
  const q = f.getByText('What goes dark if').first();
  if (await q.isVisible().catch(() => false)) await q.click();
  else { await f.getByPlaceholder('Find a tag').fill('MSB'); await page.keyboard.press('Enter'); await page.waitForTimeout(1500); await f.getByText('What if it fails?').first().click(); }
  await page.waitForTimeout(4500);
}, box, { vw: VW, vh: VH });
await page.screenshot({ path: 's2-cascade.png', clip: box });

// RTU-1 card.
await f.getByPlaceholder('Find a tag').fill('RTU-1'); await page.keyboard.press('Enter');
await page.waitForTimeout(3500);
await page.screenshot({ path: 's3b-rtu1-cascade.png', clip: box });
process.exit(0);
