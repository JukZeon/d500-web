import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Activity, ArrowDownToLine, ArrowLeftRight, ArrowUpFromLine, Check, CheckCheck, ChevronDown, ChevronRight, CircleHelp, Clipboard, Copy, Download, FileCode2, FileSpreadsheet, FileText, Folder, FolderOpen, HardDrive, History, ListFilter, Menu, MoreHorizontal, Plus, Radio, Redo2, Save, Search, Settings2, ShieldCheck, SlidersHorizontal, Trash2, Undo2, Upload, X } from 'lucide-react';
import { type Channel, type Workspace, type Power, demoWorkspace, emptyWorkspace, newChannel, nextSlot, slotLabel, POWER_LABEL } from './lib/model';
import { CTCSS, DCS_CODES, exportDat, parseDat, validateChannels } from './lib/dat';
import { exportCsv, exportWorkbook, importWorkbook } from './lib/workbook';
import { download, parseProject } from './lib/project';

const STORAGE = 'ba7ktc-d500-workspace-v1';
type Modal = 'help' | 'batch' | 'export' | 'paste' | null;
type Pending = { name: string; channels: Channel[]; template: Workspace['template']; warnings: string[]; type: string };
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
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) close(); }}><div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} className="modal"><header><div><span className="eyebrow">D500 WORKBENCH</span><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><IconButton title="关闭对话框" onClick={close}><X size={20} /></IconButton></header>{children}</div></div>;
}
export default function App() {
  const [workspace, setWorkspace] = useState<Workspace>(initial);
  const [past, setPast] = useState<Workspace[]>([]), [future, setFuture] = useState<Workspace[]>([]);
  const [selected, setSelected] = useState<number[]>([]), [active, setActive] = useState<number | null>(null);
  const [query, setQuery] = useState(''), [band, setBand] = useState('all'), [group, setGroup] = useState('*');
  const [view, setView] = useState('channels'), [modal, setModal] = useState<Modal>(null), [pending, setPending] = useState<Pending | null>(null);
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null), [saving, setSaving] = useState('已保存到本机');
  const [drop, setDrop] = useState(false), [busy, setBusy] = useState(false), [sidebar, setSidebar] = useState(false);
  const [paste, setPaste] = useState(''), [batch, setBatch] = useState({ power: '', bandwidth: '', txTone: '', group: '', offset: '', clearTone: false });
  const [showErrors, setShowErrors] = useState(false), [sortBy, setSortBy] = useState<'slot' | 'rx' | 'name'>('slot');
  const fileRef = useRef<HTMLInputElement>(null);
  const notify = (text: string, error = false) => setToast({ text, error });
  const commit = (next: Workspace) => { setPast(p => [...p.slice(-49), workspace]); setFuture([]); setWorkspace({ ...next, updatedAt: new Date().toISOString() }); };
  const update = (slot: number, patch: Partial<Channel>) => commit({ ...workspace, channels: workspace.channels.map(c => c.slot === slot ? { ...c, ...patch } : c) });
  const undo = () => { if (!past.length) return; setFuture(f => [workspace, ...f]); setWorkspace(past[past.length - 1]); setPast(past.slice(0, -1)); };
  const redo = () => { if (!future.length) return; setPast(p => [...p, workspace]); setWorkspace(future[0]); setFuture(future.slice(1)); };
  useEffect(() => {
    setSaving('正在保存…');
    const id = setTimeout(() => {
      try { localStorage.setItem(STORAGE, JSON.stringify(workspace)); setSaving('已保存到本机'); }
      catch { setSaving('本机存储已满，请导出方案备份'); }
    }, 350);
    return () => clearTimeout(id);
  }, [workspace]);
  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(null), 5500); return () => clearTimeout(id); }, [toast]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const editing = e.target instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName);
      if (e.key.toLowerCase() === 's') { e.preventDefault(); download(JSON.stringify(workspace, null, 2), workspace.name + '.d500.json', 'application/json'); }
      if (e.key.toLowerCase() === 'z' && !editing) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
    };
    window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler);
  });
  const issues = useMemo(() => validateChannels(workspace.channels), [workspace.channels]);
  const errorSlots = new Set(issues.filter(i => i.severity === 'error').map(i => i.slot));
  const groups = [...new Set(workspace.channels.map(c => c.group).filter(Boolean))].sort();
  const filtered = workspace.channels.filter(c => {
    const q = query.trim().toLowerCase();
    return (!q || [c.name, c.rx, c.tx, slotLabel(c.slot), c.group, c.note].some(v => v.toLowerCase().includes(q))) &&
      (band === 'all' || (band === 'vhf' ? Number(c.rx) < 300 : Number(c.rx) >= 300)) &&
      (group === '*' || c.group === group) && (!showErrors || errorSlots.has(c.slot));
  }).sort((a, b) => sortBy === 'slot' ? a.slot - b.slot : sortBy === 'rx' ? Number(a.rx) - Number(b.rx) : a.name.localeCompare(b.name, 'zh-CN'));
  const current = workspace.channels.find(c => c.slot === active);
  const repeaters = workspace.channels.filter(c => c.tx && c.rx && Number(c.rx) !== Number(c.tx)).length;
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
    setSelected([]); setActive(null); notify(`已删除 ${slots.length} 条信道，可撤销恢复`);
  }
  async function readFile(file: File) {
    setBusy(true);
    try {
      if (file.size > 8 * 1024 * 1024) throw new Error('文件超过 8 MB。');
      if (/\.dat$/i.test(file.name)) {
        const parsed = parseDat(await file.text(), file.name);
        setPending({ name: file.name.replace(/\.dat$/i, ''), ...parsed, type: 'D500 DAT' });
      } else if (/\.(xlsx|xls|csv|tsv)$/i.test(file.name)) {
        const result = importWorkbook(await file.arrayBuffer(), file.name);
        const baseline = new Map((workspace.template?.originalChannels ?? []).map(c => [c.slot, c]));
        for (const c of workspace.channels) baseline.set(c.slot, c);
        const channels = result.channels.map(c => {
          const before = baseline.get(c.slot); if (!before) return c;
          const preserved: Partial<Channel> = {};
          for (const field of ['bandwidth', 'busy', 'group', 'note', 'power'] as const) if (!result.providedFields.includes(field)) Object.assign(preserved, { [field]: before[field] });
          return { ...c, ...preserved };
        });
        setPending({ name: file.name.replace(/\.[^.]+$/, ''), channels, template: null, warnings: result.warnings, type: result.detected });
      } else if (/\.json$/i.test(file.name)) {
        const w = parseProject(await file.text());
        setPending({ name: w.name, channels: w.channels, template: w.template, warnings: ['将恢复信道、分组、备注和原始 DAT 模板。'], type: 'D500 方案备份' });
      } else throw new Error('支持 DAT、XLSX、CSV、TSV 和 D500 JSON 方案。');
    } catch (e) { notify((e as Error).message, true); }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = ''; }
  }
  function acceptImport(mode: 'replace' | 'merge' | 'template') {
    if (!pending) return;
    if (mode === 'template') { commit({ ...workspace, template: pending.template }); notify('已载入 DAT 模板，现有信道保持不变'); }
    else if (mode === 'replace') {
      commit({ ...workspace, name: pending.name, channels: pending.channels, template: pending.template ?? workspace.template });
      setSelected([]); setActive(null); notify(`已导入 ${pending.channels.length} 条信道`);
    } else {
      const map = new Map(workspace.channels.map(c => [c.slot, c]));
      for (const c of pending.channels) map.set(c.slot, c);
      commit({ ...workspace, channels: [...map.values()], template: workspace.template ?? pending.template });
      notify(`已合并 ${pending.channels.length} 条信道，同编号已替换`);
    }
    setPending(null); setView('channels'); setBand('all'); setGroup('*'); setQuery('');
  }
  function runExport(kind: 'dat' | 'xlsx' | 'csv' | 'project' | 'template') {
    try {
      const name = workspace.name || 'D500';
      if (kind === 'dat') { download(exportDat(workspace.channels, workspace.template), name + '.dat'); notify('DAT 已导出，原始配置区和未编辑字段已保留'); }
      if (kind === 'xlsx' || kind === 'template') { download(exportWorkbook(kind === 'template' ? [] : workspace.channels, name), kind === 'template' ? 'D500_信道模板.xlsx' : name + '.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); notify(kind === 'template' ? '空白表格模板已下载' : 'Excel 信道表已导出'); }
      if (kind === 'csv') { download(exportCsv(workspace.channels), name + '.csv', 'text/csv;charset=utf-8'); notify('CSV 已导出'); }
      if (kind === 'project') { download(JSON.stringify(workspace, null, 2), name + '.d500.json', 'application/json'); notify('完整方案已备份，包含原始 DAT 模板'); }
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
        if (batch.clearTone) patch.txTone = ''; else if (batch.txTone) patch.txTone = batch.txTone;
        if (batch.group) patch.group = batch.group;
        if (batch.offset) { const n = Number(batch.offset); if (!Number.isFinite(n)) throw new Error('频差必须为数值'); patch.tx = (Number(c.rx) + n).toFixed(5); }
        return { ...c, ...patch };
      });
      const bad = validateChannels(channels); if (bad.length) throw new Error(`信道 ${slotLabel(bad[0].slot)}：${bad[0].message}`);
      commit({ ...workspace, channels }); setModal(null); notify(`已更新 ${selected.length} 条信道，可撤销恢复`);
    } catch (e) { notify((e as Error).message, true); }
  }
  async function pasteImport() {
    const header = '信道名称\t接收频率\t发射频率\t发射亚音\n';
    const text = /接收|rx.?freq/i.test(paste.split('\n')[0]) ? paste : header + paste;
    await readFile(new File([text], '粘贴的信道.tsv', { type: 'text/tab-separated-values' })); setModal(null);
  }
  const updateCurrent = (patch: Partial<Channel>) => current && update(current.slot, patch);
  const startNew = () => { commit(emptyWorkspace()); setActive(null); setSelected([]); setView('channels'); notify('已新建空白方案，原方案可通过撤销恢复'); };
  return <div className={`app ${sidebar ? 'sidebar-open' : ''}`} onDragOver={e => { e.preventDefault(); if (e.dataTransfer.types.includes('Files')) setDrop(true); }} onDrop={e => { e.preventDefault(); setDrop(false); if (e.dataTransfer.files[0]) void readFile(e.dataTransfer.files[0]); }}>
    <input className="file-input" aria-label="导入信道文件" ref={fileRef} type="file" accept=".dat,.xlsx,.xls,.csv,.tsv,.json" onChange={e => { if (e.target.files?.[0]) void readFile(e.target.files[0]); }} />
    <aside className="sidebar">
      <a className="brand" href="#" onClick={e => { e.preventDefault(); setView('channels'); }}><span className="brand-mark"><Activity size={25} strokeWidth={2.5} /></span><span>D500<span className="brand-sub">WORKBENCH</span></span></a>
      <div className="sidebar-section">工作空间 <span>01</span></div>
      <nav><button className={view === 'channels' ? 'nav active' : 'nav'} onClick={() => { setView('channels'); setSidebar(false); }}><Radio size={18} />信道管理<span className="nav-count">{workspace.channels.length}</span></button><button className={view === 'spectrum' ? 'nav active' : 'nav'} onClick={() => { setView('spectrum'); setSidebar(false); }}><Activity size={18} />频率分布</button><button className={view === 'files' ? 'nav active' : 'nav'} onClick={() => { setView('files'); setSidebar(false); }}><FolderOpen size={18} />文件与备份</button></nav>
      <div className="sidebar-section second">我的分组 <button title="显示全部分组" onClick={() => { setView('channels'); setGroup('*'); }}><ListFilter size={14} /></button></div>
      <div className="group-list"><button className={group === '*' ? 'group-nav selected' : 'group-nav'} onClick={() => { setGroup('*'); setView('channels'); }}><span className="group-dot" />全部信道<span>{workspace.channels.length}</span></button>{groups.map((g, i) => <button key={g} className={group === g ? 'group-nav selected' : 'group-nav'} onClick={() => { setGroup(g); setView('channels'); }}><span className={`group-dot color-${i % 4}`} />{g}<span>{workspace.channels.filter(c => c.group === g).length}</span></button>)}{!groups.length && <p className="sidebar-hint">在右侧为信道填写分组<br />让你的频点更有条理。</p>}</div>
      <div className="sidebar-bottom"><div className="local-badge"><ShieldCheck size={16} /><span>本地处理，资料留在浏览器</span></div><button className="nav help-nav" onClick={() => setModal('help')}><CircleHelp size={17} />使用说明与关于<ChevronRight size={15} /></button><div className="author"><span className="avatar">BA</span><span><strong>BA7KTC</strong><small>Designed for the airwaves.</small></span><span className="version">v0.1</span></div></div>
    </aside>
    <div className="workspace-shell">
      <header className="topbar"><div className="breadcrumb"><IconButton title="打开侧栏" onClick={() => setSidebar(!sidebar)}><Menu size={18} /></IconButton><span>工作空间</span><ChevronRight size={14} /><strong>{view === 'channels' ? '信道管理' : view === 'spectrum' ? '频率分布' : '文件与备份'}</strong></div><div className="topbar-right"><span className="save-status"><span className="status-dot" />{saving}</span><span className="device-tag"><Radio size={13} />D500 · V1</span><IconButton title="使用说明" onClick={() => setModal('help')}><CircleHelp size={19} /></IconButton></div></header>
      <main>
        <section className="page-heading"><div><div className="eyebrow">YOUR FREQUENCIES. YOUR WORKSPACE.</div><input aria-label="方案名称" className="project-name" value={workspace.name} onChange={e => commit({ ...workspace, name: e.target.value })} /><p>让每个频点井然有序。编辑、整理，再带着它出发。</p></div><div className="heading-actions"><button className="btn" onClick={() => fileRef.current?.click()} disabled={busy}><Upload size={16} />{busy ? '正在解析…' : '导入文件'}</button><button className="btn" onClick={() => setModal('export')}><Download size={16} />导出<ChevronDown size={14} /></button><button className="btn primary" onClick={add}><Plus size={17} />新建信道</button></div></section>
        <section className="overview"><div className="capacity"><div className="stat-label"><Radio size={15} />已用信道<span>CHANNELS</span></div><div className="stat-value">{workspace.channels.length}<span>/ 200</span><small>{200 - workspace.channels.length} 个可用槽位</small></div><div className="capacity-track"><span style={{ width: `${workspace.channels.length / 2}%` }} /></div></div><div className="stat"><div className="stat-label"><ArrowLeftRight size={15} />中继 / 差频</div><div className="stat-value">{repeaters}<span>条信道</span></div><small>收发频率不同</small></div><div className="stat"><div className="stat-label"><Folder size={15} />信道分组</div><div className="stat-value">{groups.length}<span>个分组</span></div><small>按用途自由归类</small></div><button className={`stat validation-stat ${issues.length ? 'has-issues' : ''}`} onClick={() => { setShowErrors(!showErrors); setView('channels'); }}><div className="stat-label"><ShieldCheck size={15} />参数检查</div><div className="stat-value">{issues.length ? issues.length : <CheckCheck size={29} />}<span>{issues.length ? '处待处理' : '状态良好'}</span></div><small>{issues.length ? '点击查看需要调整的信道' : '频率、亚音与名称自动检查'}</small></button></section>
        {view === 'channels' && <section className={`editor-grid ${current ? '' : 'no-inspector'}`}>
          <div className="channel-panel"><div className="panel-head"><div><h2>信道列表 <span>{filtered.length}</span></h2><p>直接编辑表格，点选信道查看完整参数。</p></div><div className="history-controls"><IconButton title="撤销" onClick={undo} disabled={!past.length}><Undo2 size={17} /></IconButton><IconButton title="重做" onClick={redo} disabled={!future.length}><Redo2 size={17} /></IconButton><span /><IconButton title="粘贴表格" onClick={() => setModal('paste')}><Clipboard size={17} /></IconButton><IconButton title="下载空白 XLSX 模板" onClick={() => runExport('template')}><FileSpreadsheet size={17} /></IconButton></div></div>
            <div className="filterbar"><div className="segmented">{[['all', '全部'], ['vhf', 'VHF'], ['uhf', 'UHF']].map(([id, label]) => <button key={id} className={band === id ? 'selected' : ''} onClick={() => setBand(id)}>{label}</button>)}</div><label className="search"><Search size={15} /><input placeholder="搜索名称、频率、分组…" aria-label="搜索信道" value={query} onChange={e => setQuery(e.target.value)} />{query && <button title="清空搜索" onClick={() => setQuery('')}><X size={13} /></button>}</label><select aria-label="排序方式" value={sortBy} onChange={e => setSortBy(e.target.value as typeof sortBy)}><option value="slot">按编号</option><option value="rx">按频率</option><option value="name">按名称</option></select></div>
            {(selected.length > 0 || group !== '*' || showErrors) && <div className="selectionbar">{selected.length > 0 ? <><strong>已选 {selected.length} 条</strong><button onClick={() => { setBatch({ power: '', bandwidth: '', txTone: '', group: '', offset: '', clearTone: false }); setModal('batch'); }}><SlidersHorizontal size={14} />批量编辑</button><button onClick={duplicate}><Copy size={14} />复制</button><button className="danger" onClick={remove}><Trash2 size={14} />删除</button><button onClick={() => setSelected([])}>取消选择</button></> : <span>{group !== '*' ? `分组：${group}` : '仅显示参数问题'}</span>}{(group !== '*' || showErrors) && <button className="reset-filter" onClick={() => { setGroup('*'); setShowErrors(false); }}>清除筛选<X size={12} /></button>}</div>}
            <div className="table-scroll"><table><thead><tr><th className="checkbox-cell"><input aria-label="选择当前列表全部信道" type="checkbox" checked={allVisibleSelected} onChange={() => setSelected(allVisibleSelected ? selected.filter(s => !filtered.some(c => c.slot === s)) : [...new Set([...selected, ...filtered.map(c => c.slot)])])} /></th><th>编号</th><th>信道名称</th><th>接收频率 <small>MHz</small></th><th>发射频率 <small>MHz</small></th><th>发射亚音</th><th>功率</th><th>带宽</th><th className="row-more" /></tr></thead><tbody>{filtered.map(c => <tr key={c.slot} className={`${active === c.slot ? 'row-active' : ''} ${errorSlots.has(c.slot) ? 'row-error' : ''}`} onClick={() => setActive(c.slot)}><td className="checkbox-cell"><input type="checkbox" aria-label={`选择信道 ${slotLabel(c.slot)}`} checked={selected.includes(c.slot)} onClick={e => e.stopPropagation()} onChange={() => toggle(c.slot)} /></td><td><span className="slot">{slotLabel(c.slot)}</span></td><td><input className="name-cell" aria-label={`信道 ${slotLabel(c.slot)} 名称`} value={c.name} placeholder="未命名" onChange={e => update(c.slot, { name: e.target.value })} /></td><td><input className="freq-cell" inputMode="decimal" aria-label={`信道 ${slotLabel(c.slot)} 接收频率`} value={c.rx} onChange={e => update(c.slot, { rx: e.target.value })} /></td><td><input className={`freq-cell ${c.tx && c.rx !== c.tx ? 'offset-freq' : ''}`} inputMode="decimal" aria-label={`信道 ${slotLabel(c.slot)} 发射频率`} value={c.tx} placeholder="仅接收" onChange={e => update(c.slot, { tx: e.target.value })} /></td><td><input className="tone-cell" list="tone-options" aria-label={`信道 ${slotLabel(c.slot)} 发射亚音`} value={c.txTone} placeholder="—" onChange={e => update(c.slot, { txTone: e.target.value })} /></td><td><select className="power-select" aria-label={`信道 ${slotLabel(c.slot)} 功率`} value={c.power} onChange={e => update(c.slot, { power: e.target.value as Power })}><option value="high">高</option><option value="mid">中</option><option value="low">低</option>{c.power.startsWith('raw:') && <option value={c.power}>{c.power}</option>}</select></td><td><select className="bw-select" aria-label={`信道 ${slotLabel(c.slot)} 带宽`} value={c.bandwidth} onChange={e => update(c.slot, { bandwidth: e.target.value as Channel['bandwidth'] })}><option value="wide">宽带</option><option value="narrow">窄带</option></select></td><td><IconButton title={`编辑信道 ${slotLabel(c.slot)}`} onClick={() => setActive(c.slot)}><ChevronRight size={15} /></IconButton></td></tr>)}</tbody></table>
              {!filtered.length && <div className="empty-state"><span className="empty-radio"><Radio size={34} strokeWidth={1.5} /></span><h3>{workspace.channels.length ? '没有找到匹配的信道' : '你的下一个频点，从这里开始'}</h3><p>{workspace.channels.length ? '试试其他关键词，或清除当前筛选。' : '拖入 DAT / Excel 文件，或新建一条信道。所有编辑都在本地完成。'}</p><div><button className="btn primary" onClick={() => fileRef.current?.click()}><Upload size={16} />导入信道文件</button>{!workspace.channels.length && <button className="btn" onClick={() => { commit(demoWorkspace()); setActive(0); }}>体验演示方案</button>}</div></div>}
            </div><div className="table-footer"><span><span className="status-dot" />{filtered.length} 条信道 · D500 原生编号 000–199</span><span>点选编辑 · {navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'} S 备份</span></div>
          </div>
          {current && <aside className="inspector"><div className="inspector-title"><span><SlidersHorizontal size={16} />信道参数</span><IconButton title="收起参数面板" onClick={() => setActive(null)}><X size={16} /></IconButton></div><div className="radio-display"><div><span>CHANNEL {slotLabel(current.slot)}</span><span>FM <i /></span></div><strong>{Number(current.rx) > 0 ? Number(current.rx).toFixed(5) : '—'}<small>MHz</small></strong><p>{current.name || '未命名信道'}</p><div className="display-bottom"><span>{POWER_LABEL[current.power] ?? '原始'}功率</span><span>{current.bandwidth === 'wide' ? 'WIDE' : 'NARROW'}</span><span>{current.txTone || 'NO TONE'}</span></div></div><div className="inspector-fields"><label>信道名称<input aria-label="详细信道名称" value={current.name} onChange={e => updateCurrent({ name: e.target.value })} placeholder="最多 8 个汉字 / 16 字节" /></label><div className="field-pair"><label>接收频率 <small>MHz</small><input className="mono" aria-label="详细接收频率" value={current.rx} onChange={e => updateCurrent({ rx: e.target.value })} /></label><label>发射频率 <small>MHz</small><input className="mono" aria-label="详细发射频率" value={current.tx} placeholder="留空仅接收" onChange={e => updateCurrent({ tx: e.target.value })} /></label></div><div className="offset-helper"><span>收发频差 <strong>{current.tx && current.rx ? `${Number(current.tx) - Number(current.rx) >= 0 ? '+' : ''}${(Number(current.tx) - Number(current.rx)).toFixed(5)} MHz` : '仅接收'}</strong></span><button title="将发射频率设为接收频率" onClick={() => updateCurrent({ tx: current.rx })}>设为直通</button></div><div className="field-pair"><label>接收亚音<input list="tone-options" aria-label="详细接收亚音" value={current.rxTone} placeholder="关闭" onChange={e => updateCurrent({ rxTone: e.target.value })} /></label><label>发射亚音<input list="tone-options" aria-label="详细发射亚音" value={current.txTone} placeholder="关闭" onChange={e => updateCurrent({ txTone: e.target.value })} /></label></div><div className="field-pair"><label>发射功率<select aria-label="详细发射功率" value={current.power} onChange={e => updateCurrent({ power: e.target.value as Power })}><option value="high">高功率</option><option value="mid">中功率</option><option value="low">低功率</option>{current.power.startsWith('raw:') && <option value={current.power}>保留 {current.power}</option>}</select></label><label>信道带宽<select aria-label="详细信道带宽" value={current.bandwidth} onChange={e => updateCurrent({ bandwidth: e.target.value as Channel['bandwidth'] })}><option value="wide">宽带 · 25 kHz</option><option value="narrow">窄带 · 12.5 kHz</option></select></label></div><label className="toggle-field"><span>繁忙禁发<small>信道忙时禁止发射</small></span><input aria-label="详细繁忙禁发" role="switch" type="checkbox" checked={current.busy} onChange={e => updateCurrent({ busy: e.target.checked })} /></label><div className="field-divider" /><label>分组<input aria-label="信道分组" list="group-options" value={current.group} placeholder="例如：本地中继、车队…" onChange={e => updateCurrent({ group: e.target.value })} /></label><label>备注<textarea aria-label="信道备注" rows={2} value={current.note} placeholder="记录位置、用途或其他信息…" onChange={e => updateCurrent({ note: e.target.value })} /></label><p className="field-tip">分组和备注保存在方案与表格中，不占电台信道空间。</p>{issues.filter(i => i.slot === current.slot).map((i, n) => <div key={n} className="inline-error">{i.message}</div>)}<div className="inspector-actions"><button className="btn" onClick={duplicate}><Copy size={14} />复制信道</button><IconButton title="删除当前信道" danger onClick={remove}><Trash2 size={16} /></IconButton></div></div></aside>}
        </section>}
        {view === 'spectrum' && <section className="spectrum-panel"><div className="panel-head"><div><h2>频率分布</h2><p>观察信道占用，点选频点回到参数编辑。</p></div><span className="tag">{workspace.channels.length} 个接收频点</span></div>{[['VHF', 130, 180], ['UHF', 400, 480]].map(([name, min, max]) => <div className="band-chart" key={name}><div className="band-chart-title"><strong>{name}</strong><span>{min}–{max} MHz</span></div><div className="spectrum-grid">{Array.from({ length: 6 }, (_, i) => <span className="grid-line" key={i} style={{ left: `${i * 20}%` }}><small>{Number(min) + (Number(max) - Number(min)) * i / 5}</small></span>)}{workspace.channels.filter(c => Number(c.rx) >= Number(min) && Number(c.rx) <= Number(max)).map((c, i) => <button key={c.slot} className="frequency-bar" style={{ left: `${(Number(c.rx) - Number(min)) / (Number(max) - Number(min)) * 100}%`, height: `${28 + (i % 5) * 15}px` }} title={`${slotLabel(c.slot)} ${c.name} · ${c.rx} MHz`} aria-label={`查看信道 ${slotLabel(c.slot)}`} onClick={() => { setActive(c.slot); setView('channels'); }} />)}</div></div>)}<div className="spectrum-list">{workspace.channels.slice().sort((a, b) => Number(a.rx) - Number(b.rx)).map(c => <button key={c.slot} onClick={() => { setActive(c.slot); setView('channels'); }}><span className="slot">{slotLabel(c.slot)}</span><span>{c.name || '未命名'}</span><strong className="mono">{c.rx}</strong><ChevronRight size={14} /></button>)}</div></section>}
        {view === 'files' && <section className="files-grid"><div className="file-card"><div className="file-card-icon"><FileCode2 size={25} /></div><h2>电台 DAT 模板</h2><p>导入旧版原厂软件保存的 DAT，保留原文件中的全局配置和未知参数。</p><div className="file-detail"><span>当前模板</span><strong>{workspace.template?.fileName ?? '尚未导入'}</strong><span>{workspace.template ? `${workspace.template.rows.length} 行 · 已保留原始数据` : '导出 DAT 前需要一份本机模板'}</span></div><button className="btn" onClick={() => fileRef.current?.click()}><Upload size={16} />导入 DAT 文件</button></div><div className="file-card"><div className="file-card-icon"><HardDrive size={25} /></div><h2>完整方案备份</h2><p>一次保存全部信道、分组、备注与 DAT 模板。在另一台电脑导入，即可继续编辑。</p><div className="file-detail"><span>本机自动保存</span><strong>{saving}</strong><span>浏览器存储不是永久备份，建议定期导出。</span></div><button className="btn primary" onClick={() => runExport('project')}><Save size={16} />下载完整方案</button></div><div className="file-card"><div className="file-card-icon"><FileSpreadsheet size={25} /></div><h2>Excel / CSV 信道表</h2><p>支持 D500 工作表与 K5Web 导出的信道表，也可以使用空白模板批量整理。</p><div className="file-button-row"><button className="btn" onClick={() => runExport('xlsx')}>导出 XLSX</button><button className="btn" onClick={() => runExport('csv')}>导出 CSV</button><button className="text-btn" onClick={() => runExport('template')}>下载空白模板<ArrowDownToLine size={14} /></button></div></div><div className="file-card new-file-card"><Plus size={25} /><h2>开始新的方案</h2><p>新建一个空白工作空间。当前方案可通过“撤销”恢复，建议先下载备份。</p><button className="btn" onClick={startNew}>新建空白方案</button></div></section>}
        <footer className="page-footer"><span><ShieldCheck size={13} />文件在浏览器本地处理 · 支持离线编辑</span><span>BA7KTC <span className="footer-dot">/</span> D500 Workbench <span className="footer-dot">/</span><button onClick={() => setModal('help')}>开源与说明</button></span></footer>
      </main>
    </div>
    <datalist id="tone-options">{CTCSS.map(t => <option key={t} value={t} />)}{DCS_CODES.flatMap(c => [<option key={c + 'N'} value={`D${c}N`} />, <option key={c + 'I'} value={`D${c}I`} />])}</datalist><datalist id="group-options">{groups.map(g => <option key={g} value={g} />)}</datalist>
    {toast && <div className={`toast ${toast.error ? 'error' : ''}`} role={toast.error ? 'alert' : 'status'}><span>{toast.error ? <CircleHelp size={18} /> : <Check size={18} />}</span>{toast.text}<button aria-label="关闭提示" onClick={() => setToast(null)}><X size={15} /></button></div>}
    {drop && <div className="drop-overlay" onDragLeave={() => setDrop(false)}><Upload size={45} /><h2>把信道文件放在这里</h2><p>DAT · XLSX · CSV · 方案备份</p></div>}
    {pending && <ModalShell title="检查导入内容" subtitle={`${pending.type} · ${pending.name}`} close={() => setPending(null)}><div className="import-summary"><FileText size={30} /><div><strong>{pending.channels.length} 条信道</strong><span>{pending.template ? '包含可保留全局设置的原始 DAT 模板' : '只包含信道；沿用当前 DAT 模板'}</span></div><CheckCheck size={25} /></div><div className="import-preview">{pending.channels.slice(0, 5).map(c => <div key={c.slot}><span className="slot">{slotLabel(c.slot)}</span><span>{c.name || '未命名'}</span><span className="mono">{c.rx}</span></div>)}{pending.channels.length > 5 && <p>以及其他 {pending.channels.length - 5} 条信道…</p>}</div>{pending.warnings.map((w, i) => <p className="import-note" key={i}>{w}</p>)}<p className="import-note">替换或合并都可以撤销。DAT 模板不会上传到服务器。</p><div className="modal-actions">{pending.template && <button className="btn" onClick={() => acceptImport('template')}>只载入模板</button>}<button className="btn" onClick={() => acceptImport('merge')}>按编号合并</button><button className="btn primary" onClick={() => acceptImport('replace')}>替换信道列表</button></div></ModalShell>}
    {modal === 'export' && <ModalShell title="导出你的信道方案" subtitle="选择适合下一步的格式。" close={() => setModal(null)}><div className="export-options"><button onClick={() => runExport('dat')}><span className="format-icon"><FileCode2 size={24} /></span><span><strong>D500 写频文件 <em>.dat</em></strong><small>{workspace.template ? `基于 ${workspace.template.fileName}，保留其他机器设置` : '需先导入一份原厂 DAT 作为模板'}</small></span><ArrowDownToLine size={18} /></button><button onClick={() => runExport('xlsx')}><span className="format-icon excel"><FileSpreadsheet size={24} /></span><span><strong>Excel 信道表 <em>.xlsx</em></strong><small>适合批量整理，支持再次导入</small></span><ArrowDownToLine size={18} /></button><button onClick={() => runExport('csv')}><span className="format-icon"><FileText size={24} /></span><span><strong>通用表格 <em>.csv</em></strong><small>兼容 Excel、WPS 与其他表格工具</small></span><ArrowDownToLine size={18} /></button><button onClick={() => runExport('project')}><span className="format-icon"><Save size={24} /></span><span><strong>完整方案备份 <em>.d500.json</em></strong><small>包含分组、备注和 DAT 模板，换设备继续编辑</small></span><ArrowDownToLine size={18} /></button></div>{issues.length > 0 && <div className="inline-error">当前有 {issues.length} 个参数问题，请修正后再导出 DAT。表格和方案仍可备份。</div>}<div className="notice"><ShieldCheck size={17} /><p>DAT 用于原厂写频软件导入；本工具尚不直接连接电台，也不会升级固件。</p></div></ModalShell>}
    {modal === 'batch' && <ModalShell title={`批量编辑 ${selected.length} 条信道`} subtitle="未填写的字段保持原值。修改后可以撤销。" close={() => setModal(null)}><div className="batch-form"><div className="field-pair"><label>功率<select value={batch.power} onChange={e => setBatch({ ...batch, power: e.target.value })}><option value="">保持原值</option><option value="high">高</option><option value="mid">中</option><option value="low">低</option></select></label><label>带宽<select value={batch.bandwidth} onChange={e => setBatch({ ...batch, bandwidth: e.target.value })}><option value="">保持原值</option><option value="wide">宽带</option><option value="narrow">窄带</option></select></label></div><div className="field-pair"><label>发射亚音<input list="tone-options" placeholder="保持原值" value={batch.txTone} onChange={e => setBatch({ ...batch, txTone: e.target.value })} disabled={batch.clearTone} /></label><label>分组<input list="group-options" placeholder="保持原值" value={batch.group} onChange={e => setBatch({ ...batch, group: e.target.value })} /></label></div><label className="check-label"><input type="checkbox" checked={batch.clearTone} onChange={e => setBatch({ ...batch, clearTone: e.target.checked })} />清除所选信道的发射亚音</label><label>统一收发频差 <small>发射 = 接收 + 频差，单位 MHz</small><input placeholder="例如 -5.00000；留空不变" value={batch.offset} onChange={e => setBatch({ ...batch, offset: e.target.value })} /></label></div><div className="modal-actions"><button className="btn" onClick={() => setModal(null)}>取消</button><button className="btn primary" onClick={applyBatch}>应用到 {selected.length} 条信道</button></div></ModalShell>}
    {modal === 'paste' && <ModalShell title="从表格粘贴信道" subtitle="直接从 Excel / WPS 复制行，或粘贴带表头的制表符数据。" close={() => setModal(null)}><p className="import-note">无表头时默认列顺序：名称、接收频率、发射频率、发射亚音。编号从 000 开始。</p><textarea className="paste-area mono" aria-label="粘贴信道数据" placeholder={'本地直通\t438.50000\t438.50000\t\nU段中继\t439.55000\t434.55000\t88.5'} value={paste} onChange={e => setPaste(e.target.value)} /><div className="modal-actions"><button className="btn primary" disabled={!paste.trim()} onClick={() => void pasteImport()}>解析粘贴内容</button></div></ModalShell>}
    {modal === 'help' && <ModalShell title="为每一个频点，多一点从容" subtitle="D500 Workbench · v0.1.0 · BA7KTC" close={() => setModal(null)}><div className="help-content"><h3>从原始 DAT 开始</h3><p>用旧版 D500 原厂软件读取并保存 DAT，再导入这里。网页可以编辑信道、亚音、功率和带宽；导出时保留模板中的其他设置。已用 BA7KTC 提供的旧版 DAT 验证文件解析和无修改往返，实际写入电台仍由原厂软件完成。</p><h3>表格与编号</h3><p>D500 使用 000–199。导入 K5Web 的 # 表头时，200 映射为 000，1–199 原号保留。Excel 模板带字段说明，分组和备注仅保存在网页方案和表格中。</p><h3>本地优先</h3><p>DAT、表格与方案均在你的浏览器内解析，不发送到服务器。本机自动保存方便继续编辑，跨设备请下载完整方案备份。首次加载需要联网，当前页面载入后可离线编辑。</p><h3>开源与署名</h3><p>由 BA7KTC / JukZeon 开发维护。DAT 编解码基于 Liuli-Lumine 的 K1toD500（GPL-3.0），工作流程参考 K5Web。本站同样以 GPL-3.0 发布。</p><div className="help-links"><a href="/source.zip" download>下载本版本源码<Download size={14} /></a><a href="/LICENSE.txt" target="_blank" rel="noreferrer">GPL-3.0 许可证<ChevronRight size={14} /></a><a href="https://github.com/Liuli-Lumine/K1toD500" target="_blank" rel="noreferrer">上游项目<ChevronRight size={14} /></a></div></div></ModalShell>}
  </div>;
}
