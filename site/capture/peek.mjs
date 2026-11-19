// Attach to the visible Chromium and screenshot the active tab: node peek.mjs [out.png] [gotoUrl]
import { chromium } from 'playwright-core';
const [out = 'peek.png', goto] = process.argv.slice(2);
const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
const ctx = browser.contexts()[0];
const pages = ctx.pages().filter(p => !p.url().startsWith('devtools'));
const page = pages[pages.length - 1];
if (goto) { await page.goto(goto, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(6000); }
await page.screenshot({ path: out });
console.log(JSON.stringify({ url: page.url(), title: await page.title(), tabs: pages.length }));
process.exit(0);
