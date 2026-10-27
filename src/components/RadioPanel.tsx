import { useEffect, useRef, useState } from 'react';
import { Cable, Download, FileDown, Radio, Upload, X } from 'lucide-react';
import type { Workspace } from '../lib/model';
import { parseDat } from '../lib/dat';
import { download } from '../lib/project';
import { D500Protocol, describeWrite, planWrite, programWorkspace, scopePlan, snapshotDat, type RadioSnapshot, type WritePlan, type WriteScope } from '../lib/radio';
import { listRadioBackups, saveRadioBackup } from '../lib/radio-backups';
import { SerialLink, serialApi, type SerialPortLike, type TraceEntry } from '../lib/serial';

type Props = { visible: boolean; workspace: Workspace; onRead: (text: string, name: string) => void; onConnection: (connected: boolean) => void; onWorking: (working: boolean) => void };
const stamp = (snapshot: RadioSnapshot) => snapshot.capturedAt.replace(/[:.]/g, '-');
export default function RadioPanel({ visible, workspace, onRead, onConnection, onWorking }: Props) {
  const [working, setWorking] = useState(false), [message, setMessage] = useState('接好电台和写频线，关闭原厂软件并让云电脑释放 USB。');
  const [error, setError] = useState(false), [progress, setProgress] = useState(0);
  const [snapshot, setSnapshot] = useState<RadioSnapshot | null>(null), [backups, setBackups] = useState<RadioSnapshot[]>([]);
  const [preview, setPreview] = useState<WritePlan | null>(null), [scope, setScope] = useState<WriteScope>('all'), [reviewed, setReviewed] = useState(false), [traceCount, setTraceCount] = useState(0);
  const port = useRef<SerialPortLike | null>(null), link = useRef<SerialLink | null>(null), abort = useRef<AbortController | null>(null), trace = useRef<TraceEntry[]>([]);
  const callbacks = useRef({ onConnection, onWorking }); callbacks.current = { onConnection, onWorking };
  const supported = !!serialApi();
  useEffect(() => { void listRadioBackups().then(setBackups).catch(e => { setMessage(String(e)); setError(true); }); return () => { abort.current?.abort(); void link.current?.close().catch(() => {}); }; }, []);
  useEffect(() => { setPreview(null); setReviewed(false); }, [workspace, snapshot, scope]);
  const status = (text: string, failed = false) => { setMessage(text); setError(failed); };
  const busy = (value: boolean) => { setWorking(value); callbacks.current.onWorking(value); };
  const report = (done: number, total: number, label: string) => { setProgress(done / total); setMessage(label); };
  const addTrace = (entry: TraceEntry) => { trace.current.push(entry); if (trace.current.length > 32768) trace.current.splice(0, trace.current.length - 32768); setTraceCount(trace.current.length); };
  async function open() {
    if (!port.current) throw new Error('请先选择写频线。');
    const current = await SerialLink.open(port.current, addTrace); link.current = current; callbacks.current.onConnection(true);
    return { write: current.write.bind(current), read: current.read.bind(current), async close() { try { await current.close(); } finally { if (link.current === current) link.current = null; callbacks.current.onConnection(false); } } };
  }
  async function read(changePort = false) {
    const api = serialApi(); if (!api || working) return;
    busy(true); setPreview(null); setReviewed(false); setProgress(0); setError(false);
    const controller = new AbortController(); abort.current = controller;
    try {
      if (!port.current || changePort) port.current = await api.requestPort();
      trace.current = []; setTraceCount(0);
      const session = await open(); let result: RadioSnapshot;
      try { result = await new D500Protocol(session).readImage(report, controller.signal); } finally { await session.close(); }
      await saveRadioBackup(result); setSnapshot(result); setBackups(await listRadioBackups());
      const dat = snapshotDat(result), name = `D500-读机-${stamp(result)}.dat`; parseDat(dat, name); onRead(dat, name);
      status('读取完成，原始备份已保存。选择替换、合并或仅载入配置。');
    } catch (e) { status(controller.signal.aborted ? '读取已取消，当前方案未变。' : e instanceof DOMException && e.name === 'NotFoundError' ? '已取消选择写频线。' : e instanceof Error ? e.message : String(e), !controller.signal.aborted); }
    finally { abort.current = null; busy(false); }
  }
  function showPreview() {
    if (!snapshot) return;
    try { setPreview(scopePlan(planWrite(snapshot, workspace), scope)); setReviewed(false); status('请核对下方修改，确认后写入。'); }
    catch (e) { setPreview(null); status(e instanceof Error ? e.message : String(e), true); }
  }
  async function write() {
    if (!preview?.blocks.length || !reviewed || working || !port.current) return;
    busy(true); setProgress(0); setError(false); const controller = new AbortController(); abort.current = controller;
    const plan = preview; setPreview(null); setReviewed(false);
    try {
      const result = await programWorkspace(open, workspace, plan, scope, saveRadioBackup, report, controller.signal);
      setSnapshot(result); status('写入完成：全部配置回读一致，写前、写后备份已保存。');
    } catch (e) { setSnapshot(null); status(e instanceof Error ? e.message : String(e), true); }
    finally { abort.current = null; busy(false); setBackups(await listRadioBackups().catch(() => backups)); }
  }
  function load(item: RadioSnapshot) {
    try { const text = snapshotDat(item), name = `D500-读机-${stamp(item)}.dat`; parseDat(text, name); setSnapshot(item); onRead(text, name); }
    catch (e) { status(e instanceof Error ? e.message : String(e), true); }
  }
  return <section className="radio-page" hidden={!visible}>
    <div className="radio-intro"><div><h2>电台读写</h2><p>D500 · 信道与整机配置</p></div><span className="verification-note">读取已实测 · 网页写入待实机复测</span></div>
    <div className="radio-operation"><div className="radio-card-title"><Cable size={20} /><h3>{port.current ? '写频线已选择' : '连接写频线'}</h3></div>
      {!supported && <div className="inline-error">请使用电脑 Chrome / Edge 打开本站，当前浏览器不支持串口。</div>}
      <div className="radio-actions"><button className="btn primary" disabled={!supported || working} onClick={() => void read()}><Download size={16} />{snapshot ? '重新读取电台' : '选择写频线并读取'}</button>{port.current && <button className="btn" disabled={working} onClick={() => void read(true)}>更换写频线</button>}{working && <button className="btn" onClick={() => abort.current?.abort()}><X size={16} />停止操作</button>}</div>
      <div className={`radio-progress ${error ? 'failed' : ''}`} role={error ? 'alert' : 'status'}><p>{message}</p>{working && <><progress aria-label="电台操作进度" value={progress} max={1} /><small>写入期间停止，会在当前数据块完成后中止；请随后重新读取核对。</small></>}</div>
    </div>
    <div className="radio-operation"><div className="radio-card-title"><Upload size={20} /><h3>同步修改</h3><select aria-label="写入范围" value={scope} disabled={working} onChange={e => setScope(e.target.value as WriteScope)}><option value="all">信道与设置</option><option value="channels">仅信道</option><option value="settings">仅设置</option></select></div>
      <div className="radio-actions"><button className="btn" disabled={!snapshot || working} onClick={showPreview}>检查写入内容</button><span className="radio-caption">{snapshot ? `读取于 ${new Date(snapshot.capturedAt).toLocaleString('zh-CN')}` : '先读取电台，再编辑或合并文件。'}</span></div>
      {preview && <div className="write-preview"><strong>{preview.blocks.length ? `${preview.changedBytes} 字节修改 · ${preview.blocks.length} 个数据块` : '没有需要同步的修改'}</strong><p>{preview.channels.length} 条信道参数 · {preview.names.length} 条名称 · {preview.settings} 个设置块</p>{preview.blocks.length > 0 && <><div className="write-diff"><table><thead><tr><th>位置 / 参数</th><th>读取值</th><th>写入值</th></tr></thead><tbody>{snapshot && describeWrite(snapshot, preview).map((change, i) => <tr key={i}><td>{change.target}<small>{change.field}</small></td><td>{change.before}</td><td>{change.after}</td></tr>)}</tbody></table></div><p>写前重新读取并备份，写后完整回读。网页写入尚待本机复测。</p><label className="check-label"><input type="checkbox" checked={reviewed} onChange={e => setReviewed(e.target.checked)} />已核对上述修改，写入当前连接的 D500</label><button className="btn primary" disabled={!reviewed || working || !port.current} onClick={() => void write()}><Upload size={16} />写入电台</button></>}</div>}
    </div>
    <div className="radio-operation"><div className="radio-card-title"><Radio size={20} /><h3>读取备份</h3><span>{backups.length} 份 · 当前浏览器</span></div>{!backups.length ? <p className="radio-empty">完成读取后自动保留原始配置。</p> : backups.slice(0, 10).map(item => <div className="radio-backup-row" key={item.capturedAt}><span>{new Date(item.capturedAt).toLocaleString('zh-CN')}</span><span>12.5 KiB</span><button className="text-btn" disabled={working} onClick={() => load(item)}>载入编辑</button><button className="text-btn" onClick={() => download(JSON.stringify(item), `D500-原始读取-${stamp(item)}.json`, 'application/json')}>原始备份</button><button className="text-btn" onClick={() => download(snapshotDat(item), `D500-读机-${stamp(item)}.dat`, 'text/plain')}><FileDown size={14} />DAT</button></div>)}</div>
    <details className="radio-operation radio-log"><summary>通信记录 <span>{traceCount} 条</span></summary><button className="btn" disabled={!traceCount || working} onClick={() => download(JSON.stringify({ protocol: 'cps-2025', browserWriteHardwareVerified: false, entries: trace.current }, null, 2), `D500-通信记录-${Date.now()}.json`, 'application/json')}>下载记录</button><p className="radio-caption">含设备与信道数据，仅保存在本机。</p><pre>{trace.current.slice(-12).map(item => `${item.at.slice(11, 23)} ${item.direction} ${item.hex}`).join('\n') || '暂无通信记录'}</pre></details>
  </section>;
}
