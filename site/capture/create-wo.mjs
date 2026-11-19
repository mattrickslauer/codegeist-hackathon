import { attach } from './lib.mjs';
const { page } = await attach();
const key = await page.evaluate(async () => {
  const body = {
    fields: {
      project: { key: 'FAC' }, issuetype: { id: '10017' },
      summary: 'Shut down RTU-1 Tuesday 10:00 for coil cleaning',
      description: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Quarterly coil cleaning on RTU-1. Unit off for about three hours, Tuesday from 10:00.' }] }] },
    },
  };
  const r = await fetch('/rest/api/3/issue', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Atlassian-Token': 'no-check' }, body: JSON.stringify(body) });
  const j = await r.json(); return j.key || JSON.stringify(j);
});
console.log('created', key);
// Wait for Walkdown's trigger to write its check.
for (let i = 0; i < 20; i++) {
  await page.waitForTimeout(3000);
  const st = await page.evaluate(async (k) => {
    const r = await fetch(`/rest/api/3/issue/${k}/properties/walkdown.check`, { headers: { Accept: 'application/json' } });
    if (!r.ok) return null; const j = await r.json(); return j.value;
  }, key);
  if (st) { console.log('check', JSON.stringify(st).slice(0, 400)); break; }
}
const comments = await page.evaluate(async (k) => (await (await fetch(`/rest/api/3/issue/${k}/comment`)).json()).comments?.length, key);
console.log('comments', comments);
process.exit(0);
