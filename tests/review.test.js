import test from 'node:test';
import assert from 'node:assert/strict';
import { createReviewModel } from '../src/review.ts';
import { DIFF_VERSION, groups, sections } from '../src/sample-data.ts';

const { createReview, reduceReview, getVisibleSections, getProgress, getActiveSection } = createReviewModel({ version: DIFF_VERSION, groups, sections });

// These tests protect the reviewer's progress and the completeness of the diff.
test('a behavior can be followed from pipeline to UI, tests, and docs without marking unseen code reviewed', () => {
  let state = createReview();
  state = reduceReview(state, { type: 'group', id: 'failure-status' });
  const roles = [getActiveSection(state).role];
  for (let i = 0; i < 3; i++) {
    state = reduceReview(state, { type: 'next' });
    roles.push(getActiveSection(state).role);
  }
  assert.deepEqual(roles, ['Pipeline', 'UI', 'Tests', 'Docs']);
  assert.equal(getProgress(state).reviewed, 0);
});

test('reviewing one hunk does not mark a different behavior in the same file reviewed', () => {
  let state = createReview();
  state = reduceReview(state, { type: 'section', id: 'status-ui' });
  state = reduceReview(state, { type: 'set-reviewed', id: 'status-ui', reviewed: true });
  state = reduceReview(state, { type: 'group', id: 'retry-runs' });
  assert.equal(getProgress(state, 'failure-status').reviewed, 1);
  assert.equal(getProgress(state, 'retry-runs').reviewed, 0);
  assert.equal(state.reviewed.includes('retry-ui'), false);
});

test('ungrouped changes stay discoverable even after every guided behavior has been reviewed', () => {
  let state = createReview();
  for (const id of ['status-pipeline', 'status-ui', 'status-tests', 'status-docs', 'retry-pipeline', 'retry-ui', 'retry-tests', 'setup-docs']) {
    state = reduceReview(state, { type: 'set-reviewed', id, reviewed: true });
  }
  state = reduceReview(state, { type: 'view', view: 'ungrouped' });
  assert.deepEqual(getVisibleSections(state).map(section => section.id), ['ungrouped-config', 'ungrouped-readme']);
  assert.deepEqual(getProgress(state), { reviewed: 8, total: 10, percent: 80 });
});

test('search finds code across behaviors and review filters exclude the opposite status', () => {
  let state = createReview();
  state = reduceReview(state, { type: 'set-reviewed', id: 'status-ui', reviewed: true });
  state = reduceReview(state, { type: 'search', query: 'StatusBadge' });
  assert.deepEqual(getVisibleSections(state).map(section => section.id), ['status-ui']);
  state = reduceReview(state, { type: 'filter', filter: 'unreviewed' });
  assert.equal(getVisibleSections(state).length, 0);
  state = reduceReview(state, { type: 'search', query: '' });
  state = reduceReview(state, { type: 'view', view: 'all' });
  assert.equal(getVisibleSections(state).length, 9);
});

test('notes, checklists, theme, and review progress survive serialization without completing other sections', () => {
  let state = createReview();
  state = reduceReview(state, { type: 'note', id: 'status-ui', text: 'Check the failed-state color contrast.' });
  state = reduceReview(state, { type: 'check', id: 'status-ui', index: 0 });
  state = reduceReview(state, { type: 'set-reviewed', id: 'status-ui', reviewed: true });
  state = { ...state, theme: 'dark' };
  const restored = createReview(JSON.parse(JSON.stringify(state)));
  assert.equal(restored.notes['status-ui'], 'Check the failed-state color contrast.');
  assert.deepEqual(restored.checks['status-ui'], [0]);
  assert.deepEqual(restored.reviewed, ['status-ui']);
  assert.equal(restored.theme, 'dark');
});

test('stale diff data, malformed saved state, and unknown section actions cannot inflate progress', () => {
  assert.equal(getProgress(createReview(null)).reviewed, 0);
  const stale = createReview({ version: 'old-diff', reviewed: ['status-ui'] });
  assert.equal(getProgress(stale).reviewed, 0);
  let state = createReview();
  state = reduceReview(state, { type: 'set-reviewed', id: 'missing-section', reviewed: true });
  state = reduceReview(state, { type: 'section', id: 'missing-section' });
  assert.equal(getProgress(state).reviewed, 0);
  assert.equal(getActiveSection(state).id, 'status-pipeline');
});

test('navigation crosses behavior boundaries and stops safely after the last guided section', () => {
  let state = createReview();
  state = reduceReview(state, { type: 'section', id: 'status-docs' });
  state = reduceReview(state, { type: 'next' });
  assert.equal(getActiveSection(state).id, 'retry-pipeline');
  state = reduceReview(state, { type: 'section', id: 'setup-docs' });
  state = reduceReview(state, { type: 'next' });
  assert.equal(getActiveSection(state).id, 'setup-docs');
  state = reduceReview(state, { type: 'section', id: 'status-pipeline' });
  state = reduceReview(state, { type: 'previous' });
  assert.equal(getActiveSection(state).id, 'status-pipeline');
});

test('setting a review decision is idempotent and does not affect another hunk in the same file', () => {
  let state = createReview();
  state = reduceReview(state, { type: 'set-reviewed', id: 'status-ui', reviewed: true });
  state = reduceReview(state, { type: 'set-reviewed', id: 'status-ui', reviewed: true });
  assert.deepEqual(state.reviewed, ['status-ui']);
  assert.equal(state.reviewed.includes('retry-ui'), false);
  state = reduceReview(state, { type: 'set-reviewed', id: 'status-ui', reviewed: false });
  state = reduceReview(state, { type: 'set-reviewed', id: 'status-ui', reviewed: false });
  assert.deepEqual(state.reviewed, []);
  assert.equal(reduceReview(state, { type: 'set-reviewed', id: 'missing', reviewed: true }), state);
});
