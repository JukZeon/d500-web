import { version } from '../package.json';
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Activity, ArrowDownToLine, Check, CheckCheck, ChevronDown, ChevronRight, CircleHelp, Clipboard, Copy, Download, FileCode2, FileSpreadsheet, FileText, FolderOpen, GitBranch, HardDrive, ListFilter, Menu, Plus, Radio, Redo2, Save, Search, Settings2, ShieldCheck, SlidersHorizontal, Trash2, Undo2, Upload, X } from 'lucide-react';
import { type Channel, type Workspace, type Power, demoWorkspace, emptyWorkspace, newChannel, nextSlot, slotLabel, POWER_LABEL, PTT_OPTIONS, SIGNAL_OPTIONS, MUTE_OPTIONS } from './lib/model';
import { exportDat, parseDat, validateChannels } from './lib/dat';
import { importWorkbook } from './lib/workbook';
import { download, parseProject } from './lib/project';
import ToneEditor from './components/ToneEditor';
import RadioSettingsPanel from './components/RadioSettingsPanel';
import { readSettings, settingsChanges } from './lib/settings';
import { encodeName, MAX_NAME_BYTES } from './lib/encoding';
const RadioPanel = lazy(() => import('./components/RadioPanel'));
const nameLength = (text: string) => { try { return encodeName(text).length; } catch { return '—'; } };

