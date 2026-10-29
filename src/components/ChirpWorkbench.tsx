import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Cable, Download, GitBranch, Plus, Radio, Save, Search, Settings2, Trash2, Undo2, Upload } from 'lucide-react';
import { RADIO_MODELS, channelIssues, editedChannels, fromD500, importChirpTable, isChirpDocument, makeChirpChannel, parseChirpDraft, type ChirpModel, type ChirpDraft, type ChirpDocument, type ChirpChannel,  type SettingEdits, type SettingNode } from '../lib/chirp';
import { download, parseProject } from '../lib/project';
import { ChirpRuntime, directRadioSupported } from '../lib/chirp-runtime';
import { serialApi, type SerialPortLike } from '../lib/serial';

const LABELS: Record<string, string> = {
  'Limits disabled for modified firmware': '扩展频段', 'High': '高', 'Low': '低', 'Medium': '中', 'Med': '中', 'Off': '关闭', 'On': '开启',
  'Basic Settings': '基本设置', 'Advanced Settings': '高级设置', 'Other Settings': '其他设置', 'Work Mode Settings': '工作模式',
  'Programmable keys': '按键设置', 'Scan Lists': '扫描列表', 'FM Radio': '收音机', 'Driver information': '设备信息',
  'DTMF Settings': 'DTMF 设置', 'DTMF Contacts': 'DTMF 联系人', 'Unlock Settings': '频段限制', 'Squelch': '静噪',
  'Battery Saver': '省电模式', 'VOX Level': '声控等级', 'Backlight Timeout': '背光时间', 'Keypad Beep': '按键音',
  'Timeout Timer': '发射限时', 'Voice Prompt': '语音提示', 'Scan Mode': '扫描方式', 'Busy Channel Lockout': '繁忙禁发',
  'Keypad Lock': '键盘锁', 'Dual Watch': '双守候', 'EEPROM size': 'EEPROM 容量', 'Firmware version': '固件版本',
};
const label = (s: string | number) => LABELS[String(s)] ?? String(s);
const draftKey = (model: string) => `ba7ktc-chirp-${model}-v1`;
function initial(model: ChirpModel): ChirpDraft | null {
  try { const text = localStorage.getItem(draftKey(model)); return text ? parseChirpDraft(text, model) : null; }
  catch { return null; }
}
export function SettingsTree({ nodes, edits, onChange, disabled }: { nodes: SettingNode[]; edits: SettingEdits; onChange: (edits: SettingEdits) => void; disabled: boolean }) {
  return <>{nodes.map(node => node.children ? <details className="chirp-setting-group" key={node.key} open><summary>{label(node.label)}</summary><SettingsTree nodes={node.children} edits={edits} onChange={onChange} disabled={disabled} /></details> :
    <label className="chirp-field" key={node.key}><span title={node.doc}>{label(node.label)}</span><span className="chirp-values">{node.values?.map((spec, i) => {
      const value = edits[node.key]?.[i] ?? spec.value;
      const change = (v: string | boolean | number) => { const next = [...(edits[node.key] ?? node.values!.map(s => s.value))]; next[i] = v; onChange({ ...edits, [node.key]: next }); };
      const locked = disabled || !spec.mutable;
      return spec.type === 'list' ? <select key={i} aria-label={node.label} disabled={locked} value={String(value)} onChange={e => change(e.target.value)}>{spec.options?.map((v, n) => <option key={n} value={v}>{label(v)}</option>)}</select>
        : spec.type === 'boolean' ? <input key={i} aria-label={node.label} type="checkbox" disabled={locked} checked={Boolean(value)} onChange={e => change(e.target.checked)} />
        : <input key={i} aria-label={node.label} disabled={locked} type={spec.type === 'number' ? 'number' : 'text'} min={spec.min} max={spec.type === 'number' ? spec.max : undefined} step={spec.step} maxLength={spec.type === 'string' ? spec.max : undefined} value={String(value)} onChange={e => change(spec.type === 'number' ? Number(e.target.value) : e.target.value)} />;
    })}</span></label>)}</>;
}
export default function ChirpWorkbench({ model, switcher, onBusy }: { model: ChirpModel; switcher: ReactNode; onBusy: (busy: boolean) => void }) {
  const [draft, setDraft] = useState<ChirpDraft | null>(() => initial(model));
  const [past, setPast] = useState<ChirpDraft[]>([]);
  const [tab, setTab] = useState<'channels' | 'settings' | 'radio'>('channels');
  const [connected, setConnected] = useState(false), [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({done:0,total:1});
  const port = useRef<SerialPortLike | null>(null);
  const runtime = useRef(new ChirpRuntime());
  const [message, setMessage] = useState(''), [error, setError] = useState(false);
  const [query, setQuery] = useState(''), [active, setActive] = useState<number | null>(null), [selection, setSelection] = useState<number[]>([]);
  const [pending, setPending] = useState<{ channels: ChirpChannel[]; name: string } | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const entry = RADIO_MODELS.find(m => m.id === model)!;
  const f = draft?.document.features;
  const channels = draft?.channels.filter(c => !c.empty) ?? [];
  const current = channels.find(c => c.number === active);
  const filtered = channels.filter(c => [c.number, c.name, c.rx, c.tx, c.comment].join(' ').toLowerCase().includes(query.toLowerCase()));
  const issues = draft && f ? channelIssues(draft.channels, f, draft.document.channels) : [];
  const changes = draft ? editedChannels(draft) : [];
  const settingsCount = Object.keys(draft?.settings ?? {}).length;
  const tell = (text: string, failed = false) => { setMessage(text); setError(failed); };
  const commit = (next: ChirpDraft) => { if (draft) setPast(p => [...p.slice(-29), draft]); setDraft(next); };
  const update = (number: number, patch: Partial<ChirpChannel>) => { if (draft) commit({ ...draft, channels: draft.channels.map(c => c.number === number ? { ...c, ...patch } : c) }); };
  useEffect(() => { onBusy(busy); return () => onBusy(false); }, [busy, onBusy]);
  useEffect(() => {
    if (!draft) return;
    const id = setTimeout(() => { try { localStorage.setItem(draftKey(model), JSON.stringify(draft)); } catch { tell('浏览器存储已满，请导出方案', true); } }, 350);
    return () => clearTimeout(id);
  }, [draft, model]);
  useEffect(() => () => runtime.current.dispose(), []);
  async function connect() {
    try {
      if (!directRadioSupported()) throw new Error('请使用桌面 Chrome / Edge，通过 HTTPS 或本机地址打开工作台');
      port.current = await serialApi()!.requestPort(); setConnected(true); tell('写频线已连接');
    } catch (e) { if ((e as Error).name !== 'NotFoundError') tell((e as Error).message, true); }
  }
  function acceptDocument(doc: ChirpDocument, name?: string) {
    if (!isChirpDocument(doc) || doc.model !== model) throw new Error('驱动返回的型号／数据无效');
    commit({ document: doc, channels: doc.channels, settings: {}, name: name ?? entry.label });
    setActive(null); setSelection([]); setPending(null);
  }
  async function run(action: 'read' | 'write') {
    setBusy(true); setProgress({done:0,total:1}); tell(action === 'read' ? '读取中…' : '写入中…');
    try {
      if (!port.current || !connected) throw new Error('请先连接写频线');
      if (action === 'write' && (!draft || issues.length)) throw new Error(issues[0] ?? '请先读取电台或导入 IMG 镜像');
      const result = await runtime.current.execute<ChirpDocument>({ action, model,
        ...(action === 'write' && draft ? { image: draft.document.image, channels: changes, settings: draft.settings } : {}) },
        (done,total) => setProgress({done,total}), port.current);
      if (action === 'read') {
        download(Uint8Array.from(atob(result.image),c=>c.charCodeAt(0)), `${model}-原始备份-${Date.now()}.img`);
      }
      acceptDocument(result, action === 'write' ? draft?.name : undefined);
      tell(action === 'read' ? '读取完成，已导出原始 IMG 备份' : '写入完成');
      if (action === 'read') setTab('channels');
    } catch (e) { tell((e as Error).message, true); }
    finally { setBusy(false); }
  }
  async function prepare() {
    if (!draft) throw new Error('请先读取电台或导入 IMG 镜像');
    if (issues.length) throw new Error(issues[0]);
    const result = await runtime.current.execute<{ document: ChirpDocument; warnings: string[] }>({ action:'prepare', model, image: draft.document.image, channels: changes, settings: draft.settings });
    if (!isChirpDocument(result.document)) throw new Error('镜像生成失败');
    return result.document;
  }
  async function exportFile(kind: 'project' | 'image') {
    if (!draft) return;
    if (kind === 'project') { download(JSON.stringify(draft, null, 2), draft.name + '.radio.json', 'application/json'); tell('方案已导出'); return; }
    setBusy(true);
    try { const doc = await prepare(); download(Uint8Array.from(atob(doc.image), c => c.charCodeAt(0)), draft.name + '.img'); tell('IMG 已生成并通过驱动验证'); }
    catch (e) { tell((e as Error).message, true); }
    finally { setBusy(false); }
  }
  async function importFile(input: File) {
    if (input.size > 4_000_000) { tell('文件超过 4 MB', true); return; }
    setBusy(true); tell('解析文件…');
    try {
      if (/\.img$/i.test(input.name)) {
        const bytes = new Uint8Array(await input.arrayBuffer()); let raw = '';
        for (const b of bytes) raw += String.fromCharCode(b);
        const doc = await runtime.current.execute<ChirpDocument>({ action:'image', model, image: btoa(raw) });
        acceptDocument(doc, input.name.replace(/\.img$/i, '')); tell('镜像已载入'); return;
      }
      if (/\.json$/i.test(input.name)) {
        const text = await input.text();
        if (/\.d500\.json$/i.test(input.name)) {
          if (!f) throw new Error('请先读取目标电台或导入其 IMG 镜像');
          const source = parseProject(text); setPending({ channels: fromD500(source.channels, f), name: source.name });
        } else { const next = parseChirpDraft(text, model); commit(next); tell('方案已载入'); }
      } else if (/\.(xlsx|xls|csv|tsv)$/i.test(input.name)) {
        if (!f) throw new Error('请先读取目标电台或导入其 IMG 镜像');
        setPending({ channels: importChirpTable(await input.arrayBuffer(), f), name: input.name });
      } else throw new Error('支持 IMG / JSON / XLSX / CSV / TSV');
    } catch (e) { tell((e as Error).message, true); }
    finally { setBusy(false); if (file.current) file.current.value = ''; }
  }
  function acceptTable(replace: boolean) {
    if (!draft || !pending) return;
    const map = new Map(draft.channels.map(c => [c.number, replace ? { ...c, empty: true } : c]));
    for (const c of pending.channels) {
      const old = map.get(c.number);
      map.set(c.number, { ...c, extra: old?.extra ?? [], ...(old?.extraEdits ? { extraEdits: old.extraEdits } : {}) });
    }
    commit({ ...draft, channels: [...map.values()].sort((a, b) => a.number - b.number) });
    setPending(null); setTab('channels'); tell(`已导入 ${pending.channels.length} 条；编号按导入预览保留`);
  }
  function add() {
    if (!draft || !f) return;
    for (let n = f.bounds[0]; n <= f.bounds[1]; n++) if (!channels.some(c => c.number === n)) {
      commit({ ...draft, channels: [...draft.channels.filter(c => c.number !== n), makeChirpChannel(n, f)].sort((a,b) => a.number-b.number) }); setActive(n); return;
    }
    tell('信道已满', true);
  }
  function batch(patch: Partial<ChirpChannel>) { if (draft) commit({ ...draft, channels: draft.channels.map(c => selection.includes(c.number) ? { ...c, ...patch } : c) }); }
  const tones = f ? ['', ...f.tones.map(t => t.toFixed(1)), ...f.dtcs.flatMap(n => ['N', 'R'].map(s => `D${String(n).padStart(3,'0')}${s}`))] : [];
  return <div className="app chirp-app">
    <aside className="sidebar"><a href="#" className="brand" onClick={e => e.preventDefault()}><Radio size={23}/><span>RADIO<span className="brand-sub">写频工作台</span></span></a>{switcher}
      <nav>{([['channels','信道',Radio],['settings','电台设置',Settings2],['radio','电台读写',Cable]] as const).map(([id,title,Icon]) => <button key={id} className={`nav ${tab === id ? 'active' : ''}`} disabled={busy} onClick={() => setTab(id)}><Icon size={17}/>{title}</button>)}</nav>
      <div className="sidebar-bottom"><div className="author"><strong>BA7KTC</strong><a href="https://github.com/JukZeon/d500-web" target="_blank" rel="noreferrer"><GitBranch size={16}/></a></div></div>
    </aside>
    <div className="workspace-shell"><header className="topbar"><strong>{entry.label} <span className="chirp-muted">{entry.variant}</span></strong><div className="topbar-right"><button className="btn" disabled={busy} onClick={() => file.current?.click()}><Upload size={15}/>导入</button><button className="btn" disabled={!draft || busy} onClick={() => void exportFile('project')}><Save size={15}/>保存方案</button><button className="btn" disabled={!draft || busy} onClick={() => { if (!draft) return; setPast(p => [...p.slice(-29), draft]); setDraft(null); setActive(null); setSelection([]); setPending(null); try { localStorage.removeItem(draftKey(model)); } catch { tell('无法清除浏览器草稿',true); } }}>关闭方案</button><button className="btn primary" disabled={busy} onClick={() => setTab('radio')}><Cable size={15}/>读写</button></div></header>
      <main className="chirp-main"><input className="file-input" type="file" ref={file} accept=".img,.json,.xlsx,.xls,.csv,.tsv" onChange={e => { if(e.target.files?.[0]) void importFile(e.target.files[0]); }}/>
        <div className="chirp-document"><input aria-label="方案名称" disabled={!draft || busy} value={draft?.name ?? entry.label} onChange={e => draft && commit({ ...draft, name: e.target.value })}/><span>{f ? `${f.bounds[0]}–${f.bounds[1]} · ${channels.length} 条` : entry.note}</span><span>{draft?.document.firmware}</span><button className="btn" disabled={!past.length || busy} onClick={() => { setDraft(past[past.length-1]); setPast(past.slice(0,-1)); }}><Undo2 size={14}/>撤销</button></div>
        {message && <div role={error ? 'alert' : 'status'} className={`chirp-message ${error ? 'error' : ''}`}>{message}</div>}
        {pending && <section className="chirp-import"><strong>导入 {pending.channels.length} 条信道</strong><p>同编号覆盖。替换会清空未列出的信道。</p><div className="chirp-preview">{pending.channels.map(c => <div key={c.number}><span>{c.number}</span><strong>{c.name || '未命名'}</strong><span className="mono">{c.rx} → {c.tx || '禁发'}</span></div>)}</div><div className="chirp-actions"><button className="btn" onClick={() => setPending(null)}>取消</button><button className="btn" onClick={() => acceptTable(false)}>合并</button><button className="btn primary" onClick={() => acceptTable(true)}>替换信道</button></div></section>}
        {tab === 'radio' && <section className="chirp-radio"><h2>电台读写</h2><div className="chirp-connect"><button className="btn" disabled={busy} onClick={() => void connect()}><Cable size={15}/>{connected ? '更换写频线' : '连接写频线'}</button><span className="chirp-muted">{connected ? '写频线已授权' : '网页直接连接 · Chrome / Edge'}</span></div>
          <div className="radio-warning"><strong>⚠️ 刷写有风险，请先备份电台原始配置。</strong><span>使用本软件造成的数据丢失、设备损坏等后果由使用者自行承担，作者不承担责任。</span></div>
          <div className="chirp-actions"><button className="btn" disabled={busy || !connected} onClick={() => void run('read')}><Download size={15}/>读取电台</button><button className="btn primary" disabled={busy || !connected || !draft || !!issues.length} onClick={() => void run('write')}><Upload size={15}/>写入电台</button><button className="btn" disabled={busy || !draft} onClick={() => void exportFile('image')}>导出 IMG</button></div>
          <p className="chirp-muted chirp-guide">{changes.length} 条信道修改 · {settingsCount} 项设置修改。该型号按驱动范围写入完整配置，不自动回读。</p>
          {busy && <div className="chirp-progress"><progress value={progress.done} max={progress.total}/><span>{Math.round(progress.done/progress.total*100)}%</span></div>}
          <details className="chirp-trace"><summary>通信记录</summary><button className="text-btn" disabled={busy} onClick={()=>download(JSON.stringify({model,entries:runtime.current.trace},null,2),`${model}-通信记录.json`,'application/json')}>下载</button><pre>{runtime.current.trace.slice(-10).map(item=>`${item.direction} ${item.hex}`).join('\n') || '暂无记录'}</pre></details>
        </section>}
        {tab !== 'radio' && !draft && <section className="chirp-empty"><Radio size={32}/><h2>先载入这台电台的配置</h2><p>读取电台，或导入同型号、同固件的 CHIRP IMG。之后可编辑信道与受支持的设置。</p><div className="chirp-actions"><button className="btn primary" onClick={() => setTab('radio')}>连接电台</button><button className="btn" onClick={() => file.current?.click()}>导入镜像／方案</button></div></section>}
        {issues.length > 0 && <details className="chirp-issues"><summary>{issues.length} 个问题</summary>{issues.map((s,i) => <p key={i}>{s}</p>)}</details>}
        {tab === 'channels' && draft && f && <section className="chirp-channel-panel"><div className="chirp-toolbar"><label className="search"><Search size={15}/><input aria-label="搜索信道" value={query} onChange={e => setQuery(e.target.value)} placeholder="名称、频率、备注"/></label><button className="btn" disabled={busy} onClick={add}><Plus size={15}/>信道</button><button className="btn" disabled={!selection.length || busy} onClick={() => batch({empty:true})}><Trash2 size={15}/>删除 {selection.length || ''}</button><span className="chirp-muted">名称 {f.nameLength} 位 · {draft.document.settingsLimited ? 'GB2312 中文' : '驱动字符集'}</span></div>
          {selection.length > 0 && <div className="chirp-batch"><span>已选 {selection.length}</span><select aria-label="批量功率" defaultValue="" onChange={e => { if(e.target.value) batch({power:e.target.value}); e.target.value=''; }}><option value="">批量功率</option>{f.powers.map(p => <option key={p} value={p}>{label(p)}</option>)}</select><select aria-label="批量模式" defaultValue="" onChange={e => { if(e.target.value) batch({mode:e.target.value}); e.target.value=''; }}><option value="">批量模式</option>{f.modes.map(p => <option key={p} value={p}>{label(p)}</option>)}</select><button className="text-btn" onClick={() => setSelection([])}>取消选择</button></div>}
          <div className="chirp-grid"><div className="chirp-table-scroll"><table className="chirp-table"><thead><tr><th><input aria-label="选择全部信道" type="checkbox" checked={filtered.length>0 && filtered.every(c => selection.includes(c.number))} onChange={e => setSelection(e.target.checked ? filtered.map(c => c.number) : [])}/></th><th>编号</th><th>名称</th><th>接收 MHz</th><th>发射 MHz</th><th>接收哑音</th><th>发射哑音</th><th>模式</th><th>功率</th></tr></thead><tbody>{filtered.map(c => <tr key={c.number} className={active===c.number?'active':''} onClick={() => setActive(c.number)}><td><input type="checkbox" aria-label={`选择信道 ${c.number}`} checked={selection.includes(c.number)} disabled={busy} onChange={e => setSelection(e.target.checked ? [...selection,c.number] : selection.filter(n=>n!==c.number))}/></td><td className="mono">{String(c.number).padStart(3,'0')}</td>{(['name','rx','tx','rxTone','txTone'] as const).map(k => <td key={k}><input aria-label={`${c.number} ${k}`} value={c[k]} disabled={busy} onChange={e => update(c.number,{[k]:e.target.value})} list={k.endsWith('Tone')?'chirp-tones':undefined}/></td>)}<td><select aria-label={`${c.number} 模式`} value={c.mode} disabled={busy} onChange={e => update(c.number,{mode:e.target.value})}>{f.modes.map(v=><option key={v} value={v}>{label(v)}</option>)}</select></td><td><select aria-label={`${c.number} 功率`} value={c.power} disabled={busy} onChange={e=>update(c.number,{power:e.target.value})}><option value="">默认</option>{f.powers.map(v=><option key={v} value={v}>{label(v)}</option>)}</select></td></tr>)}</tbody></table></div>
            {current && <aside className="chirp-inspector"><h3>信道 {current.number}</h3><p className="chirp-muted">{current.name}</p><label className="chirp-field">扫描<select disabled={busy} value={current.skip} onChange={e=>update(current.number,{skip:e.target.value})}>{f.skips.map(v=><option key={v} value={v}>{v==='S'?'跳过':v||'参与'}</option>)}</select></label>{f.hasStep && <label className="chirp-field">步进 kHz<select disabled={busy} value={current.step} onChange={e=>update(current.number,{step:Number(e.target.value)})}>{f.steps.map(v=><option key={v} value={v}>{label(v)}</option>)}</select></label>}<label className="chirp-comment">备注<textarea disabled={busy} value={current.comment} onChange={e=>update(current.number,{comment:e.target.value})}/></label><SettingsTree nodes={current.extra} edits={current.extraEdits??{}} disabled={busy} onChange={extraEdits=>update(current.number,{extraEdits})}/><button className="text-btn" onClick={()=>setActive(null)}>收起</button></aside>}
          </div><datalist id="chirp-tones">{tones.map(t=><option key={t} value={t}/>)}</datalist>
        </section>}
        {tab === 'settings' && draft && <section className="chirp-settings"><h2>电台设置</h2>{draft.document.settingsLimited && <p className="chirp-message">{draft.document.settingsCoverage === 'basic' ? '已适配该版本的基本设置；按键、信令和扩容配置保留。' : '该固件版本暂支持信道编辑，其他配置保留。'}</p>}<SettingsTree nodes={draft.document.settings} edits={draft.settings} disabled={busy} onChange={settings => commit({...draft,settings})}/></section>}
        <footer className="page-footer"><span>本地处理 · {connected ? '写频线已连接' : '未连接'}</span><span>BA7KTC / Radio Workbench / <a href="https://github.com/JukZeon/d500-web" target="_blank" rel="noreferrer">GitHub</a> / <a href="/source.zip" download>源码</a> / <a href="/LICENSE.txt" target="_blank" rel="noreferrer">许可</a></span></footer>
      </main>
    </div>
  </div>;
}
