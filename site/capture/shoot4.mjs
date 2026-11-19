import { attach, hiRes } from './lib.mjs';
import { record } from './rec.mjs';
const VW = 1600, VH = 1000;
const { page } = await attach();
page.setDefaultTimeout(10000);
await hiRes(page, VW, VH, 2);
await page.waitForTimeout(1500);
const ed = page.locator('[contenteditable="true"]').last();
const eb = await ed.boundingBox();
const box = { x: Math.max(0, eb.x - 30), y: 40, width: VW - Math.max(0, eb.x - 30), height: VH - 40 };
console.log('rovo box', JSON.stringify(box));
await record(page, 'rovo', async () => {
  await page.waitForTimeout(800);
  await ed.click();
  await page.keyboard.type('@Walkdown', { delay: 70 });
  await page.waitForTimeout(2500);
  const sug = await page.locator('[role="option"],[role="menuitem"]').allInnerTexts().catch(() => []);
  console.log('suggestions', JSON.stringify(sug).slice(0, 300));
  await page.keyboard.press('Enter');
  await page.waitForTimeout(800);
  await page.keyboard.type(' What feeds RTU-2, and how loaded is its panel?', { delay: 35 });
  await page.waitForTimeout(600);
  await page.keyboard.press('Enter');
  // Wait for the answer to finish streaming (text stops changing).
  let last = '', stable = 0;
  for (let i = 0; i < 90 && stable < 4; i++) {
    await page.waitForTimeout(1000);
    const t = await page.locator('body').innerText();
    if (t === last) stable++; else stable = 0;
    last = t;
  }
  await page.waitForTimeout(1500);
}, box, { vw: VW, vh: VH });
await page.screenshot({ path: 's7-rovo.png', clip: box });
const t = await page.locator('body').innerText();
const k = t.lastIndexOf('RTU-2');
console.log(t.slice(Math.max(0, k - 1500), k + 600).replace(/\n+/g, ' | '));
process.exit(0);
