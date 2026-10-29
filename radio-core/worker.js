import { loadPyodide } from './pyodide/pyodide.mjs';
let runtime;
let mailbox;
const decoder = new TextDecoder();
function rpc(request) {
  const control = new Int32Array(mailbox, 0, 2);
  Atomics.store(control, 0, 0);
  self.postMessage({ type: 'io', request: JSON.parse(request) });
  const result = Atomics.wait(control, 0, 0, 60_000);
  if (result === 'timed-out') throw new Error('串口操作超时');
  const length = Atomics.load(control, 1);
  if (length < 0 || length > mailbox.byteLength - 8) throw new Error('串口缓冲区异常');
  // Browser TextDecoder rejects shared views; take an ordinary-buffer snapshot.
  return decoder.decode(new Uint8Array(mailbox, 8, length).slice());
}
async function initialize() {
  const py = await loadPyodide({ indexURL: new URL('./pyodide/', self.location.href).href, stdout: () => {}, stderr: text => self.postMessage({ type: 'diagnostic', text }) });
  py.FS.mkdirTree('/radio/vendor');
  const files = ['engine.py', 'losehu.py', 'uv5rh.py', 'browser.py', 'vendor/chirp.zip'];
  for (const name of files) {
    const response = await fetch(new URL(name, self.location.href));
    if (!response.ok) throw new Error(`驱动资源加载失败：${name}`);
    py.FS.writeFile('/radio/' + name, new Uint8Array(await response.arrayBuffer()));
  }
  py.registerJsModule('radio_io', { rpc, progress: (done, total) => self.postMessage({ type: 'progress', done, total }) });
  py.runPython(`import sys, warnings, logging
sys.path.insert(0, '/radio')
warnings.filterwarnings('ignore')
logging.disable(logging.CRITICAL)
from browser import perform`);
  return py;
}
self.onmessage = async ({ data }) => {
  const { id, request, buffer } = data;
  try {
    mailbox = buffer;
    runtime ??= initialize().catch(error => { runtime = undefined; throw error; });
    const py = await runtime;
    py.globals.set('request_json', JSON.stringify(request));
    const result = py.runPython('perform(request_json)');
    self.postMessage({ type: 'result', id, data: JSON.parse(result) });
  } catch (error) {
    self.postMessage({ type: 'error', id, error: String(error) });
  }
};
