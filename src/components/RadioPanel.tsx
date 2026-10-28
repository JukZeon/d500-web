import { useEffect, useRef, useState } from 'react';
import { version } from '../../package.json';
import { Cable, Download, FileDown, Radio, Upload, X } from 'lucide-react';
import type { Workspace } from '../lib/model';
import { parseDat } from '../lib/dat';
import { download } from '../lib/project';
import { D500Protocol, HARDWARE_WRITE_SMOKE_TESTED, describeWrite, hasWriteBaseline, planWorkspaceWrite, programWorkspace, snapshotDat, type RadioSnapshot, type WritePlan, type WriteScope } from '../lib/radio';
import { acceptWriteResult } from '../lib/write-result';
import { listRadioBackups, saveRadioBackup } from '../lib/radio-backups';
import { SerialLink, serialApi, type SerialPortLike, type TraceEntry } from '../lib/serial';

type Props = { visible: boolean; workspace: Workspace; onRead: (text: string, name: string) => void; onWritten: (workspace: Workspace) => void; onConnection: (connected: boolean) => void; onWorking: (working: boolean) => void };
const stamp = (snapshot: RadioSnapshot) => snapshot.capturedAt.replace(/[:.]/g, '-');
export default function RadioPanel({ visible, workspace, onRead, onWritten, onConnection, onWorking }: Props) {
  const [working, setWorking] = useState(false), [message, setMessage] = useState('');
  const [error, setError] = useState(false), [progress, setProgress] = useState(0);
  const [snapshot, setSnapshot] = useState<RadioSnapshot | null>(null), [backups, setBackups] = useState<RadioSnapshot[]>([]);
  const [identity, setIdentity] = useState<number[] | null>(null);
  const [preview, setPreview] = useState<WritePlan | null>(null), [scope, setScope] = useState<WriteScope>('all'), [traceCount, setTraceCount] = useState(0);
  const port = useRef<SerialPortLike | null>(null), link = useRef<SerialLink | null>(null), abort = useRef<AbortController | null>(null), trace = useRef<TraceEntry[]>([]);
  const callbacks = useRef({ onConnection, onWorking }); callbacks.current = { onConnection, onWorking };
  const supported = !!serialApi();
  useEffect(() => { void listRadioBackups().then(setBackups).catch(e => { setMessage(String(e)); setError(true); }); return () => { abort.current?.abort(); void link.current?.close().catch(() => {}); }; }, []);
  useEffect(() => {
    const api = serialApi();
    const disconnected = (event: Event) => {
      if (event.target !== port.current) return;
      port.current = null; setIdentity(null); setSnapshot(null); callbacks.current.onConnection(false);
      abort.current?.abort(new DOMException('连接已断开', 'NetworkError')); setMessage('连接已断开'); setError(true);
    };
    api?.addEventListener?.('disconnect', disconnected);
    return () => api?.removeEventListener?.('disconnect', disconnected);
  }, []);
  useEffect(() => { setPreview(null); }, [workspace, snapshot, scope]);
  const status = (text: string, failed = false) => { setMessage(text); setError(failed); if (text) addTrace({ at: new Date().toISOString(), direction: 'INFO', hex: text }); };
  const busy = (value: boolean) => { setWorking(value); callbacks.current.onWorking(value); };
  const report = (done: number, total: number, label: string) => { setProgress(done / total); setMessage(label); if (!done) addTrace({ at: new Date().toISOString(), direction: 'INFO', hex: label }); };
  const addTrace = (entry: TraceEntry) => { trace.current.push(entry); if (trace.current.length > 131072) trace.current.splice(0, trace.current.length - 131072); setTraceCount(trace.current.length); };
  const connected = (value: number[] | null) => { setIdentity(value); callbacks.current.onConnection(!!value); };
  async function selectPort(change = false) {
    const api = serialApi(); if (!api) throw new Error('浏览器不支持串口');
    if (!port.current || change) {
      const selected = await api.requestPort();
      if (change || port.current && selected !== port.current) setSnapshot(null);
      port.current = selected; connected(null);
    }
  }
  async function open() {
    if (!port.current) throw new Error('请先选择写频线。');
    const current = await SerialLink.open(port.current, addTrace, 5000, undefined, abort.current?.signal); link.current = current;
    return { write: current.write.bind(current), read: current.read.bind(current), async close() { try { await current.close(); } finally { if (link.current === current) link.current = null; } } };
  }
  async function connect(change = false) {
    if (working) return;
    busy(true); setProgress(0); setError(false);
    const controller = new AbortController(); abort.current = controller;
    try {
      await selectPort(change); status('连接中…');
      const session = await open(); let result: number[];
      try { result = [...await new D500Protocol(session).identify(controller.signal)]; } finally { await session.close(); }
      if (snapshot && (snapshot.identity.length !== result.length || snapshot.identity.some((v, i) => v !== result[i]))) setSnapshot(null);
      connected(result); status('已连接');
    } catch (e) { connected(null); status(e instanceof DOMException && e.name === 'NotFoundError' ? '已取消连接' : e instanceof Error ? e.message : String(e), !controller.signal.aborted); }
    finally { abort.current = null; busy(false); }
  }
  async function read(changePort = false) {
    const api = serialApi(); if (!api || working) return;
    busy(true); setPreview(null); setProgress(0); setError(false);
    const controller = new AbortController(); abort.current = controller;
    try {
      await selectPort(changePort);
      addTrace({ at: new Date().toISOString(), direction: 'INFO', hex: `开始读取 · v${version}` });
      const session = await open(); let result: RadioSnapshot;
      try { result = await new D500Protocol(session).readImage(report, controller.signal); } finally { await session.close(); }
      await saveRadioBackup(result); setSnapshot(result); connected(result.identity); setBackups(await listRadioBackups());
      const dat = snapshotDat(result), name = `D500-读机-${stamp(result)}.dat`; parseDat(dat, name); onRead(dat, name);
      status('读取完成 · 已备份');
    } catch (e) { connected(null); status(controller.signal.aborted ? '已取消读取' : e instanceof DOMException && e.name === 'NotFoundError' ? '已取消连接' : e instanceof Error ? e.message : String(e), !controller.signal.aborted); }
    finally { abort.current = null; busy(false); }
  }
  function showPreview() {
    try { setPreview(planWorkspaceWrite(snapshot, workspace, scope)); status(''); }
    catch (e) { setPreview(null); status(e instanceof Error ? e.message : String(e), true); }
  }
  async function write() {
    if (working || !supported) return;
    let plan: WritePlan;
    try { plan = planWorkspaceWrite(snapshot, workspace, scope); }
    catch (e) { status(e instanceof Error ? e.message : String(e), true); return; }
    if (!plan.blocks.length) { status('无修改'); return; }
    busy(true); setProgress(0); setError(false); const controller = new AbortController(); abort.current = controller;
    setPreview(null);
    addTrace({ at: new Date().toISOString(), direction: 'INFO', hex: `开始写入 · v${version} · ${scope} · ${plan.blocks.length} 块` });
    try {
      await selectPort();
      const result = await programWorkspace(open, workspace, { snapshot, plan, identity }, scope, saveRadioBackup, report, controller.signal);
      onWritten(acceptWriteResult(workspace, result, scope));
      setSnapshot(result); connected(result.identity); status('写入完成');
    } catch (e) { setSnapshot(null); connected(null); status(e instanceof DOMException && e.name === 'NotFoundError' ? '已取消连接' : e instanceof Error ? e.message : String(e), true); }
    finally { abort.current = null; busy(false); setBackups(await listRadioBackups().catch(() => backups)); }
  }
  function load(item: RadioSnapshot) {
    try { const text = snapshotDat(item), name = `D500-读机-${stamp(item)}.dat`; parseDat(text, name); setSnapshot(item); onRead(text, name); }
    catch (e) { status(e instanceof Error ? e.message : String(e), true); }
  }
  const changes = snapshot && preview && preview.mode !== 'file' ? describeWrite(snapshot, preview) : [];
  const fileMode = !hasWriteBaseline(snapshot, scope);
  return <section className="radio-page" hidden={!visible}>
    <div className="radio-intro"><h2>电台读写</h2><span className="verification-note">信道读写已实测</span></div>
    <div className="radio-operation"><div className="radio-card-title"><Cable size={20} /><h3>连接</h3></div>
      {!supported && <div className="inline-error">浏览器不支持串口，请使用 Chrome / Edge。</div>}
      <div className="radio-actions"><button className="btn primary" disabled={!supported || working || !!identity} onClick={() => void connect()}><Cable size={16} />{identity ? '已连接' : '连接电台'}</button><button className="btn" disabled={!supported || working} onClick={() => void read()}><Download size={16} />读取电台</button>{port.current && <button className="btn" disabled={working} onClick={() => void connect(true)}>更换写频线</button>}{working && <button className="btn" onClick={() => abort.current?.abort()}><X size={16} />停止</button>}</div>
      {(message || working) && <div className={`radio-progress ${error ? 'failed' : ''}`} role={error ? 'alert' : 'status'}>{message && <p>{message}</p>}{working && <progress aria-label="电台操作进度" value={progress} max={1} />}</div>}
    </div>
    <div className="radio-operation"><div className="radio-card-title"><Upload size={20} /><h3>写入</h3><select aria-label="写入范围" value={scope} disabled={working} onChange={e => setScope(e.target.value as WriteScope)}><option value="all">信道与设置</option><option value="channels">仅信道</option><option value="settings">仅设置</option></select></div>
      <div className="radio-actions"><button className="btn primary" disabled={!supported || !workspace.template || working} onClick={() => void write()}><Upload size={16} />{fileMode ? '写入方案' : '写入修改'}</button><button className="btn" disabled={!workspace.template || working} onClick={showPreview}>查看写入</button><span className="radio-caption">{fileMode ? '按方案写入' : '仅写入变更'}</span></div>
      {preview && <div className="write-preview">{preview.mode === 'file' ? <strong>{preview.blocks.length} 个写入块{scope !== 'settings' && !hasWriteBaseline(snapshot, 'channels') && ' · 覆盖 200 信道槽位'}</strong> : <><strong>{changes.length ? `${changes.length} 项修改` : '无修改'}</strong>{preview.blocks.length > 0 && <div className="write-diff"><table><thead><tr><th>位置 / 参数</th><th>当前值</th><th>写入值</th></tr></thead><tbody>{changes.map((change, i) => <tr key={i}><td>{change.target}<small>{change.field}</small></td><td>{change.before}</td><td>{change.after}</td></tr>)}</tbody></table></div>}</>}</div>}
    </div>
    <div className="radio-operation"><div className="radio-card-title"><Radio size={20} /><h3>备份</h3><span>{backups.length} 份</span></div>{!backups.length ? <p className="radio-empty">暂无备份</p> : backups.slice(0, 10).map(item => <div className="radio-backup-row" key={item.capturedAt}><span>{new Date(item.capturedAt).toLocaleString('zh-CN')}</span><span>12.5 KiB</span><button className="text-btn" disabled={working} onClick={() => load(item)}>载入</button><button className="text-btn" onClick={() => download(JSON.stringify(item), `D500-原始读取-${stamp(item)}.json`, 'application/json')}>JSON</button><button className="text-btn" onClick={() => download(snapshotDat(item), `D500-读机-${stamp(item)}.dat`, 'text/plain')}><FileDown size={14} />DAT</button></div>)}</div>
    <details className="radio-operation radio-log"><summary>通信记录 <span>{traceCount} 条</span></summary><button className="btn" disabled={!traceCount || working} onClick={() => download(JSON.stringify({ version, protocol: 'cps-2025', browserWriteHardwareVerified: false, browserWriteSmokeTestVerified: HARDWARE_WRITE_SMOKE_TESTED, entries: trace.current }, null, 2), `D500-通信记录-${Date.now()}.json`, 'application/json')}>下载</button><pre>{trace.current.slice(-12).map(item => `${item.at.slice(11, 23)} ${item.direction} ${item.hex}`).join('\n') || '暂无记录'}</pre></details>
  </section>;
}
