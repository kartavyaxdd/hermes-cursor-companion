const assert = require('node:assert/strict');
const { test } = require('node:test');
const { privateVoiceBackendArgs } = require('../dist-electron/hermes.js');

test('private voice backend uses isolated headless serve without moving the shared host', () => {
  assert.equal(typeof privateVoiceBackendArgs, 'function', 'a tested voice backend launch contract is required');
  const args = privateVoiceBackendArgs();
  assert.equal(args[0], 'serve');
  assert.ok(args.includes('--isolated'));
  assert.equal(args[args.indexOf('--host') + 1], '127.0.0.1');
  assert.equal(args[args.indexOf('--port') + 1], '19120');
  assert.ok(!args.includes('--stop'));
});
