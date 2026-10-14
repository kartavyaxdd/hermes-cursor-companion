const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseCompanionReply, partialAnswer } = require('../dist-electron/companion');
test('ordinary replies and action proposals share one response shape', () => {
  const reply = parseCompanionReply('{"answer":"Here is the button","points":[{"x":0.2,"y":0.3}],"action":null}', 1);
  assert.equal(reply.proposal, undefined);
  const action = parseCompanionReply('{"answer":"I can type that","action":{"kind":"type","x":0.2,"y":0.3,"text":"Hello"}}', 1);
  assert.equal(action.proposal.action.text, 'Hello');
  assert.equal(action.points.length, 1);
});
test('unsupported actions and invalid coordinates never become executable proposals', () => {
  for (const action of [{kind:'click',x:2,y:0}, {kind:'shell',x:.5,y:.5}, {kind:'click',x:'0.5',y:.5}, {kind:'key',x:.5,y:.5,key:'powershell'}]) {
    assert.throws(() => parseCompanionReply(JSON.stringify({answer:'Next step',action}),1));
  }
});
test('streamed JSON exposes answer text without exposing an incomplete action', () => {
  assert.equal(partialAnswer('{"answer":"Hello'), 'Hello');
  assert.equal(partialAnswer('{"answer":"Line\\nTwo", "action":'), 'Line\nTwo');
  assert.equal(partialAnswer('{"action":{"kind":"click"'), '');
});
