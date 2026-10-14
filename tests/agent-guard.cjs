// Pure guard fixtures. These do not exercise the desktop or Hermes backend.
const test = require('node:test');
const assert = require('node:assert/strict');
const { requireApprovedStep, requireSameTarget } = require('../dist-electron/agentGuard.js');
const { fractionToDisplayPoint } = require('../dist-electron/coordinates.js');

const target = { handle: '123', process: 'qa.exe', title: 'Disposable QA' };
const proposal = { id: 'approved-id', displayId: 1, explanation: 'Click QA', done: false, action: { kind: 'click', x: 0.5, y: 0.5 } };
const accepted = (changes = {}) => requireApprovedStep(
  changes.proposal === undefined ? proposal : changes.proposal,
  changes.target === undefined ? target : changes.target,
  changes.id === undefined ? 'approved-id' : changes.id,
  1000, changes.now === undefined ? 2000 : changes.now,
  !!changes.paused, !!changes.locked, !!changes.excluded,
);

test('only the pending approved action ID can run', () => {
  assert.equal(accepted(), target);
  assert.throws(() => accepted({ id: 'different' }), /no longer available/);
  assert.throws(() => accepted({ proposal: null }), /no longer available/);
  assert.throws(() => accepted({ target: null }), /no longer available/);
  assert.throws(() => accepted({ proposal: { ...proposal, action: null } }), /no longer available/);
});

test('expiry, pause, lock and exclusion reject actions', () => {
  assert.throws(() => accepted({ now: 31001 }), /expired/);
  for (const flag of ['paused', 'locked', 'excluded']) assert.throws(() => accepted({ [flag]: true }), /unavailable/);
});

test('a changed or excluded target is rejected', () => {
  assert.doesNotThrow(() => requireSameTarget(target, { ...target }, false));
  assert.throws(() => requireSameTarget(target, { ...target, handle: 'other' }, false), /changed/);
  assert.throws(() => requireSameTarget(target, { ...target, process: 'other.exe' }, false), /changed/);
  assert.throws(() => requireSameTarget(target, target, true), /changed/);
});

test('fractional points stay inside monitors with positive and negative origins', () => {
  assert.deepEqual(fractionToDisplayPoint({ x: 0, y: 0, width: 1920, height: 1080 }, 1, 1), { x: 1919, y: 1079 });
  assert.deepEqual(fractionToDisplayPoint({ x: -1280, y: 160, width: 1280, height: 1024 }, 0, 0), { x: -1280, y: 160 });
  assert.deepEqual(fractionToDisplayPoint({ x: -1280, y: 160, width: 1280, height: 1024 }, 1, 1), { x: -1, y: 1183 });
  assert.throws(() => fractionToDisplayPoint({ x: 0, y: 0, width: 100, height: 100 }, 1.1, 0), /Invalid/);
});
