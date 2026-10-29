import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowRight, Check, Download, Upload, X } from 'lucide-react';
import { RADIO_MODELS, parseChirpDraft, type RadioModel } from '../lib/chirp';
import { emptyWorkspace } from '../lib/model';
import { download, parseProject } from '../lib/project';
import { useAutosave } from '../lib/use-autosave';
import { D500_STORAGE, LIBRARY_STORAGE, applyChirpTransfer, applyD500Transfer, boundsFor, chirpStorage, compatibleName, currentNameFeatures, emptyLibrary, findLibraryChannel, managedChirp, managedD500, mergeLibrary, offlineDraft, parseLibrary, planTransfer, type ChannelLibrary, type ManagedChannel, type TransferMode } from '../lib/shared-channels';
import ChannelEditor from './ChannelEditor';
import WorkbenchDialog from './WorkbenchDialog';
import { parseDat } from '../lib/dat';
import { importChirpTable } from '../lib/chirp';
import { baselineFeatures } from '../lib/shared-channels';
import { SharedContext, useSharedChannels, type ProfileAccess } from '../lib/shared-context';
function storedProfile(model:RadioModel):ProfileAccess{
 if(model==='d500'){
  const saved=localStorage.getItem(D500_STORAGE),workspace=saved?parseProject(saved):emptyWorkspace();
  return {name:workspace.name,channels:managedD500(workspace.channels),apply:(rows,mode)=>localStorage.setItem(D500_STORAGE,JSON.stringify(applyD500Transfer(workspace,rows,mode)))};
 }
 const saved=localStorage.getItem(chirpStorage(model)),draft=saved?parseChirpDraft(saved,model):offlineDraft(model);
 return {name:draft.name,channels:managedChirp(draft.channels,model),features:currentNameFeatures(model,draft.document.features),apply:(rows,mode)=>localStorage.setItem(chirpStorage(model),JSON.stringify(applyChirpTransfer(draft,rows,mode)))};
}
function initialLibrary():ChannelLibrary{
 try{
  const saved=localStorage.getItem(LIBRARY_STORAGE);if(saved)return parseLibrary(saved);
  let library=emptyLibrary();
  for(const model of RADIO_MODELS){
   try{for(const row of storedProfile(model.id).channels){
    const old=findLibraryChannel(library.channels,row);
    if(old){if(old.name!==row.name)old.aliases={...old.aliases,[model.id]:row.name};}
    else library=mergeLibrary(library,[row]);
   }}catch{/* A damaged device draft is left untouched. */}
  }
  return library;
 }catch{return emptyLibrary();}
}
export function SharedChannelsProvider({children,currentModel}:{children:ReactNode;currentModel:RadioModel}){
 const [library,setLibrary]=useState(initialLibrary),[source,setSource]=useState<ManagedChannel[]|null>(null),[notice,setNotice]=useState('');
 const [target,setTarget]=useState<RadioModel>(currentModel),[mode,setMode]=useState<TransferMode>('sync'),[start,setStart]=useState(0),[names,setNames]=useState<Record<string,string>>({}),[skip,setSkip]=useState(false),[error,setError]=useState(''),[nameMode,setNameMode]=useState<'full'|'aliases'>('full');
 const access=useRef(new Map<RadioModel,()=>ProfileAccess>());
 const saving=useAutosave(LIBRARY_STORAGE,library);
 const register=useCallback((model:RadioModel,read:()=>ProfileAccess)=>{access.current.set(model,read);return()=>{if(access.current.get(model)===read)access.current.delete(model);};},[]);
 const update=useCallback((next:ChannelLibrary)=>setLibrary({...next,updatedAt:new Date().toISOString()}),[]);
 const store=useCallback((rows:ManagedChannel[])=>{try{setLibrary(mergeLibrary(library,rows));setNotice(`已加入信道库 · ${rows.length} 条`);}catch(e){setNotice((e as Error).message);}},[library]);
 const transfer=useCallback((rows:ManagedChannel[])=>{
  const next=currentModel;
  setSource(rows.map(row=>{const entry=findLibraryChannel(library.channels,row);return {...row,libraryId:entry?.id??row.libraryId,aliases:entry?.aliases??row.aliases};}));
  setTarget(next);setStart(boundsFor(next)[0]);setMode('sync');setNameMode('full');setNames({});setSkip(false);setError('');
 },[currentModel,library]);
 let profile:ProfileAccess|undefined,loadError='';
 if(source)try{profile=access.current.get(target)?.()??storedProfile(target);}catch(e){loadError='目标方案无法读取：'+(e as Error).message;}
 const plan=source&&profile?planTransfer(source,target,profile.channels,{mode,start,names,nameMode},profile.features):[];
 const bad=plan.filter(row=>row.errors.length),ready=plan.filter(row=>!row.errors.length);
 const [lo,hi]=boundsFor(target,profile?.features);
 useEffect(()=>{if(!notice)return;const timer=setTimeout(()=>setNotice(''),4500);return()=>clearTimeout(timer);},[notice]);
 function apply(){
  if(!profile||loadError)return;
  if(bad.length&&!skip){setError('请调整不兼容项，或选择跳过');return;}
  if(!ready.length){setError('没有可以应用的信道');return;}
  try{
   profile.apply(ready.map(row=>row.channel),mode);
   setLibrary(old=>{const namesById=new Map(ready.map(row=>[findLibraryChannel(old.channels,row.source)?.id,row.channel.name]));return {...old,channels:old.channels.map(channel=>{const name=namesById.get(channel.id);return name!==undefined&&name!==channel.name?{...channel,aliases:{...channel.aliases,[target]:name}}:channel;}),updatedAt:new Date().toISOString()};});
   setNotice(`已更新 ${RADIO_MODELS.find(m=>m.id===target)!.label} 方案 · ${ready.length} 条`);setSource(null);
  }catch(e){setError((e as Error).message);}
 }
 const context=useMemo(()=>({library,update,store,transfer,register}),[library,update,store,transfer,register]);
 return <SharedContext.Provider value={context}>{children}{notice&&<div className="toast" role="status"><Check size={17}/>{notice}<button aria-label="关闭提示" onClick={()=>setNotice('')}><X size={15}/></button></div>}{saving.startsWith('存储已满')&&<div className="toast error" role="alert">{saving}</div>}
 {source&&<WorkbenchDialog label="应用信道到电台方案" className="transfer-modal" onClose={()=>setSource(null)}><header><div><h2>应用到电台方案</h2><p>{source.length} 条信道</p></div><button className="icon-btn" aria-label="关闭信道应用" onClick={()=>setSource(null)}><X size={19}/></button></header><div className="transfer-controls"><label>目标电台<select aria-label="目标电台" value={target} onChange={e=>{const model=e.target.value as RadioModel;setTarget(model);setStart(boundsFor(model)[0]);setNames({});setError('');}}>{RADIO_MODELS.map(m=><option key={m.id} value={m.id}>{m.label} · {m.variant}</option>)}</select></label><label>应用方式<select aria-label="应用方式" value={mode} onChange={e=>setMode(e.target.value as TransferMode)}><option value="sync">更新关联信道，其余追加</option><option value="append">追加到空位</option><option value="merge">按编号合并</option><option value="replace">替换全部信道</option></select></label><label>名称<select aria-label="名称方式" value={nameMode} onChange={e=>{setNameMode(e.target.value as 'full'|'aliases');setNames({});}}><option value="full">优先完整名称</option><option value="aliases">使用机型别名</option></select></label>{(mode==='append'||mode==='sync')&&<label>从编号开始<input aria-label="起始编号" type="number" min={lo} max={hi} value={start} onChange={e=>setStart(Number(e.target.value))}/></label>}</div>
 <div className="transfer-summary"><span>{profile?.name??'目标方案'} · {lo}–{hi}</span><strong>{ready.length} 条可用{bad.length?` · ${bad.length} 条待调整`:''}</strong><button className="text-btn" onClick={()=>setNames(Object.fromEntries(plan.map(row=>[row.source.id,compatibleName(row.source.name,target,row.channel.number,profile?.features)])))}>生成兼容名称</button></div>
 {mode==='replace'&&<p className="inline-error">目标方案的全部信道将替换为本次列表，整机设置保留。</p>}{(error||loadError)&&<p role="alert" className="inline-error">{error||loadError}</p>}
 <div className="transfer-preview"><table><thead><tr><th>原名称</th><th/><th>目标编号</th><th>机型名称</th><th>接收 / 发射 MHz</th><th>检查</th></tr></thead><tbody>{plan.slice(0,200).map((row,i)=><tr key={`${row.source.id}:${i}`} className={row.errors.length?'row-error':''}><td>{row.source.name||'未命名'}</td><td><ArrowRight size={13}/></td><td className="mono">{String(row.channel.number).padStart(3,'0')}</td><td><input aria-label={`目标名称 ${i+1}`} value={row.channel.name} onChange={e=>setNames({...names,[row.source.id]:e.target.value})}/></td><td className="mono">{row.channel.rx}<br/>{row.channel.tx||'仅接收'}</td><td>{row.errors.length?row.errors.join('；'):[...row.warnings,...(row.overwrites?['覆盖同编号']:[])].join('；')||'可用'}</td></tr>)}</tbody></table>{plan.length>200&&<p className="import-note">预览前 200 条，检查和应用包含全部 {plan.length} 条。</p>}</div><div className="transfer-options">{bad.length>0&&<label className="check-label"><input type="checkbox" checked={skip} onChange={e=>setSkip(e.target.checked)}/>跳过不兼容信道</label>}<span className="chirp-muted">只更新方案</span></div><div className="modal-actions"><button className="btn" onClick={()=>setSource(null)}>取消</button><button className="btn primary" disabled={!ready.length||!!loadError||(bad.length>0&&!skip)} onClick={apply}>应用 {ready.length} 条</button></div></WorkbenchDialog>}
 </SharedContext.Provider>;
}
export function SharedLibraryPanel(){
 const shared=useSharedChannels(),[past,setPast]=useState<ChannelLibrary[]>([]),[future,setFuture]=useState<ChannelLibrary[]>([]),[message,setMessage]=useState('');
 const file=useRef<HTMLInputElement>(null);
 const commit=(next:ChannelLibrary)=>{setPast(old=>[...old.slice(-29),shared.library]);setFuture([]);shared.update(next);};
 useEffect(()=>{
  const handler=(event:KeyboardEvent)=>{
   if(!(event.ctrlKey||event.metaKey)||document.querySelector('[role="dialog"]'))return;
   const editing=event.target instanceof HTMLElement&&['INPUT','SELECT','TEXTAREA'].includes(event.target.tagName);
   if(event.key.toLowerCase()==='s'){event.preventDefault();download(JSON.stringify(shared.library,null,2),'共享信道库.channels.json','application/json');}
   if(event.key.toLowerCase()==='z'&&!editing){event.preventDefault();if(event.shiftKey&&future.length){setPast([...past,shared.library]);shared.update(future[0]);setFuture(future.slice(1));}else if(!event.shiftKey&&past.length){setFuture([shared.library,...future]);shared.update(past[past.length-1]);setPast(past.slice(0,-1));}}
  };
  window.addEventListener('keydown',handler);return()=>window.removeEventListener('keydown',handler);
 });
 async function importFile(input:File){
  try{
   if(input.size>8_000_000)throw Error('文件超过 8 MB');
   let rows:ManagedChannel[];
   if(/\.dat$/i.test(input.name))rows=managedD500(parseDat(await input.text(),input.name).channels);
   else if(/\.(xlsx|xls|csv|tsv)$/i.test(input.name)){
    const features={...baselineFeatures('uv5rh'),bounds:[0,4999] as [number,number],powers:['Low','Medium','High']};
    const channels=importChirpTable(await input.arrayBuffer(),features),base=channels.some(c=>c.number===0)?0:1;
    rows=managedChirp(channels,'uv5rh').map(c=>({...c,sourceModel:undefined,numberBase:base as 0|1}));
   }else{
    const text=await input.text(),value=JSON.parse(text);
    if(value.schema==='radio-channel-library-v1')rows=parseLibrary(text).channels;
    else if([1,2].includes(value.schema))rows=managedD500(parseProject(text).channels);
    else {const draft=parseChirpDraft(text,value.document?.model);rows=managedChirp(draft.channels,draft.document.model);}
   }
   commit(mergeLibrary(shared.library,rows));setMessage(`已合并 ${rows.length} 条信道`);
  }catch(e){setMessage((e as Error).message);}finally{if(file.current)file.current.value='';}
 }

 return <section className="shared-library"><div className="library-heading"><div><span className="eyebrow">CHANNEL LIBRARY</span><h1>共享信道库</h1><p>统一维护，按机型应用。</p></div><div className="chirp-actions"><button className="btn" onClick={()=>file.current?.click()}><Upload size={15}/>导入信道库</button><button className="btn" onClick={()=>download(JSON.stringify(shared.library,null,2),'共享信道库.channels.json','application/json')}><Download size={15}/>导出信道库</button></div></div><input className="file-input" type="file" aria-label="导入共享信道文件" accept=".json,.dat,.xlsx,.xls,.csv,.tsv" ref={file} onChange={e=>e.target.files?.[0]&&void importFile(e.target.files[0])}/>{message&&<p className="chirp-message" role="status">{message}</p>}<ChannelEditor channels={shared.library.channels} model="library" onChange={channels=>commit({...shared.library,channels})} onTransfer={shared.transfer} canUndo={!!past.length} canRedo={!!future.length} undo={()=>{if(!past.length)return;setFuture([shared.library,...future]);shared.update(past[past.length-1]);setPast(past.slice(0,-1));}} redo={()=>{if(!future.length)return;setPast([...past,shared.library]);shared.update(future[0]);setFuture(future.slice(1));}}/>
 </section>;
}
