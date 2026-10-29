import { cp, mkdir, copyFile } from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..'), out = path.join(root, 'public/radio');
await mkdir(path.join(out, 'vendor'), { recursive: true });
for (const name of ['engine.py','losehu.py','uv5rh.py','browser.py','worker.js']) await copyFile(path.join(root, 'radio-core', name), path.join(out, name));
await cp(path.join(root, 'radio-core/vendor'), path.join(out, 'vendor'), { recursive: true });
await mkdir(path.join(out, 'pyodide'), { recursive: true });
for (const name of ['pyodide.mjs','pyodide.asm.mjs','pyodide.asm.wasm','python_stdlib.zip','pyodide-lock.json']) await copyFile(path.join(root, 'node_modules/pyodide', name), path.join(out, 'pyodide', name));
// Pyodide's MPL notices and corresponding source link are shipped alongside it.
await copyFile(path.join(root, 'radio-core/PYODIDE-NOTICE.txt'), path.join(out, 'pyodide/NOTICE.txt'));
await copyFile(path.join(root, 'radio-core/PYODIDE-LICENSE'), path.join(out, 'pyodide/LICENSE'));
