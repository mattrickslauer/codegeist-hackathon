// Unit tests for the work-order check's pure logic. Run: npm test (in forge/)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adfText, detectGuards, detectTags, evaluate } from '../src/match.js';

const decision = (over = {}) => ({
  id: 'd1', siteId: 's1', status: 'standing', statement: 'Do not shut down RTU-1 during business hours',
  reason: 'Only air supply for North tower L2-5', equipment: ['RTU-1'], guards: ['shut down', 'shutdown', 'isolate'],
  decidedBy: 'acc-1', decidedAt: '2026-03-03', ...over,
});

test('detectTags matches whole tags only (RTU-1 is not RTU-10 or XRTU-1)', () => {
  assert.deepEqual(detectTags('Shut down RTU-1 for coil cleaning', ['RTU-1', 'RTU-10']), ['RTU-1']);
  assert.deepEqual(detectTags('Replace belt on RTU-10', ['RTU-1', 'RTU-10']), ['RTU-10']);
  assert.deepEqual(detectTags('XRTU-1 and RTU-1A', ['RTU-1']), []);
  assert.deepEqual(detectTags('rtu-1, then hwb-2.', ['RTU-1', 'HWB-2']), ['RTU-1', 'HWB-2']);
  assert.deepEqual(detectTags('(RTU-1)', ['RTU-1']), ['RTU-1']);
});

test('detectGuards matches whole phrases, case-insensitive', () => {
  assert.deepEqual(detectGuards('Please SHUT DOWN the unit', ['shut down', 'isolate']), ['shut down']);
  assert.deepEqual(detectGuards('shutdownable? no', ['shutdown']), []);
  assert.deepEqual(detectGuards('isolate valve V-12', ['isolate']), ['isolate']);
});

test('conflict when the work order touches governed equipment with a guarded action', () => {
  const r = evaluate({ text: 'Shut down RTU-1 Tuesday 10am for coil cleaning', manualTags: [], decisions: [decision()], resolutions: {} });
  assert.deepEqual(r.touched, ['RTU-1']);
  assert.equal(r.conflicts.length, 1);
  assert.deepEqual(r.conflicts[0].guardsMatched, ['shut down']);
});

test('no conflict when the work touches the equipment but not a guarded action', () => {
  const r = evaluate({ text: 'Inspect RTU-1 filters (no outage)', manualTags: [], decisions: [decision()], resolutions: {} });
  assert.equal(r.conflicts.length, 0);
  assert.deepEqual(r.touched, ['RTU-1']);
});

test('a decision with no guarded actions blocks any work on its equipment', () => {
  const r = evaluate({ text: 'Inspect RTU-1 filters', manualTags: [], decisions: [decision({ guards: [] })], resolutions: {} });
  assert.equal(r.conflicts.length, 1);
});

test('no conflict for other equipment, superseded or withdrawn decisions', () => {
  const text = 'Shut down RTU-1 now';
  assert.equal(evaluate({ text: 'Shut down RTU-2', manualTags: [], decisions: [decision()], resolutions: {} }).conflicts.length, 0);
  assert.equal(evaluate({ text, manualTags: [], decisions: [decision({ status: 'superseded' })], resolutions: {} }).conflicts.length, 0);
  assert.equal(evaluate({ text, manualTags: [], decisions: [decision({ status: 'withdrawn' })], resolutions: {} }).conflicts.length, 0);
  assert.equal(evaluate({ text, manualTags: [], decisions: [decision({ status: 'proposed' })], resolutions: {} }).conflicts.length, 0);
});

test('manually tagged equipment counts even when the text never names it', () => {
  const r = evaluate({ text: 'Shut down the north air handler', manualTags: ['rtu-1'], decisions: [decision()], resolutions: {} });
  assert.deepEqual(r.touched, ['RTU-1']);
  assert.equal(r.conflicts.length, 1);
});

test('a reaffirmed conflict is acknowledged, not blocking', () => {
  const r = evaluate({
    text: 'Shut down RTU-1 Saturday', manualTags: [], decisions: [decision()],
    resolutions: { d1: { type: 'reaffirm', reason: 'Weekend, building empty', by: 'acc-2' } },
  });
  assert.equal(r.conflicts.length, 0);
  assert.equal(r.acknowledged.length, 1);
  assert.equal(r.acknowledged[0].resolution.reason, 'Weekend, building empty');
});

test('adfText flattens a Jira ADF description', () => {
  const adf = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Isolate ' }, { type: 'text', text: 'HWB-1' }] }] };
  assert.match(adfText(adf), /Isolate HWB-1/);
  assert.equal(adfText(null), '');
});

test('a guarded phrase split across formatted text runs is still detected', () => {
  const adf = { type: 'doc', content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'Please shut ' }, { type: 'text', text: 'down', marks: [{ type: 'strong' }] }, { type: 'text', text: ' RTU-1' }] },
    { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Saturday 06:00' }] }] }] },
  ] };
  const text = adfText(adf);
  assert.match(text, /Please shut down RTU-1/);
  assert.equal(evaluate({ text, manualTags: [], decisions: [decision()], resolutions: {} }).conflicts.length, 1);
});