const PROJECT_GITHUB = 'https://github.com/JukZeon/d500-web';
const STORAGE = 'ba7ktc-d500-workspace-v1';
type Modal = 'help' | 'batch' | 'export' | 'paste' | null;
const EMPTY_BATCH = { power: '', bandwidth: '', rxTone: null as string | null, txTone: null as string | null, group: '', offset: '', scanAdd: '', busy: '', pttId: '' };
type Pending = { name: string; channels: Channel[]; settings?: Workspace['settings']; template: Workspace['template']; warnings: string[]; type: string };
function initial(): Workspace {
  try { const saved = localStorage.getItem(STORAGE); if (saved) return parseProject(saved); }
  catch { /* A damaged local draft can be replaced with a fresh workspace. */ }
  return emptyWorkspace();
}
function IconButton({ title, onClick, children, disabled = false, danger = false }: { title: string; onClick: () => void; children: ReactNode; disabled?: boolean; danger?: boolean }) {
  return <button className={`icon-btn ${danger ? 'danger' : ''}`} title={title} aria-label={title} onClick={onClick} disabled={disabled}>{children}</button>;
}
function ModalShell({ title, subtitle, close, children }: { title: string; subtitle?: string; close: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    const old = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    ref.current?.focus();
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current();
      if (e.key !== 'Tab') return;
      const items = ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input, select, textarea, a[href]');
      if (!items?.length) return;
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', handler);
    return () => { document.removeEventListener('keydown', handler); old?.focus(); };
  }, []);
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) close(); }}><div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} className="modal"><header><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><IconButton title="关闭对话框" onClick={close}><X size={20} /></IconButton></header>{children}</div></div>;
}
export default function App() {
  const [workspace, setWorkspace] = useState<Workspace>(initial);
  const [past, setPast] = useState<Workspace[]>([]), [future, setFuture] = useState<Workspace[]>([]);
  const [selected, setSelected] = useState<number[]>([]), [active, setActive] = useState<number | null>(null);
  const [query, setQuery] = useState(''), [band, setBand] = useState('all'), [group, setGroup] = useState('*');
  const [view, setView] = useState('channels'), [modal, setModal] = useState<Modal>(null), [pending, setPending] = useState<Pending | null>(null);
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null), [saving, setSaving] = useState('已保存');
  const [radioConnected, setRadioConnected] = useState(false), [radioBusy, setRadioBusy] = useState(false);
  const [drop, setDrop] = useState(false), [busy, setBusy] = useState(false), [sidebar, setSidebar] = useState(false);
  const [paste, setPaste] = useState(''), [batch, setBatch] = useState(EMPTY_BATCH);
  const [showErrors, setShowErrors] = useState(false), [sortBy, setSortBy] = useState<'slot' | 'rx' | 'name'>('slot');
  const fileRef = useRef<HTMLInputElement>(null);
  const notify = (text: string, error = false) => setToast({ text, error });
  const commit = (next: Workspace) => { setPast(p => [...p.slice(-49), workspace]); setFuture([]); setWorkspace({ ...next, updatedAt: new Date().toISOString() }); };
  const update = (slot: number, patch: Partial<Channel>) => commit({ ...workspace, channels: workspace.channels.map(c => c.slot === slot ? { ...c, ...patch } : c) });
  const undo = () => { if (!past.length) return; setFuture(f => [workspace, ...f]); setWorkspace(past[past.length - 1]); setPast(past.slice(0, -1)); };
  const redo = () => { if (!future.length) return; setPast(p => [...p, workspace]); setWorkspace(future[0]); setFuture(future.slice(1)); };
  useEffect(() => {
    setSaving('保存中…');
    const id = setTimeout(() => {
      try { localStorage.setItem(STORAGE, JSON.stringify(workspace)); setSaving('已保存'); }
      catch { setSaving('存储已满，请导出方案'); }
    }, 350);
    return () => clearTimeout(id);
  }, [workspace]);
  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(null), 5500); return () => clearTimeout(id); }, [toast]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || radioBusy) return;
      const editing = e.target instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName);
      if (e.key.toLowerCase() === 's') { e.preventDefault(); download(JSON.stringify(workspace, null, 2), workspace.name + '.d500.json', 'application/json'); }
      if (e.key.toLowerCase() === 'z' && !editing) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
    };
    window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler);
  });
  const issues = useMemo(() => validateChannels(workspace.channels, workspace.template?.originalChannels), [workspace.channels, workspace.template]);
  const errorSlots = new Set(issues.filter(i => i.severity === 'error').map(i => i.slot));
  const groups = [...new Set(workspace.channels.map(c => c.group).filter(Boolean))].sort();
  const filtered = workspace.channels.filter(c => {
    const q = query.trim().toLowerCase();
    return (!q || [c.name, c.rx, c.tx, slotLabel(c.slot), c.group, c.note].some(v => v.toLowerCase().includes(q))) &&
      (band === 'all' || (band === 'vhf' ? Number(c.rx) < 300 : Number(c.rx) >= 300)) &&
      (group === '*' || c.group === group) && (!showErrors || errorSlots.has(c.slot));
  }).sort((a, b) => sortBy === 'slot' ? a.slot - b.slot : sortBy === 'rx' ? Number(a.rx) - Number(b.rx) : a.name.localeCompare(b.name, 'zh-CN'));
  const current = workspace.channels.find(c => c.slot === active);
  const selection = workspace.channels.filter(c => selected.includes(c.slot));
  const allVisibleSelected = filtered.length > 0 && filtered.every(c => selected.includes(c.slot));
  const toggle = (slot: number) => setSelected(s => s.includes(slot) ? s.filter(n => n !== slot) : [...s, slot]);
  function add() { try { const c = newChannel(nextSlot(workspace.channels)); commit({ ...workspace, channels: [...workspace.channels, c] }); setActive(c.slot); setView('channels'); } catch (e) { notify((e as Error).message, true); } }
  function duplicate() {
    try {
      const source = selection.length ? selection : current ? [current] : [];
      const channels = [...workspace.channels]; const slots: number[] = [];
      for (const c of source) { const slot = nextSlot(channels); channels.push({ ...c, slot }); slots.push(slot); }
      if (!source.length) return;
      commit({ ...workspace, channels }); setSelected(slots); setActive(slots[0]); notify(`已复制 ${source.length} 条信道`);
    } catch (e) { notify((e as Error).message, true); }
  }
  function remove() {
    const slots = selected.length ? selected : active === null ? [] : [active];
    if (!slots.length) return;
    commit({ ...workspace, channels: workspace.channels.filter(c => !slots.includes(c.slot)) });
    setSelected([]); setActive(null); notify(`已删除 ${slots.length} 条信道`);
  }
  async function readFile(file: File) {
    if (radioBusy) return;
    setBusy(true);
    try {
      if (file.size > 8 * 1024 * 1024) throw new Error('文件超过 8 MB。');
      if (/\.dat$/i.test(file.name)) {
        const parsed = parseDat(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(await file.arrayBuffer()), file.name);
        setPending({ name: file.name.replace(/\.dat$/i, ''), ...parsed, type: 'D500 DAT' });
      } else if (/\.(xlsx|xls|csv|tsv)$/i.test(file.name)) {
        const result = importWorkbook(await file.arrayBuffer(), file.name);
        const baseline = new Map((workspace.template?.originalChannels ?? []).map(c => [c.slot, c]));
        for (const c of workspace.channels) baseline.set(c.slot, c);
        const channels = result.channels.map(c => {
          const before = baseline.get(c.slot); if (!before) return c;
          const preserved: Partial<Channel> = {};
          for (const field of ['name', 'tx', 'rxTone', 'txTone', 'bandwidth', 'busy', 'group', 'note', 'power', 'scanAdd', 'pttId', 'signalCode', 'optionalSignal', 'muteMode', 'scramble'] as const) if (!result.providedFields.includes(field)) Object.assign(preserved, { [field]: before[field] });
          return { ...c, ...preserved, sourceSlot: before.sourceSlot ?? before.slot };
        });
        setPending({ name: file.name.replace(/\.[^.]+$/, ''), channels, template: null, warnings: result.warnings, type: result.detected });
      } else if (/\.json$/i.test(file.name)) {
        const w = parseProject(await file.text());
        setPending({ name: w.name, channels: w.channels, template: w.template, settings: w.settings, warnings: [], type: '完整方案' });
      } else throw new Error('支持 DAT / XLSX / CSV / TSV / JSON。');
    } catch (e) { notify((e as Error).message, true); }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = ''; }
  }
  function acceptImport(mode: 'replace' | 'merge' | 'template') {
    if (!pending) return;
    if (mode === 'template') { commit({ ...workspace, template: pending.template, settings: pending.settings }); notify('已载入配置'); }
    else if (mode === 'replace') {
      commit({ ...workspace, name: pending.name, channels: pending.channels, template: pending.template ?? workspace.template, settings: pending.template ? pending.settings : workspace.settings });
      setSelected([]); setActive(null); notify(`已导入 ${pending.channels.length} 条信道`);
    } else {
      const map = new Map(workspace.channels.map(c => [c.slot, c]));
      for (const c of pending.channels) map.set(c.slot, c);
      commit({ ...workspace, channels: [...map.values()], template: workspace.template ?? pending.template, settings: workspace.template ? workspace.settings : pending.settings });
      notify(`已合并 ${pending.channels.length} 条信道`);
    }
    setPending(null); setView('channels'); setBand('all'); setGroup('*'); setQuery('');
  }
  function runExport(kind: 'dat' | 'project') {
    try {
      const name = workspace.name || 'D500';
      if (kind === 'dat') { download(exportDat(workspace.channels, workspace.template, workspace.settings), name + '.dat'); notify('已导出 DAT'); }
      if (kind === 'project') { download(JSON.stringify(workspace, null, 2), name + '.d500.json', 'application/json'); notify('已导出完整方案'); }
      setModal(null);
    } catch (e) { notify((e as Error).message, true); }
  }
  function applyBatch() {
    if (!selected.length) return;
    try {
      const channels = workspace.channels.map(c => {
        if (!selected.includes(c.slot)) return c;
        const patch: Partial<Channel> = {};
        if (batch.power) patch.power = batch.power as Power;
        if (batch.bandwidth) patch.bandwidth = batch.bandwidth as Channel['bandwidth'];
        if (batch.rxTone !== null) patch.rxTone = batch.rxTone;
        if (batch.txTone !== null) patch.txTone = batch.txTone;
        if (batch.scanAdd) patch.scanAdd = batch.scanAdd === 'on';
        if (batch.busy) patch.busy = batch.busy === 'on';
        if (batch.pttId) patch.pttId = Number(batch.pttId);
        if (batch.group) patch.group = batch.group;
        if (batch.offset) { const n = Number(batch.offset); if (!Number.isFinite(n)) throw new Error('频差必须为数值'); patch.tx = (Number(c.rx) + n).toFixed(5); }
        return { ...c, ...patch };
      });
      const bad = validateChannels(channels, workspace.template?.originalChannels).filter(i => i.severity === 'error'); if (bad.length) throw new Error(`信道 ${slotLabel(bad[0].slot)}：${bad[0].message}`);
      commit({ ...workspace, channels }); setModal(null); notify(`已更新 ${selected.length} 条信道`);
    } catch (e) { notify((e as Error).message, true); }
  }
  async function pasteImport() {
    const header = '信道名称\t接收频率\t发射频率\t发射亚音\n';
    const text = /接收|rx.?freq/i.test(paste.split('\n')[0]) ? paste : header + paste;
    await readFile(new File([text], '粘贴的信道.tsv', { type: 'text/tab-separated-values' })); setModal(null);
  }
  const updateCurrent = (patch: Partial<Channel>) => current && update(current.slot, patch);
  function moveCurrent(slot: number) {
    if (!current || current.slot === slot) return;
    if (workspace.channels.some(c => c.slot === slot)) { notify('编号已占用', true); return; }
    commit({ ...workspace, channels: workspace.channels.map(c => c.slot === current.slot ? { ...c, slot, sourceSlot: c.sourceSlot ?? c.slot } : c) });
    setSelected(s => s.map(n => n === current.slot ? slot : n)); setActive(slot);
    notify(`已移动到信道 ${slotLabel(slot)}`);
  }
  const startNew = () => { commit(emptyWorkspace()); setActive(null); setSelected([]); setView('channels'); notify('已新建方案'); };
  return <div className={`app ${sidebar ? 'sidebar-open' : ''}`} onDragOver={e => { e.preventDefault(); if (e.dataTransfer.types.includes('Files')) setDrop(true); }} onDrop={e => { e.preventDefault(); setDrop(false); if (!radioBusy && e.dataTransfer.files[0]) void readFile(e.dataTransfer.files[0]); }}>
    <input className="file-input" aria-label="导入信道文件" ref={fileRef} type="file" accept=".dat,.xlsx,.xls,.csv,.tsv,.json" onChange={e => { if (e.target.files?.[0]) void readFile(e.target.files[0]); }} />
    <aside className="sidebar" inert={radioBusy}>
      <a className="brand" href="#" onClick={e => { e.preventDefault(); setView('channels'); }}><span className="brand-mark"><Radio size={23} /></span><span>D500<span className="brand-sub">写频工作台</span></span></a>

      <nav><button className={view === 'radio' ? 'nav active' : 'nav'} onClick={() => { setView('radio'); setSidebar(false); }}><Radio size={18} />电台读写{radioConnected && <span className="status-dot" />}</button><button className={view === 'channels' ? 'nav active' : 'nav'} onClick={() => { setView('channels'); setSidebar(false); }}><Radio size={18} />信道管理<span className="nav-count">{workspace.channels.length}</span></button><button className={view === 'settings' ? 'nav active' : 'nav'} onClick={() => { setView('settings'); setSidebar(false); }}><Settings2 size={18} />电台设置</button><button className={view === 'spectrum' ? 'nav active' : 'nav'} onClick={() => { setView('spectrum'); setSidebar(false); }}><Activity size={18} />频率分布</button><button className={view === 'files' ? 'nav active' : 'nav'} onClick={() => { setView('files'); setSidebar(false); }}><FolderOpen size={18} />文件与备份</button></nav>
      <div className="sidebar-section second">我的分组 <button title="显示全部分组" onClick={() => { setView('channels'); setGroup('*'); }}><ListFilter size={14} /></button></div>
      <div className="group-list"><button className={group === '*' ? 'group-nav selected' : 'group-nav'} onClick={() => { setGroup('*'); setView('channels'); }}><span className="group-dot" />全部信道<span>{workspace.channels.length}</span></button>{groups.map((g, i) => <button key={g} className={group === g ? 'group-nav selected' : 'group-nav'} onClick={() => { setGroup(g); setView('channels'); }}><span className={`group-dot color-${i % 4}`} />{g}<span>{workspace.channels.filter(c => c.group === g).length}</span></button>)}{!groups.length && <p className="sidebar-hint">暂无分组</p>}</div>
      <div className="sidebar-bottom"><button className="nav help-nav" onClick={() => setModal('help')}><CircleHelp size={17} />帮助<ChevronRight size={15} /></button><div className="author"><span><strong>BA7KTC</strong></span><span className="version">v0.4 β</span></div></div>
    </aside>
    <div className="workspace-shell">
      <header className="topbar"><div className="breadcrumb"><IconButton title="打开侧栏" onClick={() => setSidebar(!sidebar)}><Menu size={18} /></IconButton><strong>{view === 'channels' ? '信道' : view === 'spectrum' ? '频率分布' : view === 'settings' ? '电台设置' : view === 'radio' ? '电台读写' : '文件'}</strong><span className="save-status">{saving}</span></div><div className="topbar-right"><button className="btn" disabled={radioBusy || busy} onClick={() => fileRef.current?.click()}><Upload size={15} />导入</button><button className="btn" disabled={radioBusy} onClick={() => setModal('export')}><Download size={15} />导出</button><button className="btn primary" disabled={radioBusy} onClick={() => setView('radio')}><Radio size={15} />{radioBusy ? '电台操作中…' : '读写电台'}</button><a className="github-link" href={PROJECT_GITHUB} target="_blank" rel="noreferrer" aria-label="项目 GitHub"><GitBranch size={16} /><span>GitHub</span></a></div></header>
      <main>
        <section className="document-bar" inert={radioBusy}><input aria-label="方案名称" className="project-name" value={workspace.name} onChange={e => commit({ ...workspace, name: e.target.value })} /><span>{workspace.channels.length} / 200 信道</span><button className={issues.length ? 'parameter-check has-issues' : 'parameter-check'} onClick={() => { setShowErrors(!showErrors); setView('channels'); }}><ShieldCheck size={14} />{issues.length ? `${issues.length} 项待检查` : '信道检查通过'}</button>{view === 'channels' && <button className="btn" onClick={add}><Plus size={15} />新建信道</button>}</section>
        <Suspense fallback={view === 'radio' ? <p>正在载入连接工具…</p> : null}><RadioPanel visible={view === 'radio'} workspace={workspace} onConnection={setRadioConnected} onWorking={setRadioBusy} onWritten={next => { setWorkspace(next); setPast([]); setFuture([]); }} onRead={(text, name) => { try { const parsed = parseDat(text, name); setPending({ name: name.replace(/\.dat$/i, ''), ...parsed, type: '电台读取' }); } catch (e) { notify((e as Error).message, true); } }} /></Suspense>
        {view === 'channels' && <section className={`editor-grid ${current ? '' : 'no-inspector'}`}>
          <div className="channel-panel"><div className="panel-head"><div><h2>信道列表 <span>{filtered.length}</span></h2></div><div className="history-controls"><IconButton title="撤销" onClick={undo} disabled={!past.length}><Undo2 size={17} /></IconButton><IconButton title="重做" onClick={redo} disabled={!future.length}><Redo2 size={17} /></IconButton><span /><IconButton title="粘贴表格" onClick={() => setModal('paste')}><Clipboard size={17} /></IconButton></div></div>
            <div className="filterbar"><div className="segmented">{[['all', '全部'], ['vhf', 'VHF'], ['uhf', 'UHF']].map(([id, label]) => <button key={id} className={band === id ? 'selected' : ''} onClick={() => setBand(id)}>{label}</button>)}</div><label className="search"><Search size={15} /><input placeholder="搜索名称、频率、分组…" aria-label="搜索信道" value={query} onChange={e => setQuery(e.target.value)} />{query && <button title="清空搜索" onClick={() => setQuery('')}><X size={13} /></button>}</label><select aria-label="排序方式" value={sortBy} onChange={e => setSortBy(e.target.value as typeof sortBy)}><option value="slot">按编号</option><option value="rx">按频率</option><option value="name">按名称</option></select></div>
            {(selected.length > 0 || group !== '*' || showErrors) && <div className="selectionbar">{selected.length > 0 ? <><strong>已选 {selected.length} 条</strong><button onClick={() => { setBatch(EMPTY_BATCH); setModal('batch'); }}><SlidersHorizontal size={14} />批量编辑</button><button onClick={duplicate}><Copy size={14} />复制</button><button className="danger" onClick={remove}><Trash2 size={14} />删除</button><button onClick={() => setSelected([])}>取消选择</button></> : <span>{group !== '*' ? `分组：${group}` : '仅显示参数问题'}</span>}{(group !== '*' || showErrors) && <button className="reset-filter" onClick={() => { setGroup('*'); setShowErrors(false); }}>清除筛选<X size={12} /></button>}</div>}
            <div className="table-scroll"><table><thead><tr><th className="checkbox-cell"><input aria-label="选择当前列表全部信道" type="checkbox" checked={allVisibleSelected} onChange={() => setSelected(allVisibleSelected ? selected.filter(s => !filtered.some(c => c.slot === s)) : [...new Set([...selected, ...filtered.map(c => c.slot)])])} /></th><th>编号</th><th>信道名称</th><th>接收频率 <small>MHz</small></th><th>发射频率 <small>MHz</small></th><th>接收哑音</th><th>发射哑音</th><th>功率</th><th>带宽</th><th className="row-more" /></tr></thead><tbody>{filtered.map(c => <tr key={c.slot} className={`${active === c.slot ? 'row-active' : ''} ${errorSlots.has(c.slot) ? 'row-error' : ''}`} onClick={() => setActive(c.slot)}><td className="checkbox-cell"><input type="checkbox" aria-label={`选择信道 ${slotLabel(c.slot)}`} checked={selected.includes(c.slot)} onClick={e => e.stopPropagation()} onChange={() => toggle(c.slot)} /></td><td><span className="slot">{slotLabel(c.slot)}</span></td><td><input className="name-cell" aria-label={`信道 ${slotLabel(c.slot)} 名称`} value={c.name} placeholder="未命名" onChange={e => update(c.slot, { name: e.target.value })} /></td><td><input className="freq-cell" inputMode="decimal" aria-label={`信道 ${slotLabel(c.slot)} 接收频率`} value={c.rx} onChange={e => update(c.slot, { rx: e.target.value })} /></td><td><input className={`freq-cell ${c.tx && c.rx !== c.tx ? 'offset-freq' : ''}`} inputMode="decimal" aria-label={`信道 ${slotLabel(c.slot)} 发射频率`} value={c.tx} placeholder="仅接收" onChange={e => update(c.slot, { tx: e.target.value })} /></td><td><ToneEditor compact label={`信道 ${slotLabel(c.slot)} 接收哑音`} value={c.rxTone} onChange={rxTone => update(c.slot, { rxTone })} /></td><td><ToneEditor compact label={`信道 ${slotLabel(c.slot)} 发射哑音`} value={c.txTone} onChange={txTone => update(c.slot, { txTone })} /></td><td><select className="power-select" aria-label={`信道 ${slotLabel(c.slot)} 功率`} value={c.power} onChange={e => update(c.slot, { power: e.target.value as Power })}><option value="high">高</option><option value="low">低</option>{c.power.startsWith('raw:') && <option value={c.power}>{c.power}</option>}</select></td><td><select className="bw-select" aria-label={`信道 ${slotLabel(c.slot)} 带宽`} value={c.bandwidth} onChange={e => update(c.slot, { bandwidth: e.target.value as Channel['bandwidth'] })}><option value="wide">宽带</option><option value="narrow">窄带</option></select></td><td><IconButton title={`编辑信道 ${slotLabel(c.slot)}`} onClick={() => setActive(c.slot)}><ChevronRight size={15} /></IconButton></td></tr>)}</tbody></table>
              {!filtered.length && <div className="empty-state"><span className="empty-radio"><Radio size={34} strokeWidth={1.5} /></span><h3>{workspace.channels.length ? '无匹配信道' : '暂无信道'}</h3><div><button className="btn primary" onClick={() => fileRef.current?.click()}><Upload size={16} />导入</button>{!workspace.channels.length && <button className="btn" onClick={() => { commit(demoWorkspace()); setActive(0); }}>载入示例</button>}</div></div>}
            </div><div className="table-footer"><span><span className="status-dot" />{filtered.length} 条 · 000–199</span><span>{navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'} S 备份</span></div>
          </div>
          {current && <aside className="inspector"><div className="inspector-title"><span><SlidersHorizontal size={16} />信道参数</span><IconButton title="收起参数面板" onClick={() => setActive(null)}><X size={16} /></IconButton></div><div className="radio-display"><div><span>CHANNEL {slotLabel(current.slot)}</span><span>FM <i /></span></div><strong>{Number(current.rx) > 0 ? Number(current.rx).toFixed(5) : '—'}<small>MHz</small></strong><p>{current.name || '未命名信道'}</p><div className="display-bottom"><span>{POWER_LABEL[current.power] ?? '原始'}功率</span><span>{current.bandwidth === 'wide' ? 'WIDE' : 'NARROW'}</span><span>{current.txTone || 'NO TONE'}</span></div></div><div className="inspector-fields"><label>信道编号<select aria-label="移动信道到编号" value={current.slot} onChange={e => moveCurrent(Number(e.target.value))}>{Array.from({length:200},(_,slot) => <option key={slot} value={slot} disabled={slot !== current.slot && workspace.channels.some(c => c.slot === slot)}>{slotLabel(slot)}{slot !== current.slot && workspace.channels.some(c => c.slot === slot) ? " · 已占用" : ""}</option>)}</select></label><label>信道名称 <small>{nameLength(current.name)} / {MAX_NAME_BYTES} 字节</small><input aria-label="详细信道名称" value={current.name} onChange={e => updateCurrent({ name: e.target.value })} placeholder={`最多 ${MAX_NAME_BYTES} 字节`} /><small>屏幕：6 汉字 / 8 英数</small></label><div className="field-pair"><label>接收频率 <small>MHz</small><input className="mono" aria-label="详细接收频率" value={current.rx} onChange={e => updateCurrent({ rx: e.target.value })} /></label><label>发射频率 <small>MHz</small><input className="mono" aria-label="详细发射频率" value={current.tx} placeholder="留空仅接收" onChange={e => updateCurrent({ tx: e.target.value })} /></label></div><div className="offset-helper"><span>收发频差 <strong>{current.tx && current.rx ? `${Number(current.tx) - Number(current.rx) >= 0 ? '+' : ''}${(Number(current.tx) - Number(current.rx)).toFixed(5)} MHz` : '仅接收'}</strong></span><button title="将发射频率设为接收频率" onClick={() => updateCurrent({ tx: current.rx })}>设为直通</button></div><div className="tone-field"><span>接收哑音</span><ToneEditor key={`${current.slot}-rx`} label="详细接收哑音" value={current.rxTone} onChange={rxTone => updateCurrent({ rxTone })} /></div><div className="tone-field"><span>发射哑音</span><ToneEditor key={`${current.slot}-tx`} label="详细发射哑音" value={current.txTone} onChange={txTone => updateCurrent({ txTone })} /></div><div className="field-pair"><label>发射功率<select aria-label="详细发射功率" value={current.power} onChange={e => updateCurrent({ power: e.target.value as Power })}><option value="high">高功率</option><option value="low">低功率</option>{current.power.startsWith('raw:') && <option value={current.power}>保留 {current.power}</option>}</select></label><label>信道带宽<select aria-label="详细信道带宽" value={current.bandwidth} onChange={e => updateCurrent({ bandwidth: e.target.value as Channel['bandwidth'] })}><option value="wide">宽带 · 25 kHz</option><option value="narrow">窄带 · 12.5 kHz</option></select></label></div><label className="toggle-field"><span>繁忙禁发</span><input aria-label="详细繁忙禁发" role="switch" type="checkbox" checked={current.busy} onChange={e => updateCurrent({ busy: e.target.checked })} /></label><label className="toggle-field"><span>扫描添加</span><input aria-label="详细扫描添加" role="switch" type="checkbox" checked={current.scanAdd} onChange={e => updateCurrent({ scanAdd: e.target.checked })} /></label><details className="advanced-fields"><summary>高级参数<ChevronDown size={14} /></summary><div><label>PTT-ID<select aria-label="详细 PTT-ID" value={current.pttId} onChange={e => updateCurrent({ pttId: Number(e.target.value) })}>{PTT_OPTIONS.map((s, i) => <option key={i} value={i}>{s}</option>)}</select></label><div className="field-pair"><label>信令码组<select aria-label="详细信令码组" value={current.signalCode} onChange={e => updateCurrent({ signalCode: Number(e.target.value) })}>{Array.from({ length: 15 }, (_, i) => <option key={i} value={i}>{i + 1}</option>)}{current.signalCode > 14 && <option value={current.signalCode}>原始值 {current.signalCode}</option>}</select></label><label>可选信令<select aria-label="详细可选信令" value={current.optionalSignal} onChange={e => updateCurrent({ optionalSignal: Number(e.target.value) })}>{SIGNAL_OPTIONS.map((s, i) => <option key={i} value={i}>{s}</option>)}{current.optionalSignal > 3 && <option value={current.optionalSignal}>原始值 {current.optionalSignal}</option>}</select></label></div><label>静音方式<select aria-label="详细静音方式" value={current.muteMode} onChange={e => updateCurrent({ muteMode: Number(e.target.value) })}>{MUTE_OPTIONS.map((s, i) => <option key={i} value={i}>{s}</option>)}{current.muteMode > 2 && <option value={current.muteMode}>原始值 {current.muteMode}</option>}</select></label><label className="toggle-field"><span>扰频</span><input aria-label="详细扰频" role="switch" type="checkbox" checked={current.scramble} onChange={e => updateCurrent({ scramble: e.target.checked })} /></label></div></details><div className="field-divider" /><label>分组<input aria-label="信道分组" list="group-options" value={current.group} onChange={e => updateCurrent({ group: e.target.value })} /></label><label>备注<textarea aria-label="信道备注" rows={2} value={current.note} onChange={e => updateCurrent({ note: e.target.value })} /></label>{issues.filter(i => i.slot === current.slot).map((i, n) => <div key={n} className="inline-error">{i.message}</div>)}<div className="inspector-actions"><button className="btn" onClick={duplicate}><Copy size={14} />复制信道</button><IconButton title="删除当前信道" danger onClick={remove}><Trash2 size={16} /></IconButton></div></div></aside>}
        </section>}
        {view === 'settings' && <RadioSettingsPanel template={workspace.template} settings={workspace.settings} onChange={settings => commit({ ...workspace, settings })} onImport={() => fileRef.current?.click()} />}
        {view === 'spectrum' && <section className="spectrum-panel"><div className="panel-head"><div><h2>频率分布</h2></div><span className="tag">{workspace.channels.length} 个频点</span></div>{[['VHF', 130, 180], ['UHF', 400, 480]].map(([name, min, max]) => <div className="band-chart" key={name}><div className="band-chart-title"><strong>{name}</strong><span>{min}–{max} MHz</span></div><div className="spectrum-grid">{Array.from({ length: 6 }, (_, i) => <span className="grid-line" key={i} style={{ left: `${i * 20}%` }}><small>{Number(min) + (Number(max) - Number(min)) * i / 5}</small></span>)}{workspace.channels.filter(c => Number(c.rx) >= Number(min) && Number(c.rx) <= Number(max)).map((c, i) => <button key={c.slot} className="frequency-bar" style={{ left: `${(Number(c.rx) - Number(min)) / (Number(max) - Number(min)) * 100}%`, height: `${28 + (i % 5) * 15}px` }} title={`${slotLabel(c.slot)} ${c.name} · ${c.rx} MHz`} aria-label={`查看信道 ${slotLabel(c.slot)}`} onClick={() => { setActive(c.slot); setView('channels'); }} />)}</div></div>)}<div className="spectrum-list">{workspace.channels.slice().sort((a, b) => Number(a.rx) - Number(b.rx)).map(c => <button key={c.slot} onClick={() => { setActive(c.slot); setView('channels'); }}><span className="slot">{slotLabel(c.slot)}</span><span>{c.name || '未命名'}</span><strong className="mono">{c.rx}</strong><ChevronRight size={14} /></button>)}</div></section>}
        {view === 'files' && <section className="file-list"><article><FileCode2 size={22} /><div><h2>DAT</h2><p>{workspace.template?.fileName ?? '尚未载入 DAT'}</p></div><button className="btn" onClick={() => fileRef.current?.click()}>导入文件</button><button className="btn" onClick={() => runExport('dat')}>导出 DAT</button></article><article><HardDrive size={22} /><div><h2>完整方案</h2><p>信道、设置、分组与备注</p></div><button className="btn" onClick={() => runExport('project')}>下载备份</button></article><article><FileSpreadsheet size={22} /><div><h2>表格导入</h2><p>XLSX / CSV / TSV</p></div><button className="btn" onClick={() => fileRef.current?.click()}>选择表格</button><button className="btn" onClick={() => setModal('paste')}>粘贴表格</button></article><article><Plus size={22} /><div><h2>新建方案</h2></div><button className="btn" onClick={startNew}>新建</button></article></section>}
        <footer className="page-footer"><span><ShieldCheck size={13} />本地处理</span><span>BA7KTC <span className="footer-dot">/</span> D500 Workbench <span className="footer-dot">/</span><a href={PROJECT_GITHUB} target="_blank" rel="noreferrer">GitHub</a></span></footer>
      </main>
    </div>
    <datalist id="group-options">{groups.map(g => <option key={g} value={g} />)}</datalist>
    {toast && <div className={`toast ${toast.error ? 'error' : ''}`} role={toast.error ? 'alert' : 'status'}><span>{toast.error ? <CircleHelp size={18} /> : <Check size={18} />}</span>{toast.text}<button aria-label="关闭提示" onClick={() => setToast(null)}><X size={15} /></button></div>}
    {drop && <div className="drop-overlay" onDragLeave={() => setDrop(false)}><Upload size={45} /><h2>松开以导入</h2><p>DAT · XLSX · CSV · 方案备份</p></div>}
    {pending && <ModalShell title="导入" subtitle={`${pending.type} · ${pending.name}`} close={() => setPending(null)}><div className="import-summary"><FileText size={30} /><div><strong>{pending.channels.length} 条信道</strong><span>{pending.template ? '含电台配置' : '仅信道'}</span></div><CheckCheck size={25} /></div><div className="import-preview">{pending.channels.slice(0, 5).map(c => <div key={c.slot}><span className="slot">{slotLabel(c.slot)}</span><span>{c.name || '未命名'}</span><span className="mono">{c.rx}</span></div>)}{pending.channels.length > 5 && <p>另 {pending.channels.length - 5} 条</p>}</div>{pending.warnings.map((w, i) => <p className="import-note" key={i}>{w}</p>)}<div className="modal-actions">{pending.template && <button className="btn" onClick={() => acceptImport('template')}>仅载入配置</button>}<button className="btn" onClick={() => acceptImport('merge')}>按编号合并</button><button className="btn primary" onClick={() => acceptImport('replace')}>{pending.template ? '替换信道与配置' : '替换信道'}</button></div></ModalShell>}
    {modal === 'export' && <ModalShell title="导出"  close={() => setModal(null)}><div className="export-change-summary"><strong>{workspace.channels.length} 条信道</strong><span>{workspace.template ? `${settingsChanges(workspace.settings, readSettings(workspace.template.rows))} 项设置修改` : '未载入 DAT'}</span></div><div className="export-options"><button onClick={() => runExport('dat')}><span className="format-icon"><FileCode2 size={24} /></span><span><strong>写频文件 <em>.dat</em></strong><small>{workspace.template ? `模板：${workspace.template.fileName}` : '请先载入 DAT'}</small></span><ArrowDownToLine size={18} /></button><button onClick={() => runExport('project')}><span className="format-icon"><Save size={24} /></span><span><strong>完整方案 <em>.d500.json</em></strong><small>含设置、分组、备注与模板</small></span><ArrowDownToLine size={18} /></button></div>{issues.length > 0 && <div className="inline-error">{issues.filter(i => i.severity === 'error').length} 项错误 · {issues.filter(i => i.severity === 'warning').length} 项提示</div>}</ModalShell>}
    {modal === 'batch' && <ModalShell title={`批量编辑 ${selected.length} 条信道`} close={() => setModal(null)}><div className="batch-form"><div className="field-pair"><label>功率<select aria-label="批量功率" value={batch.power} onChange={e => setBatch({ ...batch, power: e.target.value })}><option value="">保持原值</option><option value="high">高</option><option value="low">低</option></select></label><label>带宽<select aria-label="批量带宽" value={batch.bandwidth} onChange={e => setBatch({ ...batch, bandwidth: e.target.value })}><option value="">保持原值</option><option value="wide">宽带</option><option value="narrow">窄带</option></select></label></div>{(['rxTone', 'txTone'] as const).map((field, i) => <div key={field} className="batch-tone"><label className="check-label"><input type="checkbox" checked={batch[field] !== null} onChange={e => setBatch({ ...batch, [field]: e.target.checked ? '' : null })} />修改{i ? '发射' : '接收'}哑音</label>{batch[field] !== null && <ToneEditor label={`批量${i ? '发射' : '接收'}哑音`} value={batch[field]} onChange={value => setBatch({ ...batch, [field]: value })} />}</div>)}<div className="field-pair">{(['scanAdd', 'busy'] as const).map((field, i) => <label key={field}>{i ? '繁忙禁发' : '扫描添加'}<select aria-label={`批量${i ? '繁忙禁发' : '扫描添加'}`} value={batch[field]} onChange={e => setBatch({ ...batch, [field]: e.target.value })}><option value="">保持原值</option><option value="on">开启</option><option value="off">关闭</option></select></label>)}</div><div className="field-pair"><label>PTT-ID<select aria-label="批量 PTT-ID" value={batch.pttId} onChange={e => setBatch({ ...batch, pttId: e.target.value })}><option value="">保持原值</option>{PTT_OPTIONS.map((s, i) => <option key={i} value={i}>{s}</option>)}</select></label><label>分组<input list="group-options" placeholder="保持原值" value={batch.group} onChange={e => setBatch({ ...batch, group: e.target.value })} /></label></div><label>统一收发频差 <small>发射 = 接收 + 频差，MHz</small><input aria-label="批量频差" placeholder="-5.00000" value={batch.offset} onChange={e => setBatch({ ...batch, offset: e.target.value })} /></label></div><div className="modal-actions"><button className="btn" onClick={() => setModal(null)}>取消</button><button className="btn primary" onClick={applyBatch}>应用修改</button></div></ModalShell>}
    {modal === 'paste' && <ModalShell title="粘贴表格" close={() => setModal(null)}><p className="import-note">无表头列顺序：名称、接收 MHz、发射 MHz、发射哑音。</p><textarea className="paste-area mono" aria-label="粘贴信道数据" placeholder={'本地直通\t438.50000\t438.50000\t\nU段中继\t439.55000\t434.55000\t88.5'} value={paste} onChange={e => setPaste(e.target.value)} /><div className="modal-actions"><button className="btn primary" disabled={!paste.trim()} onClick={() => void pasteImport()}>预览</button></div></ModalShell>}
    {modal === 'help' && <ModalShell title="帮助" subtitle={`v${version} · BA7KTC`} close={() => setModal(null)}><div className="help-content"><h3>读写</h3><p>默认只写修改；完整覆盖请选择完整写入。核对时手动读取。</p><h3>文件</h3><p>DAT 保存信道与配置；完整方案另含分组和备注。支持 XLSX / CSV / TSV 导入。</p><h3>保存</h3><p>草稿保存在本机；跨设备使用请导出完整方案。</p><div className="help-links"><a href={PROJECT_GITHUB} target="_blank" rel="noreferrer"><GitBranch size={15} />GitHub</a><a href="/source.zip" download>源码<Download size={14} /></a><a href="/LICENSE.txt" target="_blank" rel="noreferrer">许可证<ChevronRight size={14} /></a></div></div></ModalShell>}
  </div>;
}
