const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const project = path.resolve(__dirname, '..');
const ts = require(path.join(project, 'node_modules/typescript'));
const source = fs.readFileSync(path.join(project, 'electron/capture.ts'), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

function fixture(displayIds = [1, 2]) {
  let displayId = 1;
  const requests = [];
  const electron = {
    screen: {
      getCursorScreenPoint: () => ({ x: 0, y: 0 }),
      getDisplayNearestPoint: () => ({ id: displayId }),
      getAllDisplays: () => displayIds.map(id => ({ id })),
    },
    desktopCapturer: { getSources: request => new Promise(resolve => requests.push({ request, resolve })) },
    app: {},
  };
  const exports = {};
  vm.runInNewContext(code, {
    exports, require: name => name === 'electron' ? electron : require(name),
    Buffer, process, console,
  });
  const image = text => ({ isEmpty: () => false, toJPEG: () => Buffer.from(text) });
  const sources = (id, text) => [{ display_id: String(id), thumbnail: image(text) }];
  return { sampler: new exports.ScreenSampler(), requests, sources, setDisplay: id => { displayId = id; } };
}
const next = () => new Promise(resolve => setImmediate(resolve));

test('Windows Entire screen source without display_id is accepted only with one monitor', async () => {
  const single = fixture([1]);
  const shot = single.sampler.capture(1);
  await next();
  single.requests[0].resolve(single.sources('', 'single'));
  assert.equal((await shot).displayId, 1);
  const multiple = fixture();
  const ambiguous = multiple.sampler.capture(1);
  await next();
  multiple.requests[0].resolve(multiple.sources('', 'ambiguous'));
  assert.equal(await ambiguous, null);
});

test('capture remains bound to the monitor inspected before the pointer moves', async () => {
  const f = fixture();
  const capture = f.sampler.capture(1);
  f.setDisplay(2);
  await next();
  f.requests[0].resolve([...f.sources(2, 'wrong'), ...f.sources(1, 'right')]);
  assert.equal((await capture).displayId, 1);
});

test('simultaneous on-demand captures serialize and return their own fresh frame', async () => {
  const f = fixture();
  const first = f.sampler.capture();
  const second = f.sampler.capture();
  await next();
  assert.equal(f.requests.length, 1);
  f.requests[0].resolve(f.sources(1, 'first'));
  assert.equal((await first).dataUrl, 'data:image/jpeg;base64,Zmlyc3Q=');
  await next();
  assert.equal(f.requests.length, 2);
  f.requests[1].resolve(f.sources(1, 'second'));
  assert.equal((await second).dataUrl, 'data:image/jpeg;base64,c2Vjb25k');
});

test('pause clear invalidates an already-running capture', async () => {
  const f = fixture();
  const capture = f.sampler.capture();
  await next();
  f.sampler.clear();
  f.requests[0].resolve(f.sources(1, 'private'));
  assert.equal(await capture, null);
});

test('a missing requested monitor never returns another monitor image', async () => {
  const f = fixture();
  const capture = f.sampler.capture();
  await next();
  f.requests[0].resolve(f.sources(2, 'wrong monitor'));
  assert.equal(await capture, null);
});

test('changing monitor cannot reuse the preceding monitor cached screenshot', async () => {
  const f = fixture();
  const first = f.sampler.capture();
  await next();
  f.requests[0].resolve(f.sources(1, 'first'));
  await first;
  f.setDisplay(2);
  const second = f.sampler.current();
  await next();
  assert.equal(f.requests.length, 2);
  f.requests[1].resolve(f.sources(2, 'second'));
  assert.equal((await second).displayId, 2);
});
