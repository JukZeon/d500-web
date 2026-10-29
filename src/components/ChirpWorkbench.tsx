import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Cable, Download, FileCode2, FileSpreadsheet, GitBranch, HardDrive, Library, Menu, Plus, Save, Upload, X } from 'lucide-react';
import { RADIO_MODELS, channelIssues, editedChannels, importChirpTable, isChirpDocument, parseChirpDraft, migrateUv5rhDraft, type ChirpModel, type ChirpDraft, type ChirpDocument, type ChirpChannel, type SettingEdits, type SettingNode } from '../lib/chirp';
import { download, parseProject } from '../lib/project';
import { parseDat } from '../lib/dat';
import { ChirpRuntime, directRadioSupported } from '../lib/chirp-runtime';
import { serialApi, type SerialPortLike } from '../lib/serial';
import { useAutosave } from '../lib/use-autosave';
import { applyChirpTransfer, baselineFeatures, channelIdentity, chirpStorage, managedChirp, managedD500, offlineDraft, parseLibrary, replaceChirpChannels } from '../lib/shared-channels';
import ChannelEditor from './ChannelEditor';
import { useSharedProfile } from '../lib/shared-context';
import WorkspaceNav, { VIEW_LABELS, type WorkbenchView } from './WorkspaceNav';
import { SharedLibraryPanel } from './SharedChannels';
import FrequencyPanel from './FrequencyPanel';
import WorkbenchDialog from './WorkbenchDialog';
import { radioLabel } from '../lib/radio-labels';
export function SettingsTree({ nodes, edits, onChange, disabled }: { nodes: SettingNode[]; edits: SettingEdits; onChange: (edits: SettingEdits) => void; disabled: boolean }) {
  return <>{nodes.map(node => node.children ? <details className="chirp-setting-group" key={node.key} open><summary>{radioLabel(node.label)}</summary><SettingsTree nodes={node.children} edits={edits} onChange={onChange} disabled={disabled} /></details> :
    <label className="chirp-field" key={node.key}><span title={node.doc?radioLabel(node.doc):undefined}>{radioLabel(node.label)}</span><span className="chirp-values">{node.values?.map((spec, i) => {
      const value = edits[node.key]?.[i] ?? spec.value;
      const change = (v: string | boolean | number) => { const next = [...(edits[node.key] ?? node.values!.map(s => s.value))]; next[i] = v; onChange({ ...edits, [node.key]: next }); };
      const locked = disabled || !spec.mutable;
      return spec.type === 'list' ? <select key={i} aria-label={radioLabel(node.label)} disabled={locked} value={String(value)} onChange={e => change(e.target.value)}>{spec.options?.map((v, n) => <option key={n} value={v}>{radioLabel(v)}</option>)}</select>
        : spec.type === 'boolean' ? <input key={i} aria-label={radioLabel(node.label)} type="checkbox" disabled={locked} checked={Boolean(value)} onChange={e => change(e.target.checked)} />
        : <input key={i} aria-label={radioLabel(node.label)} disabled={locked} type={spec.type === 'number' ? 'number' : 'text'} min={spec.min} max={spec.type === 'number' ? spec.max : undefined} step={spec.step} maxLength={spec.type === 'string' ? spec.max : undefined} value={String(value)} onChange={e => change(spec.type === 'number' ? Number(e.target.value) : e.target.value)} />;
    })}</span></label>)}</>;
}
function initial(model:ChirpModel):ChirpDraft {
 try {const saved=localStorage.getItem(chirpStorage(model));if(saved){const draft=parseChirpDraft(saved,model);if(!draft.document.image)return {...draft,document:{...draft.document,features:baselineFeatures(model)}};if(model==='uvk5-losehu'&&!draft.document.features.nameEncoding)return {...draft,document:{...draft.document,features:{...draft.document.features,nameBytes:13,nameEncoding:'gb2312'}}};return draft;}}catch{/* Keep a damaged saved draft untouched until the user imports a replacement. */}
 return offlineDraft(model);
}
export default function ChirpWorkbench({ model, switcher, onBusy, view, onView }: { model:ChirpModel; switcher:ReactNode; onBusy:(busy:boolean)=>void; view:WorkbenchView; onView:(view:WorkbenchView)=>void }) {
 const [draft,setDraft]=useState(()=>initial(model)),[past,setPast]=useState<ChirpDraft[]>([]),[future,setFuture]=useState<ChirpDraft[]>([]);
 const [connected,setConnected]=useState(false),[busy,setBusy]=useState(false),[sidebar,setSidebar]=useState(false),[progress,setProgress]=useState({done:0,total:1});
 const [message,setMessage]=useState(''),[error,setError]=useState(false),[group,setGroup]=useState('*');
 const [exportOpen,setExportOpen]=useState(false);
 const [pending,setPending]=useState<{channels:ChirpChannel[];name:string}|null>(null),[paste,setPaste]=useState<string|null>(null);
 const migrated=useRef(false);
 const port=useRef<SerialPortLike|null>(null),runtime=useRef(new ChirpRuntime()),file=useRef<HTMLInputElement>(null);
 const entry=RADIO_MODELS.find(m=>m.id===model)!,f=draft.document.features,channels=managedChirp(draft.channels,model),groups=[...new Set(channels.map(c=>c.group).filter(Boolean))].sort();
 const saving=useAutosave(chirpStorage(model),draft);
 const issues=channelIssues(draft.channels,f,draft.document.channels),changes=editedChannels(draft),settingsCount=Object.keys(draft.settings).length;
 const tell=(text:string,failed=false)=>{setMessage(text);setError(failed);};
 const commit=(next:ChirpDraft)=>{setPast(old=>[...old.slice(-49),draft]);setFuture([]);setDraft(next);};
 const shared=useSharedProfile(model,{name:draft.name,channels,features:f,apply:(rows,mode)=>commit(applyChirpTransfer(draft,rows,mode))});
 const undo=()=>{if(!past.length)return;setFuture([draft,...future]);setDraft(past[past.length-1]);setPast(past.slice(0,-1));};
 const redo=()=>{if(!future.length)return;setPast([...past,draft]);setDraft(future[0]);setFuture(future.slice(1));};
 useEffect(()=>{onBusy(busy);return()=>onBusy(false);},[busy,onBusy]);
 useEffect(()=>()=>runtime.current.dispose(),[]);
 useEffect(()=>{
  if(model!=='uv5rh'||!draft.document.image||f.nameEncoding==='gbk'||migrated.current)return;
  migrated.current=true;setBusy(true);tell('更新名称解码…');
  void runtime.current.execute<ChirpDocument>({action:'image',model,image:draft.document.image}).then(document=>{
   if(document.features.nameEncoding!=='gbk')throw Error('请刷新页面以载入中文驱动');
   commit(migrateUv5rhDraft(draft,document));tell('名称解码已更新');
  }).catch(e=>tell((e as Error).message,true)).finally(()=>setBusy(false));
 },[model,draft.document.image,f.nameEncoding]);

 useEffect(()=>{
  const handler=(event:KeyboardEvent)=>{if(!(event.ctrlKey||event.metaKey)||busy||view==='library'||document.querySelector('[role="dialog"]'))return;const editing=event.target instanceof HTMLElement&&['INPUT','SELECT','TEXTAREA'].includes(event.target.tagName);if(event.key.toLowerCase()==='s'){event.preventDefault();download(JSON.stringify(draft,null,2),draft.name+'.radio.json','application/json');}if(event.key.toLowerCase()==='z'&&!editing){event.preventDefault();if(event.shiftKey)redo();else undo();}};
  window.addEventListener('keydown',handler);return()=>window.removeEventListener('keydown',handler);
 });
 async function getPort(force=false){
  if(!directRadioSupported())throw Error('请使用桌面 Chrome / Edge，通过 HTTPS 或本机地址打开工作台');
  if(!port.current||force){const api=serialApi()!,authorized=force?[]:await api.getPorts?.()??[];port.current=authorized.length===1?authorized[0]:await api.requestPort();}
  setConnected(true);return port.current;
 }
 function acceptDocument(document:ChirpDocument,name?:string){
  if(!isChirpDocument(document)||document.model!==model)throw Error('驱动返回的型号／数据无效');
  let next:ChirpDraft={document,channels:document.channels.map(c=>{const previous=draft.channels.find(old=>!old.empty&&old.number===c.number&&channelIdentity({...c,mode:c.mode})===channelIdentity({...old,mode:old.mode}));return previous?{...c,group:previous.group,libraryId:previous.libraryId}:c;}),settings:{},name:name??entry.label};
  if(!draft.document.image&&channels.length)next=applyChirpTransfer(next,channels,'merge');
  commit(next);setPending(null);
 }
 async function run(action:'read'|'write'){
  setBusy(true);setProgress({done:0,total:1});tell(action==='read'?'读取中…':'写入中…');
  try{
   if(action==='write'&&(!draft.document.image||issues.length))throw Error(issues[0]??'请先载入整机配置');
   const selectedPort=await getPort();
   const result=await runtime.current.execute<ChirpDocument>({action,model,...(action==='write'?{image:draft.document.image,channels:changes,settings:draft.settings}:{})},(done,total)=>setProgress({done,total}),selectedPort);
   if(action==='read')download(Uint8Array.from(atob(result.image),c=>c.charCodeAt(0)),`${model}-原始备份-${Date.now()}.img`);
   const retained=!draft.document.image&&channels.length;
   acceptDocument(result,action==='write'?draft.name:undefined);
   tell(action==='read'?`读取完成${retained?`，保留 ${retained} 条信道编辑`:''}`:'写入完成');if(action==='read')onView('channels');
  }catch(e){if((e as Error).name==='NotFoundError')tell('已取消');else tell((e as Error).message,true);}finally{setBusy(false);}
 }
 async function exportFile(kind:'project'|'image'){
  if(kind==='project'){download(JSON.stringify(draft,null,2),draft.name+'.radio.json','application/json');return;}
  setBusy(true);
  try{
   if(!draft.document.image)throw Error('请先载入整机配置');if(issues.length)throw Error(issues[0]);
   const result=await runtime.current.execute<{document:ChirpDocument;warnings:string[]}>({action:'prepare',model,image:draft.document.image,channels:changes,settings:draft.settings});
   if(!isChirpDocument(result.document))throw Error('镜像生成失败');
   download(Uint8Array.from(atob(result.document.image),c=>c.charCodeAt(0)),draft.name+'.img');tell('IMG 已生成并通过驱动验证');
  }catch(e){tell((e as Error).message,true);}finally{setBusy(false);}
 }
 async function importFile(input:File){
  if(input.size>8_000_000){tell('文件超过 8 MB',true);return;}setBusy(true);
  try{
   if(/\.img$/i.test(input.name)){
    let raw='';for(const byte of new Uint8Array(await input.arrayBuffer()))raw+=String.fromCharCode(byte);
    const document=await runtime.current.execute<ChirpDocument>({action:'image',model,image:btoa(raw)});acceptDocument(document,input.name.replace(/\.img$/i,''));tell('整机配置已载入');return;
   }
   if(/\.dat$/i.test(input.name)){shared.transfer(managedD500(parseDat(await input.text(),input.name).channels));return;}
   if(/\.json$/i.test(input.name)){
    const text=await input.text(),value=JSON.parse(text);
    if(value.schema==='radio-channel-library-v1'){shared.store(parseLibrary(text).channels);onView('library');}
    else if([1,2].includes(value.schema)){shared.transfer(managedD500(parseProject(text).channels));}
    else {const next=parseChirpDraft(text,value.document?.model);if(next.document.model===model){commit(next);tell('方案已载入');}else shared.transfer(managedChirp(next.channels,next.document.model));}
   }else if(/\.(xlsx|xls|csv|tsv)$/i.test(input.name))setPending({channels:importChirpTable(await input.arrayBuffer(),f),name:input.name});
   else throw Error('支持 IMG / DAT / JSON / XLSX / CSV / TSV');
  }catch(e){tell((e as Error).message,true);}finally{setBusy(false);if(file.current)file.current.value='';}
 }
 function acceptTable(replace:boolean){if(!pending)return;commit(applyChirpTransfer(draft,managedChirp(pending.channels,model),replace?'replace':'merge'));setPending(null);onView('channels');tell('信道已导入');}
 const changeView=(next:WorkbenchView)=>{onView(next);setSidebar(false);};
 return <div className={`app unified-app ${sidebar?'sidebar-open':''}`} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();if(!busy&&e.dataTransfer.files[0])void importFile(e.dataTransfer.files[0]);}}>
  <aside className="sidebar" inert={busy}><WorkspaceNav view={view} onView={changeView} switcher={switcher} count={channels.length} libraryCount={shared.library.channels.length} groups={groups} group={group} onGroup={setGroup} busy={busy} connected={connected}/></aside>
  <div className="workspace-shell"><header className="topbar"><div className="breadcrumb"><button className="icon-btn" aria-label="打开侧栏" onClick={()=>setSidebar(!sidebar)}><Menu size={18}/></button><strong>{VIEW_LABELS[view]}</strong><span className="save-status">{saving}</span></div><div className="topbar-right"><>{view!=='library'&&<><button className="btn" disabled={busy} onClick={()=>file.current?.click()}><Upload size={15}/>导入</button><button className="btn" disabled={busy} onClick={()=>setExportOpen(true)}><Download size={15}/>导出</button></>}</><button className="btn primary" disabled={busy} onClick={()=>onView('radio')}><Cable size={15}/>读写电台</button><a className="github-link" href="https://github.com/JukZeon/d500-web" target="_blank" rel="noreferrer" aria-label="项目 GitHub"><GitBranch size={16}/><span>GitHub</span></a></div></header>
   <main><input className="file-input" type="file" ref={file} aria-label="导入信道文件" accept=".img,.dat,.json,.xlsx,.xls,.csv,.tsv" onChange={e=>e.target.files?.[0]&&void importFile(e.target.files[0])}/>
    {view!=='library'&&<section className="document-bar" inert={busy}><input aria-label="方案名称" className="project-name" value={draft.name} onChange={e=>commit({...draft,name:e.target.value})}/><span>{entry.variant} · {channels.length} / {f.bounds[1]-f.bounds[0]+1} 信道</span><span className={`tag ${draft.document.image?'':'muted'}`}>{draft.document.image?'已载入整机配置':'信道草稿'}</span><span className="chirp-muted">{draft.document.firmware}</span></section>}
    {message&&<div role={error?'alert':'status'} className={`chirp-message ${error?'error':''}`}>{message}<button className="icon-btn" aria-label="关闭提示" onClick={()=>setMessage('')}><X size={14}/></button></div>}
    {pending&&<section className="chirp-import"><strong>导入 {pending.channels.length} 条信道</strong><div className="chirp-preview">{pending.channels.slice(0,100).map(c=><div key={c.number}><span>{c.number}</span><strong>{c.name||'未命名'}</strong><span className="mono">{c.rx} → {c.tx||'仅接收'}</span></div>)}</div><div className="chirp-actions"><button className="btn" onClick={()=>setPending(null)}>取消</button><button className="btn" onClick={()=>acceptTable(false)}>按编号合并</button><button className="btn primary" onClick={()=>acceptTable(true)}>替换信道</button></div></section>}
    {view==='library'&&<SharedLibraryPanel/>}
    {view==='channels'&&<><ChannelEditor channels={channels} model={model} features={f} original={draft.document.channels} disabled={busy} groupFilter={group} onGroupFilter={setGroup} onChange={rows=>commit({...draft,channels:replaceChirpChannels(draft.channels,rows,f)})} onStore={shared.store} onTransfer={shared.transfer} undo={undo} redo={redo} canUndo={!!past.length} canRedo={!!future.length} extra={row=>{const channel=draft.channels.find(c=>c.number===row.number);return channel?.extra.length?<details><summary>机型参数</summary><SettingsTree nodes={channel.extra} edits={channel.extraEdits??{}} disabled={busy} onChange={extraEdits=>commit({...draft,channels:draft.channels.map(c=>c.number===row.number?{...c,extraEdits}:c)})}/></details>:null;}}/><div className="channel-bottom-actions"><button className="text-btn" onClick={()=>setPaste('')}>粘贴表格</button><span className="chirp-muted">{f.bounds[0]}–{f.bounds[1]} · 名称 {f.nameBytes?`${f.nameBytes} 字节`: `${f.nameLength} 位`}</span></div></>}
    {view==='spectrum'&&<FrequencyPanel channels={channels} onOpen={()=>onView('channels')}/>}
    {view==='settings'&&<section className="chirp-settings"><h2>电台设置</h2>{!draft.document.image?<div className="channel-empty"><h3>载入这台电台的配置</h3><p>读取电台或导入 IMG，编辑对应的整机设置。</p><button className="btn" onClick={()=>onView('radio')}>读取电台</button><button className="btn" onClick={()=>file.current?.click()}>导入 IMG</button></div>:<>{draft.document.settingsLimited&&<p className="chirp-message">{draft.document.settingsCoverage==='basic'?'基本设置可编辑，其余配置保留。':'该版本暂支持信道编辑。'}</p>}<SettingsTree nodes={draft.document.settings} edits={draft.settings} disabled={busy} onChange={settings=>commit({...draft,settings})}/></>}</section>}
    {view==='files'&&<section className="file-list"><article><FileCode2 size={22}/><div><h2>整机镜像 IMG</h2><p>{draft.document.image?'信道与机型配置':'尚未载入整机配置'}</p></div><button className="btn" onClick={()=>file.current?.click()}>导入文件</button><button className="btn" disabled={!draft.document.image||busy} onClick={()=>void exportFile('image')}>导出 IMG</button></article><article><HardDrive size={22}/><div><h2>完整方案</h2><p>信道、设置修改、分组与备注</p></div><button className="btn" onClick={()=>void exportFile('project')}>下载备份</button></article><article><Library size={22}/><div><h2>共享信道库</h2><p>跨型号管理信道</p></div><button className="btn" onClick={()=>onView('library')}>打开信道库</button></article><article><FileSpreadsheet size={22}/><div><h2>表格导入</h2><p>XLSX / CSV / TSV</p></div><button className="btn" onClick={()=>file.current?.click()}>选择表格</button><button className="btn" onClick={()=>setPaste('')}>粘贴表格</button></article><article><Plus size={22}/><div><h2>新建方案</h2></div><button className="btn" onClick={()=>{commit(offlineDraft(model));onView('channels');}}>新建</button></article></section>}
    {view==='radio'&&<section className="chirp-radio"><h2>{entry.label} · {entry.variant}</h2><div className="chirp-connect"><button className="btn" disabled={busy} onClick={()=>void getPort(true).then(()=>tell('写频线已连接')).catch(e=>(e as Error).name!=='NotFoundError'&&tell((e as Error).message,true))}><Cable size={15}/>{connected?'更换写频线':'连接写频线'}</button><span className="chirp-muted">{connected?'写频线已授权':'Chrome / Edge'}</span></div><div className="radio-warning"><strong>⚠️ 刷写有风险，请先备份电台原始配置。</strong><span>使用本软件造成的数据丢失、设备损坏等后果由使用者自行承担，作者不承担责任。</span></div><div className="chirp-actions"><button className="btn" disabled={busy} onClick={()=>void run('read')}><Download size={15}/>读取电台</button><button className="btn primary" disabled={busy||!draft.document.image||!!issues.length} onClick={()=>void run('write')}><Upload size={15}/>写入电台</button><button className="btn" disabled={busy||!draft.document.image} onClick={()=>void exportFile('image')}>导出 IMG</button></div><p className="chirp-muted chirp-guide">{changes.length} 条信道修改 · {settingsCount} 项设置修改。按驱动范围写入，不自动回读。</p>{!draft.document.image&&<p className="import-note">写入前需载入该机的整机配置，已有信道编辑会保留。</p>}{issues.length>0&&<details className="chirp-issues"><summary>{issues.length} 个待调整项</summary>{issues.map((s,i)=><p key={i}>{s}</p>)}</details>}{busy&&<div className="chirp-progress"><progress value={progress.done} max={progress.total}/><span>{Math.round(progress.done/progress.total*100)}%</span></div>}<details className="chirp-trace"><summary>通信记录</summary><button className="text-btn" disabled={busy} onClick={()=>download(JSON.stringify({model,entries:runtime.current.trace},null,2),`${model}-通信记录.json`,'application/json')}>下载</button><pre>{runtime.current.trace.slice(-10).map(item=>`${item.direction} ${item.hex}`).join('\n')||'暂无记录'}</pre></details></section>}
    <footer className="page-footer"><span>本地处理 · {connected?'写频线已连接':'未连接'}</span><span>BA7KTC / Radio Workbench / <a href="https://github.com/JukZeon/d500-web" target="_blank" rel="noreferrer">GitHub</a> / <a href="/source.zip" download>源码</a> / <a href="/LICENSE.txt" target="_blank" rel="noreferrer">许可</a></span></footer>
   </main>
  </div>
  {paste!==null&&<WorkbenchDialog label="粘贴表格" onClose={()=>setPaste(null)}><header><h2>粘贴表格</h2><button className="icon-btn" aria-label="关闭粘贴表格" onClick={()=>setPaste(null)}><X size={18}/></button></header><p className="import-note">无表头：名称、接收 MHz、发射 MHz、发射哑音。</p><textarea className="paste-area mono" aria-label="粘贴信道数据" value={paste} onChange={e=>setPaste(e.target.value)}/><div className="modal-actions"><button className="btn primary" disabled={!paste.trim()} onClick={()=>{const text=/接收|frequency|rx/i.test(paste.split('\n')[0])?paste:'名称\t接收频率\t发射频率\t发射哑音\n'+paste;void importFile(new File([text],'粘贴.tsv')).then(()=>setPaste(null));}}>预览</button></div></WorkbenchDialog>}
  {exportOpen&&<WorkbenchDialog label="导出" onClose={()=>setExportOpen(false)}><header><h2>导出</h2><button className="icon-btn" aria-label="关闭导出" onClick={()=>setExportOpen(false)}><X size={18}/></button></header><div className="export-change-summary"><strong>{channels.length} 条信道</strong><span>{settingsCount} 项设置修改</span></div><div className="export-options"><button disabled={!draft.document.image||busy} onClick={()=>void exportFile('image').then(()=>setExportOpen(false))}><span className="format-icon"><FileCode2 size={24}/></span><span><strong>整机镜像 <em>.img</em></strong><small>{draft.document.image?'信道与机型配置':'请先载入整机配置'}</small></span><Download size={18}/></button><button onClick={()=>void exportFile('project').then(()=>setExportOpen(false))}><span className="format-icon"><Save size={24}/></span><span><strong>完整方案 <em>.radio.json</em></strong><small>含设置、分组、备注与原镜像</small></span><Download size={18}/></button></div></WorkbenchDialog>}
 </div>;
}
