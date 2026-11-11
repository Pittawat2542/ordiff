import test from 'node:test';
import assert from 'node:assert/strict';
import { createReviewModel } from '../src/review.ts';

const dataset = { version: 'real-v1', groups: [], sections: [
  { id: 'one', path: 'a.ts', role: 'UI', title: 'First', explanation: '', checklist: [], lines: [] },
  { id: 'two', path: 'a.ts', role: 'UI', title: 'Second', explanation: '', checklist: [], lines: [] },
] };

test('initial selection follows the dataset order regardless of section identifiers', () => {
  const model = createReviewModel({ ...dataset, sections: [
    ...dataset.sections,
    { id: 'status-ui', path: 'status.ts', role: 'UI', lines: [] },
  ] });
  assert.equal(model.getActiveSection(model.createReview()).id, 'one');
});

test('a repository without an agent plan starts in all changes and every hunk can be reviewed', () => {
  const model = createReviewModel(dataset);
  let state = model.createReview();
  assert.equal(state.view, 'all');
  assert.equal(model.getActiveSection(state).id, 'one');
  state = model.reduceReview(state, { type: 'set-reviewed', id: 'one', reviewed: true });
  assert.equal(model.getReviewStatus(state), 'reviewing');
  state = model.reduceReview(state, { type: 'set-reviewed', id: 'two', reviewed: true });
  assert.equal(model.getReviewStatus(state), 'complete');
  state = model.reduceReview(state, { type: 'set-reviewed', id: 'one', reviewed: false });
  assert.equal(model.getReviewStatus(state), 'reviewing');
});

test('zero changes has zero progress and is never treated as an approved or completed review', () => {
  const model = createReviewModel({ version: 'empty', groups: [], sections: [] });
  const state = model.createReview();
  assert.deepEqual(model.getProgress(state), { reviewed: 0, total: 0, percent: 0 });
  assert.equal(model.getReviewStatus(state), 'clean');
  assert.equal(model.getActiveSection(state), undefined);
  assert.doesNotThrow(() => model.reduceReview(state, { type: 'next' }));
});

test('new diff versions do not inherit old review decisions', () => {
  const first = createReviewModel(dataset);
  let state = first.createReview();
  state = first.reduceReview(state, { type: 'set-reviewed', id: 'one', reviewed: true });
  const next = createReviewModel({ ...dataset, version: 'real-v2' });
  assert.equal(next.getProgress(next.createReview(state)).reviewed, 0);
});

test('a shared hunk stays in the behavior the reviewer selected and counts once overall', () => {
  const model = createReviewModel({ ...dataset, groups: [
    { id: 'first', sections: ['one'] },
    { id: 'second', sections: ['one', 'two'] },
  ] });
  let state = model.createReview();
  state = model.reduceReview(state, { type: 'group', id: 'second' });
  state = model.reduceReview(state, { type: 'section', id: 'two' });
  state = model.reduceReview(state, { type: 'section', id: 'one' });
  assert.equal(state.groupId, 'second');
  state = model.reduceReview(state, { type: 'set-reviewed', id: 'one', reviewed: true });
  assert.equal(model.getProgress(state).reviewed, 1);
  assert.equal(model.getProgress(state, 'first').reviewed, 1);
  assert.equal(model.getProgress(state, 'second').reviewed, 1);
});
