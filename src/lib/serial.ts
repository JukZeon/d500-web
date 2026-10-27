/** Minimal Web Serial surface; no automatic port selection or signal toggling. */
export interface SerialPortLike {
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
  open(options: { baudRate: number; dataBits: 8; stopBits: 1; parity: 'none'; flowControl: 'none' }): Promise<void>;
  close(): Promise<void>;
  getInfo(): { usbVendorId?: number; usbProductId?: number };
}
export interface SerialApi { requestPort(): Promise<SerialPortLike> }
export function serialApi(): SerialApi | undefined {
  return typeof navigator !== 'undefined' && globalThis.isSecureContext
    ? (navigator as Navigator & { serial?: SerialApi }).serial : undefined;
}
export interface RadioLink {
  write(bytes: Uint8Array, signal?: AbortSignal): Promise<void>;
  read(count: number, signal?: AbortSignal): Promise<Uint8Array>;
}
export type TraceEntry = { at: string; direction: 'TX' | 'RX' | 'INFO'; hex: string };
export const hex = (bytes: Uint8Array) => [...bytes].map(v => v.toString(16).padStart(2, '0')).join(' ').toUpperCase();
export function checkAbort(signal?: AbortSignal) { signal?.throwIfAborted(); }

export class SerialLink implements RadioLink {
  private reader: ReadableStreamDefaultReader<Uint8Array>;
  private writer: WritableStreamDefaultWriter<Uint8Array>;
  private buffer: number[] = [];
  private wake?: () => void;
  private failed?: Error;
  private closed = false;
  private consuming = false;
  private sending = false;
  private pumping: Promise<void>;
  private constructor(private port: SerialPortLike, private trace: (entry: TraceEntry) => void, private timeout: number, private disconnected?: (error: Error) => void) {
    this.reader = port.readable!.getReader(); this.writer = port.writable!.getWriter();
    this.pumping = this.pump();
  }
  static async open(port: SerialPortLike, trace: (entry: TraceEntry) => void, timeout = 2500, disconnected?: (error: Error) => void) {
    await port.open({ baudRate: 9600, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none' });
    if (!port.readable || !port.writable) { await port.close(); throw new Error('写频线没有可用的数据通道。'); }
    return new SerialLink(port, trace, timeout, disconnected);
  }
  private async pump() {
    try {
      while (!this.closed) {
        const { value, done } = await this.reader.read();
        if (done) { if (!this.closed) throw new Error('写频线已断开，请重新连接。'); break; }
        if (!value?.length) continue;
        this.trace({ at: new Date().toISOString(), direction: 'RX', hex: hex(value) });
        if (this.buffer.length + value.length > 65536) throw new Error('收到过多非预期数据，请断开后重新连接。');
        this.buffer.push(...value); this.wake?.();
      }
    } catch (e) {
      this.failed = e instanceof Error ? e : new Error(String(e)); this.wake?.();
      if (!this.closed) this.disconnected?.(this.failed);
    }
  }
  async read(count: number, signal?: AbortSignal): Promise<Uint8Array> {
    if (!Number.isInteger(count) || count < 1 || count > 16384) throw new Error('读取长度无效');
    checkAbort(signal);
    if (this.closed || this.failed) throw this.failed ?? new Error('连接已关闭');
    if (this.consuming) throw new Error('不能同时执行两次串口读取');
    this.consuming = true;
    const deadline = Date.now() + this.timeout;
    try {
      while (this.buffer.length < count) {
        checkAbort(signal);
        if (this.failed) throw this.failed;
        if (this.closed) throw new Error('连接已关闭');
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new Error('电台响应超时。请检查电源、插头和写频线，并关闭占用串口的软件。');
        await new Promise<void>((resolve, reject) => {
          const finish = (error?: unknown) => {
            clearTimeout(timer); signal?.removeEventListener('abort', abort); this.wake = undefined;
            if (error) reject(error); else resolve();
          };
          const abort = () => finish(signal?.reason ?? new DOMException('已取消', 'AbortError'));
          const timer = setTimeout(() => finish(new Error('电台响应超时，请重新连接后重试。')), remaining);
          this.wake = () => finish(); signal?.addEventListener('abort', abort, { once: true });
          if (signal?.aborted) abort();
        });
      }
      checkAbort(signal);
      if (this.failed) throw this.failed;
      return Uint8Array.from(this.buffer.splice(0, count));
    } finally { this.consuming = false; }
  }
  async write(bytes: Uint8Array, signal?: AbortSignal) {
    checkAbort(signal);
    if (this.closed || this.failed) throw this.failed ?? new Error('连接已关闭');
    if (this.sending) throw new Error('不能同时向串口发送两个数据包');
    this.sending = true;
    try {
      this.trace({ at: new Date().toISOString(), direction: 'TX', hex: hex(bytes) });
      // The native CPS emits individual bytes. Timing is provisional until cable testing.
      for (const byte of bytes) {
        checkAbort(signal);
        await this.writer.write(Uint8Array.of(byte));
        await new Promise(resolve => setTimeout(resolve, 1));
      }
    } finally { this.sending = false; }
  }
  async close() {
    if (this.closed) return;
    this.closed = true; this.wake?.();
    try { await this.reader.cancel(); } catch { /* unplugged */ }
    await this.pumping;
    this.reader.releaseLock(); this.writer.releaseLock();
    await this.port.close();
  }
}
