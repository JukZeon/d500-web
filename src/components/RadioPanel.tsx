import { useEffect, useRef, useState } from 'react';
import { Cable, Download, FileDown, Radio, ShieldCheck, Unplug, Upload, X } from 'lucide-react';
import type { Workspace } from '../lib/model';
import { parseDat } from '../lib/dat';
import { download } from '../lib/project';
import { D500Protocol, planWrite, snapshotDat, type RadioSnapshot, type WritePlan } from '../lib/radio';
import { listRadioBackups, saveRadioBackup } from '../lib/radio-backups';
import { SerialLink, serialApi, type TraceEntry } from '../lib/serial';

type Props = { visible: boolean; workspace: Workspace; onRead: (text: string, name: string) => void; onConnection: (connected: boolean) => void };
const stamp = (snapshot: RadioSnapshot) => snapshot.capturedAt.replace(/[:.]/g, '-');
export default function RadioPanel({ visible, workspace, onRead, onConnection }: Props) {
  const [connected, setConnected] = useState(false), [working, setWorking] = useState(false);
  const [confirmed, setConfirmed] = useState(false), [message, setMessage] = useState('连接写频线后，先读取并备份。');
  const [error, setError] = useState(false), [progress, setProgress] = useState(0);
  const [snapshot, setSnapshot] = useState<RadioSnapshot | null>(null), [backups, setBackups] = useState<RadioSnapshot[]>([]);
  const [preview, setPreview] = useState<WritePlan | null>(null), [traceCount, setTraceCount] = useState(0);
  const link = useRef<SerialLink | null>(null), abort = useRef<AbortController | null>(null), trace = useRef<TraceEntry[]>([]);
  const supported = !!serialApi();
  const connectionCallback = useRef(onConnection); connectionCallback.current = onConnection;
  useEffect(() => {
    void listRadioBackups().then(setBackups).catch(() => { /* Report a durable save failure when reading. */ });
    return () => { abort.current?.abort(); void link.current?.close().catch(() => {}); };
  }, []);
  useEffect(() => { setPreview(null); }, [workspace, snapshot]);
  const addTrace = (entry: TraceEntry) => { trace.current = [...trace.current.slice(-4095), entry]; setTraceCount(trace.current.length); };
  const status = (text: string, failed = false) => { setMessage(text); setError(failed); };
  async function disconnect() {
    const current = link.current; link.current = null;
    setConnected(false); connectionCallback.current(false);
    if (current) await current.close();
  }
  async function connect() {
    const api = serialApi(); if (!api || working || connected) return;
    setWorking(true); setSnapshot(null); setPreview(null);
    try {
      const port = await api.requestPort();
      trace.current = []; setTraceCount(0);
      link.current = await SerialLink.open(port, addTrace, 2500, problem => {
        status(problem.message, true);
        void disconnect().catch(() => {});
      });
      setConnected(true); connectionCallback.current(true); status('写频线已连接。点击“读取电台”开始。');
    } catch (e) {
      status(e instanceof DOMException && e.name === 'NotFoundError' ? '已取消选择写频线。' : e instanceof Error ? e.message : String(e), true);
    } finally { setWorking(false); }
  }
  async function read() {
    if (!link.current || working || !confirmed) return;
    setWorking(true); setSnapshot(null); setPreview(null); setProgress(0); setError(false);
    const controller = new AbortController(); abort.current = controller;
    try {
      const result = await new D500Protocol(link.current).readImage((done, total, label) => { setProgress(done / total); setMessage(label); }, controller.signal);
      setSnapshot(result);
      await saveRadioBackup(result);
      setBackups(await listRadioBackups());
      // Save the raw result first, including when the DAT decoder rejects the contents.
      const dat = snapshotDat(result), name = `D500-读机-${stamp(result)}.dat`;
      parseDat(dat, name);
      status('读取完成，原始配置已保存到本机。可载入编辑，或下载备份。');
    } catch (e) {
      status(controller.signal.aborted ? '读取已取消，未替换当前方案。' : e instanceof Error ? e.message : String(e), !controller.signal.aborted);
    } finally {
      abort.current = null;
      try { await disconnect(); } catch { /* The raw result is still available after unplugging. */ }
      setWorking(false);
    }
  }
  function showPreview() {
    if (!snapshot) return;
    try { setPreview(planWrite(snapshot, workspace)); status('已生成写入预览。写入电台须待实机验证后开放。'); }
    catch (e) { setPreview(null); status(e instanceof Error ? e.message : String(e), true); }
  }
  function load(snapshot: RadioSnapshot) {
    try { const text = snapshotDat(snapshot), name = `D500-读机-${stamp(snapshot)}.dat`; parseDat(text, name); onRead(text, name); }
    catch (e) { status(e instanceof Error ? e.message : String(e), true); }
  }
  return <section className="radio-page" hidden={!visible}>
    <div className="radio-intro"><div><span className="eyebrow">DEVICE CONNECTION</span><h2>连接电台</h2><p>旧版 D500 · 9600 bps · 数据仅在本机处理</p></div><span className="experimental-badge">实验性读取</span></div>
    <div className="radio-layout">
      <div className="radio-card">
        <div className="radio-card-title"><Cable size={22} /><h3>写频线</h3><span className={`radio-state ${connected ? 'online' : ''}`}>{connected ? '已连接' : '未连接'}</span></div>
        {!supported && <div className="inline-error">当前浏览器未提供串口访问。请用电脑上的 Chrome / Edge 打开本站，并在浏览器中选择写频线。</div>}
        <ol className="radio-steps"><li>电台开机，接好 USB 写频线。</li><li>关闭占用串口的原厂写频软件。</li><li>选择对应写频线，读取原始配置。</li></ol>
        <label className="check-label"><input type="checkbox" checked={confirmed} disabled={working} onChange={e => setConfirmed(e.target.checked)} />确认是旧版 D500（无航空接收）</label>
        <div className="radio-actions"><button className="btn" disabled={!supported || working || connected} onClick={() => void connect()}><Cable size={16} />连接写频线</button><button className="btn primary" disabled={!connected || working || !confirmed} onClick={() => void read()}><Download size={16} />读取电台</button>{connected && !working && <button className="btn" onClick={() => void disconnect().then(() => status('已断开连接。')).catch(e => status(String(e), true))}><Unplug size={16} />断开</button>}{working && abort.current && <button className="btn" onClick={() => abort.current?.abort()}><X size={16} />取消读取</button>}</div>
        <div className={`radio-progress ${error ? 'failed' : ''}`} role={error ? 'alert' : 'status'}><p>{message}</p>{working && <progress aria-label="读机进度" value={progress} max={1} />}</div>
        <div className="notice"><ShieldCheck size={18} /><p>协议来自原厂 V1 软件分析，尚未经过实机验证。首次连接只读取配置，遇到未知响应立即停止。</p></div>
      </div>
      <div className="radio-card">
        <div className="radio-card-title"><Radio size={22} /><h3>读取 → 编辑 → 写入</h3></div>
        <div className="radio-result"><span>本次读取</span><strong>{snapshot ? new Date(snapshot.capturedAt).toLocaleString('zh-CN') : '等待读取'}</strong><small>配置区 0x0000–0x31FF；不包含全芯片或固件备份。</small></div>
        <div className="radio-actions"><button className="btn primary" disabled={!snapshot || working} onClick={() => snapshot && load(snapshot)}>载入工作台</button><button className="btn" disabled={!snapshot || working} onClick={() => snapshot && download(snapshotDat(snapshot), `D500-读机-${stamp(snapshot)}.dat`, 'text/plain')}><FileDown size={16} />下载 DAT</button><button className="btn" disabled={!snapshot || working} onClick={showPreview}><Upload size={16} />写入预览</button></div>
        {preview && <div className="write-preview"><strong>{preview.blocks.length ? `${preview.blocks.length} 个数据块 · ${preview.changedBytes} 字节变化` : '电台与方案无需同步'}</strong><p>{preview.channels.length} 条信道参数 · {preview.names.length} 条名称 · {preview.settings} 个设置块</p><small>仅比较可编辑区域。写前重新读取、保存备份，写后逐块回读。</small></div>}
        <button className="btn radio-write-locked" disabled>写入电台 · 待实机验证</button>
        <p className="radio-caption">当前可通过导出 DAT，交由原厂软件写入。</p>
      </div>
    </div>
    <div className="radio-card radio-backups"><div className="radio-card-title"><ShieldCheck size={21} /><h3>本机读机备份</h3><span className="radio-state">{backups.length} 份</span></div><p className="radio-caption">保存在当前浏览器。下载备份可避免清理浏览器后丢失。</p>{!backups.length ? <p className="radio-empty">完成首次读取后，原始配置会保存在这里。</p> : backups.slice(0, 10).map(item => <div className="radio-backup-row" key={item.capturedAt}><span>{new Date(item.capturedAt).toLocaleString('zh-CN')}</span><span>12.5 KiB 配置区</span><button className="text-btn" disabled={working} onClick={() => load(item)}>载入</button><button className="text-btn" onClick={() => download(JSON.stringify(item), `D500-原始读取-${stamp(item)}.json`, 'application/json')}>下载原始备份</button><button className="text-btn" onClick={() => download(snapshotDat(item), `D500-读机-${stamp(item)}.dat`, 'text/plain')}>DAT</button></div>)}</div>
    <details className="radio-card radio-log"><summary>通信记录 <span>{traceCount} 条 · 仅本机</span></summary><p className="radio-caption">记录可能含信道和设备数据。仅在排障时自行下载分享。</p><button className="btn" disabled={!traceCount || working} onClick={() => download(JSON.stringify({ protocol: 'D500 V1 experimental', hardwareVerified: false, entries: trace.current }, null, 2), `D500-通信记录-${Date.now()}.json`, 'application/json')}>下载通信记录</button><pre>{trace.current.slice(-12).map(item => `${item.at.slice(11, 23)} ${item.direction} ${item.hex}`).join('\n') || '暂无通信记录'}</pre></details>
  </section>;
}
