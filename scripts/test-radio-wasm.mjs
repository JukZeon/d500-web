// Exercise the same embedded codec in WebAssembly, without a browser or radio.
import { loadPyodide } from 'pyodide';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
const py=await loadPyodide();
py.FS.mkdirTree('/radio/vendor');
for(const file of ['engine.py','losehu.py','uv5rh.py','browser.py','vendor/chirp.zip']) py.FS.writeFile('/radio/'+file,new Uint8Array(await readFile(path.join(root,'radio-core',file))));
let writes=[];
py.registerJsModule('radio_io',{rpc:request=>{const input=JSON.parse(request);if(input.op==='write'){writes.push(input.data);return JSON.stringify({written:input.data.length});}return JSON.stringify({data:[6]});},progress:()=>{}});
py.runPython(`import sys, time, warnings, logging
sys.path.insert(0, '/radio')
warnings.filterwarnings('ignore')
logging.disable(logging.CRITICAL)
from browser import BrowserPipe
pipe=BrowserPipe(9600)
assert pipe.read(1)==bytes([6])
assert pipe.write(bytes([0xAB,0xCD]))==2
time.sleep(0.01)
import engine`);
if(JSON.stringify(writes)!=='[[171,205]]')throw new Error('BrowserPipe write mapping failed');
for(const [model,name] of [['uv5r','Baofeng_UV-5R'],['uvk5-stock','Quansheng_UV-K5'],['uvk5-losehu','Quansheng_UV-K5_losehu'],['uvk5-egzumer','Quansheng_UV-K5_egzumer']]){
  const data=await readFile(path.join(root,'.deploy/chirp-test-fixtures',name+'.img'));
  py.globals.set('model',model);py.globals.set('encoded',data.toString('base64'));
  const result=py.runPython(`radio=engine.load_image(model, encoded)
before=engine.image_bytes(radio)
doc=engine.document(radio,model)
restored, notes=engine.prepare(model, doc['image'])
assert before==engine.image_bytes(restored)
len(doc['channels'])`);
  console.log(`${model}: WASM codec roundtrip passed (${result} channels)`);
}
console.log('WASM BrowserPipe read/write and driver time.sleep passed');
const parent=await readFile(path.join(root,'.deploy/chirp-test-fixtures/Baofeng_UV-17Pro.img'));
py.globals.set('parent_image',parent.toString('base64'));
py.runPython(`import base64
from chirp import memmap
raw, metadata = engine.baofeng_uv17Pro.UV17Pro._strip_metadata(base64.b64decode(parent_image))
r = engine.driver('uv5rh')(None)
r._mmap = memmap.MemoryMapBytes(raw[:r.MEM_TOTAL])
r.process_mmap()
m = engine.cc.Memory()
m.number=1; m.freq=439125000; m.duplex='off'; m.name='中文名称测试'; m.mode='NFM'; m.extra=[]; m.empty=False
r.set_memory(m)
assert r.get_memory(1).name=='中文名称测试'
assert engine.features(r)['nameBytes']==12
before=engine.image_bytes(r)
c=engine.memory_dict(r,r.get_memory(1))
engine.apply_memory(r,c)
assert engine.image_bytes(r)==before
c['name']='ABCD一二三四'
engine.apply_memory(r,c)
assert r.get_memory(1).name=='ABCD一二三四'
restored=engine.load_image('uv5rh',engine.image_export(r))
assert engine.image_bytes(restored)==engine.image_bytes(r)`);
console.log('uv5rh: WASM GBK names, 12-byte budget, exact re-encode and IMG roundtrip passed');
