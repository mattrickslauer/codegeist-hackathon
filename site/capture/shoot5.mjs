// Clean RTU-1 card and decisions list from a fresh site page.
import { attach, appFrame, hiRes } from './lib.mjs';
const VW = 1600, VH = 1000;
const { page } = await attach();
page.setDefaultTimeout(15000);
await hiRes(page, VW, VH, 2);
await page.goto('https://one-atlas-uyqa.atlassian.net/jira/apps/0fa45447-08dc-430d-93a1-8501bd630d9d/27ecd14d-e533-4e81-bc50-2b949858eb13/sites/8bcb7377-f68e-4cc6-add8-c1a800be2fc1', { waitUntil: 'domcontentloaded' });
const f = await appFrame(page, 40000);
await f.getByText('Building', { exact: true }).first().waitFor({ timeout: 40000 });
await page.waitForTimeout(6000);
await f.getByText('×', { exact: true }).first().click({ timeout: 2000 }).catch(() => {});
await f.locator('body').evaluate(() => { const c = document.querySelector('canvas'); window.scrollBy(0, c.getBoundingClientRect().top - 8); });
await page.waitForTimeout(1200);
const vb = await f.locator('canvas').first().boundingBox();
const box = { x: vb.x, y: vb.y, width: vb.width, height: Math.min(vb.height, VH - vb.y) };
await f.getByPlaceholder('Find a tag').fill('RTU-1'); await page.keyboard.press('Enter');
await page.waitForTimeout(4500);
await page.screenshot({ path: 's3-rtu1.png', clip: box });
// Decisions tab: screenshot the iframe area.
await f.locator('body').evaluate(() => window.scrollTo(0, 0));
await f.getByText('Decisions', { exact: true }).first().click();
await page.waitForTimeout(3500);
const fb = await (await page.$('iframe')).boundingBox();
await page.screenshot({ path: 's8-decisions.png', clip: { x: fb.x, y: fb.y, width: fb.width, height: Math.min(fb.height, VH - fb.y) } });
process.exit(0);
