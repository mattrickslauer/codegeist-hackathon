import { attach, hiRes } from './lib.mjs';
import { record } from './rec.mjs';
const VW = 1600, VH = 1000;
const { page } = await attach();
await hiRes(page, VW, VH, 2);
await page.goto('https://one-atlas-uyqa.atlassian.net/browse/FAC-279', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(12000);
// Collapse Jira's sidebar (hides other vendors' apps) and hide the dev-environment badge.
if (await page.getByText('For you', { exact: true }).first().isVisible().catch(() => false)) {
  await page.locator('body').click({ position: { x: 900, y: 600 } }).catch(() => {});
  await page.keyboard.press('['); await page.waitForTimeout(1500);
}
await page.evaluate(() => { for (const el of document.querySelectorAll('span,div')) if (el.childElementCount === 0 && el.textContent.trim() === 'DEV') el.style.display = 'none'; });
const box = { x: 0, y: 0, width: VW, height: VH };
await record(page, 'blocked', async () => {
  await page.waitForTimeout(800);
  const btn = page.getByRole('button', { name: /^To Do/ }).first();
  const b = await btn.boundingBox();
  await page.mouse.move(b.x - 120, b.y + 120); await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 20 });
  const it = page.getByText('In Progress', { exact: true }).first();
  for (let k = 0; k < 4; k++) {
    await btn.click(); await page.waitForTimeout(1500);
    if (await it.isVisible().catch(() => false)) break;
    await page.keyboard.press('Escape'); await page.waitForTimeout(600);
  }
  const ib = await it.boundingBox();
  await page.mouse.move(ib.x + 40, ib.y + ib.height / 2, { steps: 15 }); await page.waitForTimeout(400);
  await it.click();
  await page.waitForTimeout(5500);
}, box, { vw: VW, vh: VH });
await page.screenshot({ path: 's6-blocked.png', clip: box });
const flags = await page.locator('[role="alert"], [data-testid*="flag"]').allInnerTexts().catch(() => []);
console.log('alerts', JSON.stringify(flags).slice(0, 600));
const status = await page.evaluate(async () => (await (await fetch('/rest/api/3/issue/FAC-279?fields=status')).json()).fields.status.name);
console.log('status now', status);
process.exit(0);
