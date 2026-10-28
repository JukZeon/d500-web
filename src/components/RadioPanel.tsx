import { useEffect, useRef, useState } from 'react';
import { version } from '../../package.json';
import { Cable, Download, FileDown, Radio, Upload, X } from 'lucide-react';
import type { Workspace } from '../lib/model';
import { parseDat } from '../lib/dat';
import { download } from '../lib/project';
import { D500Protocol, HARDWARE_WRITE_SMOKE_TESTED, describeWrite, planWrite, programWorkspace, scopePlan, snapshotDat, type RadioSnapshot, type WritePlan, type WriteScope } from '../lib/radio';
import { acceptWriteResult } from '../lib/write-result';
import { listRadioBackups, saveRadioBackup } from '../lib/radio-backups';
import { SerialLink, serialApi, type SerialPortLike, type TraceEntry } from '../lib/serial';

type Props = { visible: boolean; workspace: Workspace; onRead: (text: string, name: string) => void; onWritten: (workspace: Workspace) => void; onConnection: (connected: boolean) => void; onWorking: (working: boolean) => void };
const stamp = (snapshot: RadioSnapshot) => snapshot.capturedAt.replace(/[:.]/g, '-');
export default function RadioPanel({ visible, workspace, onRead, onWritten, onConnection, onWorking }: Props) {
  const [working, setWorking] = useState(false), [message, setMessage] = useState('');
  const [error, setError] = useState(false), [progress, setProgress] = useState(0);
  const [snapshot, setSnapshot] = useState<RadioSnapshot | null>(null), [backups, setBackups] = useState<RadioSnapshot[]>([]);
  const [preview, setPreview] = useState<WritePlan | null>(null), [scope, setScope] = useState<WriteScope>('all'), [traceCount, setTraceCount] = useState(0);
  const port = useRef<SerialPortLike | null>(null), link = useRef<SerialLink | null>(null), abort = useRef<AbortController | null>(null), trace = useRef<TraceEntry[]>([]);
  const callbacks = useRef({ onConnection, onWorking }); callbacks.current = { onConnection, onWorking };
  const supported = !!serialApi();
  useEffect(() => { void listRadioBackups().then(setBackups).catch(e => { setMessage(String(e)); setError(true); }); return () => { abort.current?.abort(); void link.current?.close().catch(() => {}); }; }, []);
  useEffect(() => { setPreview(null); }, [workspace, snapshot, scope]);
  const status = (text: string, failed = false) => { setMessage(text); setError(failed); if (text) addTrace({ at: new Date().toISOString(), direction: 'INFO', hex: text }); };
  const busy = (value: boolean) => { setWorking(value); callbacks.current.onWorking(value); };
  const report = (done: number, total: number, label: string) => { setProgress(done / total); setMessage(label); if (!done) addTrace({ at: new Date().toISOString(), direction: 'INFO', hex: label }); };
  const addTrace = (entry: TraceEntry) => { trace.current.push(entry); if (trace.current.length > 131072) trace.current.splice(0, trace.current.length - 131072); setTraceCount(trace.current.length); };
  async function open() {
    if (!port.current) throw new Error('请先选择写频线。');
    const current = await SerialLink.open(port.current, addTrace, 5000, undefined, abort.current?.signal); link.current = current; callbacks.current.onConnection(true);
    return { write: current.write.bind(current), read: current.read.bind(current), async close() { try { await current.close(); } finally { if (link.current === current) link.current = null; callbacks.current.onConnection(false); } } };
  }
  async function read(changePort = false) {
    const api = serialApi(); if (!api || working) return;
    busy(true); setPreview(null); setProgress(0); setError(false);
    const controller = new AbortController(); abort.current = controller;
    try {
      if (!port.current || changePort) port.current = await api.requestPort();
      addTrace({ at: new Date().toISOString(), direction: 'INFO', hex: `开始读取 · v${version}` });
      const session = await open(); let result: RadioSnapshot;
      try { result = await new D500Protocol(session).readImage(report, controller.signal); } finally { await session.close(); }
      await saveRadioBackup(result); setSnapshot(result); setBackups(await listRadioBackups());
      const dat = snapshotDat(result), name = `D500-读机-${stamp(result)}.dat`; parseDat(dat, name); onRead(dat, name);
      status('读取完成 · 已备份');
    } catch (e) { status(controller.signal.aborted ? '已取消读取' : e instanceof DOMException && e.name === 'NotFoundError' ? '已取消连接' : e instanceof Error ? e.message : String(e), !controller.signal.aborted); }
    finally { abort.current = null; busy(false); }
  }
  function showPreview() {
    if (!snapshot) return;
    try { setPreview(scopePlan(planWrite(snapshot, workspace), scope)); status(''); }
    catch (e) { setPreview(null); status(e instanceof Error ? e.message : String(e), true); }
  }
  async function write() {
    if (!snapshot || working || !port.current) return;
    let plan: WritePlan;
    try { plan = scopePlan(planWrite(snapshot, workspace), scope); }
    catch (e) { status(e instanceof Error ? e.message : String(e), true); return; }
    if (!plan.blocks.length) { status('无修改'); return; }
    busy(true); setProgress(0); setError(false); const controller = new AbortController(); abort.current = controller;
    setPreview(null);
    addTrace({ at: new Date().toISOString(), direction: 'INFO', hex: `开始写入 · v${version} · ${scope} · ${plan.blocks.length} 块` });
    try {
      const result = await programWorkspace(open, workspace, { snapshot, plan }, scope, saveRadioBackup, report, controller.signal);
      onWritten(acceptWriteResult(workspace, result, scope));
      setSnapshot(result); status('写入完成');
    } catch (e) { setSnapshot(null); status(e instanceof Error ? e.message : String(e), true); }
    finally { abort.current = null; busy(false); setBackups(await listRadioBackups().catch(() => backups)); }
  }
  function load(item: RadioSnapshot) {
    try { const text = snapshotDat(item), name = `D500-读机-${stamp(item)}.dat`; parseDat(text, name); setSnapshot(item); onRead(text, name); }
    catch (e) { status(e instanceof Error ? e.message : String(e), true); }
  }
  const changes = snapshot && preview ? describeWrite(snapshot, preview) : [];
  return <section className="radio-page" hidden={!visible}>
    <div className="radio-intro"><h2>电台读写</h2><span className="verification-note">整表写入待实测</span></div>
    <div className="radio-operation"><div className="radio-card-title"><Cable size={20} /><h3>连接</h3></div>
      {!supported && <div className="inline-error">浏览器不支持串口，请使用 Chrome / Edge。</div>}
      <div className="radio-actions"><button className="btn primary" disabled={!supported || working} onClick={() => void read()}><Download size={16} />{snapshot ? '重新读取' : '读取电台'}</button>{port.current && <button className="btn" disabled={working} onClick={() => void read(true)}>更换写频线</button>}{working && <button className="btn" onClick={() => abort.current?.abort()}><X size={16} />停止</button>}</div>
      {(message || working) && <div className={`radio-progress ${error ? 'failed' : ''}`} role={error ? 'alert' : 'status'}>{message && <p>{message}</p>}{working && <progress aria-label="电台操作进度" value={progress} max={1} />}</div>}
    </div>
    <div className="radio-operation"><div className="radio-card-title"><Upload size={20} /><h3>写入</h3><select aria-label="写入范围" value={scope} disabled={working} onChange={e => setScope(e.target.value as WriteScope)}><option value="all">信道与设置</option><option value="channels">仅信道</option><option value="settings">仅设置</option></select></div>
      <div className="radio-actions"><button className="btn primary" disabled={!snapshot || !port.current || working} onClick={() => void write()}><Upload size={16} />写入修改</button><button className="btn" disabled={!snapshot || working} onClick={showPreview}>查看修改</button><span className="radio-caption">仅写入变更</span></div>
      {preview && <div className="write-preview"><strong>{changes.length ? `${changes.length} 项修改` : '无修改'}</strong>{preview.blocks.length > 0 && <div className="write-diff"><table><thead><tr><th>位置 / 参数</th><th>当前值</th><th>写入值</th></tr></thead><tbody>{changes.map((change, i) => <tr key={i}><td>{change.target}<small>{change.field}</small></td><td>{change.before}</td><td>{change.after}</td></tr>)}</tbody></table></div>}</div>}
    </div>
    <div className="radio-operation"><div className="radio-card-title"><Radio size={20} /><h3>备份</h3><span>{backups.length} 份</span></div>{!backups.length ? <p className="radio-empty">暂无备份</p> : backups.slice(0, 10).map(item => <div className="radio-backup-row" key={item.capturedAt}><span>{new Date(item.capturedAt).toLocaleString('zh-CN')}</span><span>12.5 KiB</span><button className="text-btn" disabled={working} onClick={() => load(item)}>载入</button><button className="text-btn" onClick={() => download(JSON.stringify(item), `D500-原始读取-${stamp(item)}.json`, 'application/json')}>JSON</button><button className="text-btn" onClick={() => download(snapshotDat(item), `D500-读机-${stamp(item)}.dat`, 'text/plain')}><FileDown size={14} />DAT</button></div>)}</div>
    <details className="radio-operation radio-log"><summary>通信记录 <span>{traceCount} 条</span></summary><button className="btn" disabled={!traceCount || working} onClick={() => download(JSON.stringify({ version, protocol: 'cps-2025', browserWriteHardwareVerified: false, browserWriteSmokeTestVerified: HARDWARE_WRITE_SMOKE_TESTED, entries: trace.current }, null, 2), `D500-通信记录-${Date.now()}.json`, 'application/json')}>下载</button><pre>{trace.current.slice(-12).map(item => `${item.at.slice(11, 23)} ${item.direction} ${item.hex}`).join('\n') || '暂无记录'}</pre></details>
  </section>;
}
