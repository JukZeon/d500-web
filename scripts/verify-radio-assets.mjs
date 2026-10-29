import { pathToFileURL } from 'node:url';

export async function verifyRadioAssets(base, fetcher = fetch) {
  const url = new URL(base);
  const modules = ['radio/worker.js', 'radio/pyodide/pyodide.mjs', 'radio/pyodide/pyodide.asm.mjs'];
  const resources = [...modules, 'radio/pyodide/pyodide.asm.wasm', 'radio/pyodide/python_stdlib.zip', 'radio/pyodide/pyodide-lock.json', 'radio/engine.py', 'radio/losehu.py', 'radio/losehu_profiles.py', 'radio/uv5rh.py', 'radio/browser.py', 'radio/vendor/chirp.zip'];
  const results = await Promise.all(resources.map(async name => {
    const response = await fetcher(new URL(name, url), { method: 'HEAD', signal: AbortSignal.timeout(20_000), cache: 'no-store' });
    if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
    const type = (response.headers.get('content-type') ?? '').split(';')[0].trim();
    if (modules.includes(name) && !['application/javascript', 'text/javascript'].includes(type)) throw new Error(`${name}: invalid module MIME ${type}`);
    if (name.endsWith('.wasm') && type !== 'application/wasm') throw new Error(`${name}: invalid WASM MIME ${type}`);
    if (type === 'text/html') throw new Error(`${name}: received SPA HTML instead of driver asset`);
    return name;
  }));
  const root = await fetcher(url, { method: 'HEAD', signal: AbortSignal.timeout(20_000), cache: 'no-store' });
  if (!root.ok) throw new Error(`Page: HTTP ${root.status}`);
  if (root.headers.get('cross-origin-opener-policy') !== 'same-origin' || root.headers.get('cross-origin-embedder-policy') !== 'require-corp') throw new Error('Missing browser isolation headers');
  return results;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.argv[2]) throw new Error('Usage: node scripts/verify-radio-assets.mjs https://your-host/');
  const results = await verifyRadioAssets(process.argv[2]);
  console.log(`Verified ${results.length} radio resources: HTTP status, module/WASM MIME types and isolation headers`);
}
