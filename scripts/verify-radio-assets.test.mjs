import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyRadioAssets } from './verify-radio-assets.mjs';
function server(change) {
  return async url => {
    const name = new URL(url).pathname;
    const type = /\.(m?js)$/.test(name) ? 'application/javascript' : name.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream';
    return change?.(name) ?? new Response(null, { status:200, headers: {'content-type':type,'cross-origin-opener-policy':'same-origin','cross-origin-embedder-policy':'require-corp'} });
  };
}
test('checks the real module MIME contract, including both mjs files', async () => {
  const resources = await verifyRadioAssets('https://example.org/', server());
  assert.equal(resources.length, 12);
  assert.ok(resources.includes('radio/uv5rh.py'));
});
test('rejects the production regression: 200 octet-stream for mjs', async () => {
  await assert.rejects(verifyRadioAssets('https://example.org/', server(name => name.endsWith('.mjs') ? new Response(null, {headers:{'content-type':'application/octet-stream'}}) : undefined)), /invalid module MIME/);
});
test('rejects SPA fallback HTML for a missing driver asset', async () => {
  await assert.rejects(verifyRadioAssets('https://example.org/', server(name => name.endsWith('engine.py') ? new Response(null, {headers:{'content-type':'text/html'}}) : undefined)), /SPA HTML/);
});
test('rejects missing module files', async () => {
  await assert.rejects(verifyRadioAssets('https://example.org/', server(name => name.endsWith('pyodide.asm.mjs') ? new Response(null, {status:404}) : undefined)), /HTTP 404/);
});
