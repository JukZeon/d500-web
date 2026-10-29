// The Node decoder accepts SharedArrayBuffer views, unlike browser decoders.
// Exercise the production worker RPC with the browser's stricter contract.
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const source = (await readFile(new URL('../radio-core/worker.js', import.meta.url), 'utf8'))
  .replace(/^import .*?;\n/, '');
class BrowserTextDecoder extends TextDecoder {
  decode(input, options) {
    if (input?.buffer instanceof SharedArrayBuffer) throw new TypeError('ArrayBufferView must not be shared');
    return super.decode(input, options);
  }
}
function harness(response, options = {}) {
  const buffer = new SharedArrayBuffer(65544), control = new Int32Array(buffer, 0, 2), requests = [];
  const self = { postMessage(message) {
    assert.equal(message.type, 'io');
    requests.push(message.request);
    const bytes = new TextEncoder().encode(JSON.stringify(response));
    new Uint8Array(buffer, 8, bytes.length).set(bytes);
    Atomics.store(control, 1, options.length ?? bytes.length);
    Atomics.store(control, 0, 1);
  } };
  const rpc = vm.runInNewContext(source + '\nmailbox = testBuffer; rpc;', {
    self, testBuffer: buffer, SharedArrayBuffer, Int32Array, Uint8Array,
    TextDecoder: BrowserTextDecoder, Atomics: options.atomics ?? Atomics,
  });
  return { call: request => JSON.parse(rpc(JSON.stringify(request))), requests };
}

test('worker reads the initial UV-5RH buffer using a browser-compatible snapshot', () => {
  const data = [0, 0, 0, 0, 252, 255, 32, 226, 0, 0, 0, 2, 140, 128, 248, 8, 0, 0];
  const link = harness({ data });
  assert.deepEqual(link.call({ op: 'read', size: 256, timeout: 0.005 }), { data });
  assert.equal(link.requests[0].op, 'read');
});
test('worker decodes write acknowledgements and UTF-8 transport errors', () => {
  assert.deepEqual(harness({ written: 3 }).call({ op: 'write', data: [1, 2, 3] }), { written: 3 });
  assert.deepEqual(harness({ error: '写频线已断开' }).call({ op: 'read', size: 1 }), { error: '写频线已断开' });
  assert.deepEqual(harness({ data: [] }).call({ op: 'purge' }), { data: [] });
});
test('worker rejects invalid shared reply lengths', () => {
  for (const length of [-1, 65537]) assert.throws(() => harness({}, { length }).call({ op: 'purge' }), /串口缓冲区异常/);
});
test('worker reports a stalled serial response', () => {
  const atomics = { store: Atomics.store, wait: () => 'timed-out' };
  assert.throws(() => harness({}, { atomics }).call({ op: 'read', size: 1 }), /串口操作超时/);
});
