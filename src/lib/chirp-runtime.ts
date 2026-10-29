import { serialApi, type SerialPortLike, type TraceEntry, hex } from './serial';
import type { ChirpModel } from './chirp';
import { version } from '../../package.json';
export const CHIRP_BAUD: Record<ChirpModel, number> = { uv5r: 9600, uv5rh: 115200, 'uvk5-stock':38400, 'uvk5-losehu':38400, 'uvk5-egzumer':38400 };
export const directRadioSupported = () => !!serialApi() && globalThis.crossOriginIsolated && typeof SharedArrayBuffer !== 'undefined';
interface IoRequest { op: 'read' | 'write' | 'purge'; size?: number; timeout?: number; data?: number[] }
interface WorkerMessage { type: 'io' | 'progress' | 'result' | 'error' | 'diagnostic'; request?: IoRequest; done?: number; total?: number; data?: unknown; error?: string; text?: string }
/** CHIRP synchronous reads must return partial bytes on timeout, as pyserial does. */
export class BrowserRadioPort {
  private reader: ReadableStreamDefaultReader<Uint8Array>;
  private writer: WritableStreamDefaultWriter<Uint8Array>;
  private bytes: number[] = [];
  private changed?: () => void;
  private failed?: Error;
  private closed = false;
  private pumpTask: Promise<void>;
  constructor(private port: SerialPortLike, private trace: (entry: TraceEntry) => void) {
    if (!port.readable || !port.writable) throw new Error('串口没有可用的数据通道');
    this.reader=port.readable.getReader(); this.writer=port.writable.getWriter(); this.pumpTask=this.pump();
  }
  private async pump() {
    try {
      while (!this.closed) {
        const result=await this.reader.read();
        if (result.done) { if(!this.closed) throw new Error('写频线已断开'); break; }
        if (!result.value?.length) continue;
        if (this.bytes.length+result.value.length>65536) throw new Error('串口缓冲区溢出');
        this.bytes.push(...result.value); this.trace({at:new Date().toISOString(),direction:'RX',hex:hex(result.value)}); this.changed?.();
      }
    } catch(e) { this.failed=e instanceof Error?e:new Error(String(e)); this.changed?.(); }
  }
  async io(request: IoRequest): Promise<{data:number[]} | {written:number}> {
    if (this.failed) throw this.failed;
    if (this.closed) throw new Error('串口已关闭');
    if (request.op==='write') {
      if (!Array.isArray(request.data) || request.data.length>16384 || request.data.some(b=>!Number.isInteger(b)||b<0||b>255)) throw new Error('发送数据无效');
      const data=Uint8Array.from(request.data);await this.writer.write(data);
      this.trace({at:new Date().toISOString(),direction:'TX',hex:hex(data)}); return {written:data.length};
    }
    if (request.op==='purge') { this.bytes=[];return {data:[]}; }
    if (!Number.isInteger(request.size) || request.size!<1 || request.size!>16384) throw new Error('读取长度无效');
    const count=request.size!, timeout=Math.max(0,Math.min(30_000,(request.timeout??1)*1000)), until=Date.now()+timeout;
    while(this.bytes.length<count && Date.now()<until) {
      if(this.failed) throw this.failed;
      await new Promise<void>(resolve=>{const finish=()=>{clearTimeout(timer);this.changed=undefined;resolve();};const timer=setTimeout(finish,Math.max(0,until-Date.now()));this.changed=finish;});
    }
    if(this.failed) throw this.failed;
    return {data:this.bytes.splice(0,count)};
  }
  async close() {
    this.closed=true;this.changed?.();
    try { await this.reader.cancel(); } finally { await this.pumpTask;this.reader.releaseLock();this.writer.releaseLock();await this.port.close(); }
  }
}
export class ChirpRuntime {
  private worker?: Worker;
  private running=false;
  private id=0;
  readonly trace:TraceEntry[]=[];
  private record(entry:TraceEntry) { this.trace.push(entry);if(this.trace.length>3000)this.trace.shift(); }
  private info(text:string) { this.record({at:new Date().toISOString(),direction:'INFO',hex:text}); }
  async execute<T>(request: {action:string;model:ChirpModel;[key:string]:unknown}, progress?: (done:number,total:number)=>void, port?:SerialPortLike):Promise<T> {
    if(this.running) throw new Error('已有电台操作正在进行');
    if(!globalThis.crossOriginIsolated || typeof SharedArrayBuffer==='undefined') throw new Error('页面缺少浏览器隔离支持，请更新部署配置后重新打开');
    this.running=true;
    let transport:BrowserRadioPort|undefined;
    try {
      if(port) this.info(`${request.action} · ${request.model} · v${version} · ${CHIRP_BAUD[request.model]} 8N1`);
      if(port) {
        await port.open({baudRate:CHIRP_BAUD[request.model],dataBits:8,stopBits:1,parity:'none',flowControl:'none'});
        try { await port.setSignals?.({dataTerminalReady:true,requestToSend:true,break:false}); transport=new BrowserRadioPort(port,entry=>this.record(entry)); }
        catch(e){await port.close();throw e;}
      }
      this.worker??=new Worker('/radio/worker.js',{type:'module'});
      const worker=this.worker, buffer=new SharedArrayBuffer(65544), control=new Int32Array(buffer,0,2);
      const finishIo=(response:unknown)=>{const bytes=new TextEncoder().encode(JSON.stringify(response));new Uint8Array(buffer,8,bytes.length).set(bytes);Atomics.store(control,1,bytes.length);Atomics.store(control,0,1);Atomics.notify(control,0);};
      return await new Promise<T>((resolve,reject)=>{
        worker.onmessage=(event:MessageEvent<WorkerMessage>)=>{
          const data=event.data;
          if(data.type==='io') {
            if(!transport || !data.request){finishIo({error:'没有连接电台'});return;}
            void transport.io(data.request).then(finishIo).catch(e=>finishIo({error:(e as Error).message}));
          } else if(data.type==='progress') progress?.(data.done??0,data.total??1);
          else if(data.type==='result') resolve(data.data as T);
          else if(data.type==='diagnostic' && data.text) this.info(data.text);
          else if(data.type==='error') { this.info(data.error??'驱动执行失败');reject(new Error(data.error?.split('\n').filter(Boolean).pop()??'驱动执行失败')); }
        };
        worker.onerror=event=>{const message=event.message||'浏览器驱动加载失败';this.info(message);worker.terminate();this.worker=undefined;reject(new Error(message));};
        worker.postMessage({id:++this.id,request,buffer});
      });
    } finally {
      try { if(transport){await new Promise(resolve=>setTimeout(resolve,100));await transport.close();} }
      finally{this.running=false;}
    }
  }
  dispose(){if(!this.running){this.worker?.terminate();this.worker=undefined;}}
}
