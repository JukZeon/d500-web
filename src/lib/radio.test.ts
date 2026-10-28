import { describe, it, expect, vi } from 'vitest';
import { parseDat, exportDat, parseRows } from './dat';
import { emptyWorkspace, newChannel } from './model';
import { CONFIG_SIZE, D500Protocol, HARDWARE_WRITE_VERIFIED, HARDWARE_WRITE_SMOKE_TESTED, HELLO, hasWriteBaseline, planFileWrite, planWorkspaceWrite, planWrite, programWorkspace, type WritePlan, readCommand, snapshotDat, writeEstimate, type RadioSnapshot } from './radio';
import { checkAbort, SerialLink, type RadioLink, type SerialPortLike } from './serial';
import { saveRadioBackup } from './radio-backups';
import { acceptWriteResult } from './write-result';

function setup() {
  const blank = Array.from({ length: 1025 }, (_, i) => [i >> 4, i % 16, i, ...Array(16).fill(255)].join(' ')).join('\n');
  const parsed = parseDat(exportDat([newChannel(0)], parseDat(blank).template));
  const workspace = { ...emptyWorkspace(), ...parsed };
  const snapshot: RadioSnapshot = { schema: 'd500-radio-read-v1', capturedAt: new Date().toISOString(), hardwareVerified: false,
    identity: [], bytes: parsed.template.rows.slice(0, CONFIG_SIZE / 16).flatMap(r => r.slice(3)) };
  return { workspace, snapshot };
}
class RadioSimulator implements RadioLink {
  queue: number[] = [];
  sent: number[][] = [];
  identity = Array(49).fill(0);
  password = Array(16).fill(0x20);
  pendingAck = false;
  wrongAddress = false; wrongAck = false; ignoreWrite = false; identityAckPrefix = false;
  constructor(public memory: number[], private prefix = true) { this.identity[0] = 1; this.identity[48] = 0x55; }
  async write(bytes: Uint8Array, signal?: AbortSignal) {
    checkAbort(signal); this.sent.push([...bytes]);
    if (bytes.length === 8 && bytes[0] === HELLO[0]) this.queue.push(...(this.prefix ? [6] : []), ...this.identity);
    else if (bytes[0] === 0x53) {
      const address = bytes[1] << 8 | bytes[2];
      const data = address === 0x3df0 ? this.password : this.memory.slice(address, address + bytes[3]);
      this.queue.push(...(address === 0x3df0 && this.identityAckPrefix ? [5] : []), 0x58, bytes[1], this.wrongAddress ? bytes[2] ^ 16 : bytes[2], bytes[3], ...data); this.pendingAck = true;
    } else if (bytes[0] === 0x58) {
      if (!this.ignoreWrite) this.memory.splice(bytes[1] << 8 | bytes[2], 16, ...bytes.slice(4));
      this.queue.push(this.wrongAck ? 0x15 : 6);
    } else if (bytes[0] === 6 && this.pendingAck) { if (this.prefix) this.queue.push(6); this.pendingAck = false; }
  }
  async read(count: number, signal?: AbortSignal) { checkAbort(signal); if (this.queue.length < count) throw new Error('模拟响应不足'); return Uint8Array.from(this.queue.splice(0, count)); }
  writes() { return this.sent.filter(p => p[0] === 0x58); }
}

async function candidate(io: RadioSimulator, workspace: ReturnType<typeof setup>['workspace'], plan: WritePlan, backup: (s: RadioSnapshot) => Promise<void>, progress: (done: number, total: number, label: string) => void) {
  const snapshot: RadioSnapshot = { schema: 'd500-radio-read-v1', capturedAt: new Date().toISOString(), hardwareVerified: false, identity: [...io.identity], bytes: [...io.memory] };
  return programWorkspace(async () => { io.queue = []; io.pendingAck = false; return { write: io.write.bind(io), read: io.read.bind(io), async close() { io.queue = []; } }; }, workspace, { snapshot, plan }, 'all', backup, progress);
}

describe('captured D500 protocol with synthetic device memory', () => {
  it('distinguishes the passed hardware smoke test from pending full-table verification', () => { expect(HARDWARE_WRITE_VERIFIED).toBe(false); expect(HARDWARE_WRITE_SMOKE_TESTED).toBe(true); });
  it('encodes bounded read commands and refuses unaligned or out-of-range addresses', () => {
    expect([...readCommand(0x3df0, 16)]).toEqual([0x53, 0x3d, 0xf0, 16]);
    expect(() => readCommand(1, 64)).toThrow(); expect(() => readCommand(0x4000, 64)).toThrow();
  });
  for (const prefix of [true, false]) it(`reads all 200 configuration blocks with ACK prefix ${prefix}`, async () => {
    const { snapshot } = setup(), io = new RadioSimulator([...snapshot.bytes], prefix);
    const updates: number[] = [];
    const result = await new D500Protocol(io).readImage(done => updates.push(done));
    expect(result.bytes).toEqual(snapshot.bytes); expect(updates.at(-1)).toBe(CONFIG_SIZE);
    expect(io.sent.filter(p => p[0] === 0x53)).toHaveLength(201); expect(io.writes()).toHaveLength(0);
    expect(io.sent[0]).toEqual([...HELLO]);
  });
  it('stops on unknown identity, malformed band data, passwords, or wrong response addresses', async () => {
    const { snapshot } = setup();
    for (const mutate of [(io: RadioSimulator) => { io.identity[48] = 0; }, (io: RadioSimulator) => { io.identity[17] = 250; }, (io: RadioSimulator) => { io.password[0] = 0x31; }, (io: RadioSimulator) => { io.wrongAddress = true; }]) {
      const io = new RadioSimulator([...snapshot.bytes]); mutate(io);
      await expect(new D500Protocol(io).readImage(() => {})).rejects.toThrow();
      expect(io.writes()).toHaveLength(0);
    }
  });
  it('handles the captured 2025 handshake, identity-ACK response and exact unprotected status', async () => {
    const { snapshot } = setup(), io = new RadioSimulator([...snapshot.bytes]);
    io.password = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 16]; io.identityAckPrefix = true;
    const result = await new D500Protocol(io).readImage(() => {});
    expect(io.sent[0]).toEqual([0x55, 0x20, 0x25, 7, 6, 255, 220, 2]);
    expect(result.communicationProfile).toBe('cps-2025'); expect(result.bytes).toEqual(snapshot.bytes);
    const unknown = new RadioSimulator([...snapshot.bytes]); unknown.password = [...io.password]; unknown.password[14] = 1;
    await expect(new D500Protocol(unknown).readImage(() => {})).rejects.toThrow('未知密码格式');
    expect(unknown.writes()).toHaveLength(0);
  });
  it('does not accept arbitrary ACK prefixes on configuration blocks', async () => {
    const { snapshot } = setup();
    const invalid = new RadioSimulator([...snapshot.bytes]); invalid.queue.push(5);
    await expect(new D500Protocol(invalid).readBlock(0, 64)).rejects.toThrow('未知帧');
  });
  it('reports the failing handshake stage', async () => {
    const link: RadioLink = { async write() {}, async read() { throw new Error('响应超时'); } };
    await expect(new D500Protocol(link).identify()).rejects.toThrow('握手失败');
  });
  it('connects by identifying the device without reading channel or configuration memory', async () => {
    const { snapshot } = setup(), io = new RadioSimulator([...snapshot.bytes]);
    expect([...await new D500Protocol(io).identify()]).toEqual(io.identity);
    expect(io.sent.filter(p => p[0] === 0x53)).toEqual([[0x53, 0x3d, 0xf0, 16]]);
    expect(io.writes()).toHaveLength(0);
  });
  it('stops on boot output during an active handshake without sending a second HELLO or writing data', async () => {
    const sent: number[][] = [];
    const link: RadioLink = { async write(bytes) { sent.push([...bytes]); }, async read() { return Uint8Array.of(0x55); } };
    await expect(new D500Protocol(link).identify()).rejects.toThrow('55');
    expect(sent).toEqual([[...HELLO]]);
  });
  it('cancellation sends no further packets', async () => {
    const { snapshot } = setup(), io = new RadioSimulator([...snapshot.bytes]), abort = new AbortController(); abort.abort();
    await expect(new D500Protocol(io).readImage(() => {}, abort.signal)).rejects.toThrow(); expect(io.sent).toHaveLength(0);
  });
  it('round-trips the read configuration into a DAT, marking unread rows FF', () => {
    const { snapshot } = setup(), rows = parseRows(snapshotDat(snapshot));
    expect(rows.slice(0, 800).flatMap(r => r.slice(3))).toEqual(snapshot.bytes);
    expect(rows.slice(800).every(r => r.slice(3).every(v => v === 255))).toBe(true);
    expect(parseDat(snapshotDat(snapshot)).channels).toHaveLength(1);
    expect(() => snapshotDat({ ...snapshot, bytes: [1] })).toThrow('备份');
  });
  it('previews only changed editable blocks, preserving fresh unknown bytes', () => {
    const { snapshot, workspace } = setup();
    expect(planWrite(snapshot, workspace).blocks).toHaveLength(0);
    workspace.channels[0].rx = '439.55000'; snapshot.bytes[15] ^= 0x80;
    const plan = planWrite(snapshot, workspace);
    expect(plan.channels).toEqual([0]); expect(plan.blocks).toHaveLength(1);
    expect(plan.blocks[0].after[15]).toBe(snapshot.bytes[15]);
    expect(plan.changedBytes).toBeGreaterThan(0);
  });
  it('detects conflicting device values and requires a DAT baseline', () => {
    const { snapshot, workspace } = setup(); workspace.channels[0].rx = '439.55000'; snapshot.bytes[1] = 0x99;
    expect(() => planWrite(snapshot, workspace)).toThrow('冲突');
    expect(() => planWrite(snapshot, { ...workspace, template: null })).toThrow('模板');
  });
  it('compares whole frequency fields and merges unrelated flag bits without inventing values', () => {
    const { snapshot, workspace } = setup(); workspace.channels[0].rx = '439.55000';
    // A change to an otherwise untouched byte in the same BCD field must conflict.
    snapshot.bytes[3] = 0x15;
    expect(() => planWrite(snapshot, workspace)).toThrow('冲突');
    const other = setup(); other.workspace.channels[0].bandwidth = 'wide'; other.snapshot.bytes[15] ^= 4;
    const plan = planWrite(other.snapshot, other.workspace);
    expect(plan.blocks[0].after[15] & 4).toBe(other.snapshot.bytes[15] & 4);
    expect(plan.blocks[0].after[15] & 64).toBe(0);
  });
  it('plans deletion of channel and name blocks while retaining all other regions', () => {
    const { snapshot, workspace } = setup(); workspace.channels = [];
    const plan = planWrite(snapshot, workspace);
    expect(plan.blocks.map(b => b.address)).toEqual([0]);
    expect(plan.blocks[0].after.every(v => v === 255)).toBe(true);
  });
  it('backs up the loaded baseline and completes on ACK without rereading configuration', async () => {
    const { snapshot, workspace } = setup(); workspace.channels[0].rx = '439.55000';
    const plan = planWrite(snapshot, workspace), io = new RadioSimulator([...snapshot.bytes]); let backedUp = false;
    const result = await candidate(io, workspace, plan, async fresh => {
      if (!backedUp) { expect(io.writes()).toHaveLength(0); expect(fresh.bytes).toEqual(snapshot.bytes); } backedUp = true;
    }, () => {});
    expect(backedUp).toBe(true); expect(io.writes()).toHaveLength(1);
    expect(io.memory.slice(0, 16)).toEqual(plan.blocks[0].after);
    expect(result.source).toBe('write-ack');
    expect(io.sent.filter(p => p[0] === 0x53)).toEqual([[0x53, 0x3d, 0xf0, 16]]);
    await expect(saveRadioBackup(result)).rejects.toThrow('不是读机备份');
  });
  it('uses one write session and the captured host ACK between changed blocks', async () => {
    const { snapshot, workspace } = setup(); workspace.channels[0].rx = '439.55000'; workspace.channels.push(newChannel(1));
    const plan = planWrite(snapshot, workspace), io = new RadioSimulator([...snapshot.bytes]);
    await candidate(io, workspace, plan, async () => {}, () => {});
    expect(io.sent.filter(p => p[0] === HELLO[0])).toHaveLength(1);
    const first = io.sent.findIndex(p => p[0] === 0x58), second = io.sent.findIndex((p, i) => i > first && p[0] === 0x58);
    expect(io.sent[first - 1]).toEqual([6]);
    expect(io.sent.slice(first, second + 1)).toEqual([[0x58, 0, 0, 16, ...plan.blocks[0].after], [6], [0x58, 0, 16, 16, ...plan.blocks[1].after]]);
  });
  it('cancels between complete write blocks and never retries or claims verification', async () => {
    const { snapshot, workspace } = setup(); workspace.channels[0].rx = '439.55000'; workspace.channels.push(newChannel(1));
    const plan = planWrite(snapshot, workspace), io = new RadioSimulator([...snapshot.bytes]), controller = new AbortController(); let sessions = 0;
    const open = async () => { sessions++; io.queue = []; io.pendingAck = false; return { write: io.write.bind(io), read: io.read.bind(io), async close() { io.queue = []; } }; };
    await expect(programWorkspace(open, workspace, { snapshot: { ...snapshot, identity: [...io.identity] }, plan }, 'all', async () => {}, (done, total, label) => { if (label.startsWith('写入 ')) controller.abort(); }, controller.signal)).rejects.toThrow('重新读取');
    expect(io.writes()).toHaveLength(1); expect(sessions).toBe(1);
  });
  it('sends no write when the loaded baseline conflicts or the backup fails', async () => {
    const { snapshot, workspace } = setup(); workspace.channels[0].rx = '439.55000'; const plan = planWrite(snapshot, workspace);
    const changed = new RadioSimulator([...snapshot.bytes]); changed.memory[0] ^= 1;
    await expect(candidate(changed, workspace, plan, async () => {}, () => {})).rejects.toThrow('方案已变化');
    expect(changed.writes()).toHaveLength(0);
    const io = new RadioSimulator([...snapshot.bytes]);
    await expect(candidate(io, workspace, plan, async () => { throw new Error('磁盘满'); }, () => {})).rejects.toThrow('磁盘满');
    expect(io.writes()).toHaveLength(0);
  });
  it('stops without retrying when a write ACK fails', async () => {
    const { snapshot, workspace } = setup(); workspace.channels[0].rx = '439.55000'; workspace.channels.push(newChannel(1)); const plan = planWrite(snapshot, workspace);
    const io = new RadioSimulator([...snapshot.bytes]); io.wrongAck = true;
    await expect(candidate(io, workspace, plan, async () => {}, () => {})).rejects.toThrow();
    expect(io.writes()).toHaveLength(1);
  });
  it('labels expected bytes as ACK-only and never claims readback verification', async () => {
    const { snapshot, workspace } = setup(); workspace.channels[0].name = 'EDIT';
    const plan = planWrite(snapshot, workspace), io = new RadioSimulator([...snapshot.bytes]); io.ignoreWrite = true;
    const result = await candidate(io, workspace, plan, async () => {}, () => {});
    expect(io.memory).toEqual(snapshot.bytes); expect(result.bytes).not.toEqual(snapshot.bytes);
    expect(result.source).toBe('write-ack');
  });
  it('writes the next edit directly without storing predicted bytes as a read backup', async () => {
    const { snapshot, workspace } = setup(); workspace.channels[0].name = 'EDIT';
    const io = new RadioSimulator([...snapshot.bytes]);
    const first = await candidate(io, workspace, planWrite(snapshot, workspace), async () => {}, () => {});
    const next = acceptWriteResult(workspace, first, 'all'); next.channels[0].name = 'TEST';
    const plan = planWrite(first, next);
    const second = await programWorkspace(async () => {
      io.queue = []; io.pendingAck = false;
      return { write: io.write.bind(io), read: io.read.bind(io), async close() {} };
    }, next, { snapshot: first, plan }, 'all', async () => { throw new Error('not a real read'); }, () => {});
    expect(second.source).toBe('write-ack'); expect(io.writes()).toHaveLength(2);
    expect(io.sent.filter(p => p[0] === 0x53)).toHaveLength(2); // Password status only.
  });
  it('writes an unchanged loaded DAT without first reading the radio or creating a false backup', async () => {
    const { snapshot, workspace } = setup(), io = new RadioSimulator([...snapshot.bytes]);
    io.memory[0] ^= 1; io.memory[0x0e00] = 42;
    const plan = planWorkspaceWrite(null, workspace, 'channels');
    expect(plan.mode).toBe('file'); expect(plan.blocks).toHaveLength(400);
    const result = await programWorkspace(async () => ({ write: io.write.bind(io), read: io.read.bind(io), async close() {} }), workspace,
      { snapshot: null, plan }, 'channels', async () => { throw new Error('no actual read'); }, () => {});
    expect(io.writes()).toHaveLength(400);
    expect(io.sent.filter(p => p[0] === 0x53)).toEqual([[0x53, 0x3d, 0xf0, 16]]);
    expect(io.memory.slice(0,16)).toEqual(snapshot.bytes.slice(0,16)); expect(io.memory[0x0e00]).toBe(42);
    expect(result.knownScopes).toEqual(['channels']);
    expect(hasWriteBaseline(result, 'channels')).toBe(true); expect(hasWriteBaseline(result, 'settings')).toBe(false);
    await expect(saveRadioBackup(result)).rejects.toThrow('不是读机备份');
    const next = acceptWriteResult(workspace, result, 'channels');
    expect(planWorkspaceWrite(result, next, 'channels').blocks).toHaveLength(0);
    expect(planWorkspaceWrite(result, next, 'settings').mode).toBe('file');
    next.channels[0].name = 'EDIT';
    const delta = planWorkspaceWrite(result, next, 'channels');
    expect(delta.mode).toBeUndefined(); expect(delta.blocks.map(b => b.address)).toEqual([0x1000]);
    const mixed = planWorkspaceWrite(result, next, 'all');
    expect(mixed.mode).toBe('file'); expect(mixed.blocks).toHaveLength(14);
    expect(mixed.channels).toHaveLength(0); expect(mixed.names).toEqual([0]);
  });
  it('limits file writes to channel/name ranges and confirmed settings blocks', () => {
    const { workspace } = setup();
    const settings = planFileWrite(workspace, 'settings'), channels = planFileWrite(workspace, 'channels'), all = planFileWrite(workspace, 'all');
    expect(settings.blocks.map(b => b.address/16)).toEqual([224,225,226,227,240,241,242,243,244,245,246,247,251]);
    expect(channels.blocks).toHaveLength(400); expect(all.blocks).toHaveLength(413);
    expect(all.blocks.some(b => [200,228,248,252,456,500].includes(b.address/16))).toBe(false);
  });
  it('compares an imported DAT target against the device baseline rather than its own file', () => {
    const { snapshot, workspace } = setup();
    const loaded = parseDat(exportDat([{...workspace.channels[0],name:'FILE'}],workspace.template,workspace.settings));
    const target = {...workspace,...loaded};
    expect(planWorkspaceWrite(snapshot,target,'channels').blocks.map(b=>b.address)).toEqual([0x1000]);
  });
  it('writes a one-name edit from a loaded file in one block, without reading or rewriting unknown settings', async () => {
    const { workspace, snapshot } = setup(), io = new RadioSimulator([...snapshot.bytes]);
    workspace.channels[0].name = 'EDIT'; io.memory[0x0e00] = 42;
    const options = { mode: 'changes' as const }, plan = planWorkspaceWrite(null,workspace,'all',options);
    expect(plan.blocks.map(b=>b.address)).toEqual([0x1000]);
    const result = await programWorkspace(async()=>({write:io.write.bind(io),read:io.read.bind(io),async close(){}}),workspace,{snapshot:null,plan,options},'all',async()=>{throw new Error('No read backup');},()=>{});
    expect(io.writes()).toHaveLength(1);
    expect(io.sent.filter(p=>p[0]===0x53)).toEqual([[0x53,0x3d,0xf0,16]]);
    expect(io.memory[0x0e00]).toBe(42);
    expect(result.knownScopes).toEqual([]); expect(result.knownAddresses).toEqual([0x1000]);
    const next=acceptWriteResult(workspace,result,'all');
    expect(planWorkspaceWrite(result,next,'all',options).blocks).toHaveLength(0);
    next.channels[0].name='';
    expect(planWorkspaceWrite(result,next,'all',options).blocks.map(b=>b.address)).toEqual([0x1000]);
  });
  it('keeps a pending setting after a channel-only edit from a file, including after serializing its state', async () => {
    const {workspace,snapshot}=setup(),io=new RadioSimulator([...snapshot.bytes]),options={mode:'changes' as const};
    workspace.channels[0].name='EDIT';workspace.settings!.text={boot:'TEST'};
    const plan=planWorkspaceWrite(null,workspace,'channels',options);
    const result=await programWorkspace(async()=>({write:io.write.bind(io),read:io.read.bind(io),async close(){}}),workspace,{snapshot:null,plan,options},'channels',async()=>{},()=>{});
    const restored:RadioSnapshot=JSON.parse(JSON.stringify(result)), next=acceptWriteResult(workspace,restored,'channels');
    expect(planWorkspaceWrite(restored,next,'channels',options).blocks).toHaveLength(0);
    expect(planWorkspaceWrite(restored,next,'all',options).blocks.map(b=>b.address)).toEqual([251*16]);
    expect(next.settings!.text!.boot).toBe('TEST');
  });
  it('does not promote partially known ranges to full coverage or rewrite untouched imported settings', () => {
    const {workspace,snapshot}=setup();
    workspace.channels[0].name='EDIT';
    const partial={...snapshot,source:'write-ack' as const,knownScopes:['channels' as const]};
    expect(planWorkspaceWrite(partial,workspace,'all',{mode:'changes'}).blocks.map(b=>b.address)).toEqual([0x1000]);
    expect(planWorkspaceWrite(partial,workspace,'all',{mode:'full'}).blocks).toHaveLength(413);
    expect(planWorkspaceWrite(null,{...workspace,channels:parseDat(workspace.template!.original).channels},'all',{mode:'changes'}).blocks).toHaveLength(0);
  });
  it('rejects a different write mode before opening a serial session and reports bounded estimates', async () => {
    const {workspace,snapshot}=setup(),open=vi.fn();workspace.channels[0].name='EDIT';
    const plan=planWorkspaceWrite(snapshot,workspace,'channels',{mode:'changes'});
    await expect(programWorkspace(open,workspace,{snapshot,plan,options:{mode:'full'}},'channels',async()=>{},()=>{})).rejects.toThrow('方案已变化');
    expect(open).not.toHaveBeenCalled();
    expect(writeEstimate(0)).toBe('无修改');expect(writeEstimate(1)).toBe('约 5 秒');expect(writeEstimate(400)).toBe('约 5 分钟');
  });
  it('does not send any file data when the connected device identity changes', async () => {
    const { snapshot, workspace } = setup(), io = new RadioSimulator([...snapshot.bytes]);
    const identity = [...io.identity]; identity[47] ^= 1;
    await expect(programWorkspace(async () => ({write:io.write.bind(io),read:io.read.bind(io),async close(){}}),workspace,
      {snapshot:null,plan:planFileWrite(workspace,'channels'),identity},'channels',async()=>{},()=>{})).rejects.toThrow('设备识别不一致');
    expect(io.writes()).toHaveLength(0);
  });
  it('rejects forged write plans outside the allowlist before communicating', async () => {
    const { snapshot, workspace } = setup(), plan = planWrite(snapshot, workspace), io = new RadioSimulator([...snapshot.bytes]);
    plan.blocks.push({ address: 0x3df0, before: Array(16).fill(32), after: Array(16).fill(0) });
    await expect(candidate(io, workspace, plan, async () => {}, () => {})).rejects.toThrow('未确认');
    expect(io.sent).toHaveLength(0);
  });
  it('rejects forged reserved bits, unknown setting bytes, and duplicate blocks', async () => {
    const { snapshot, workspace } = setup();
    for (const row of [0, 224, 500]) {
      const plan = planWrite(snapshot, workspace), io = new RadioSimulator([...snapshot.bytes]);
      const before = snapshot.bytes.slice(row * 16, row * 16 + 16), after = [...before]; after[row === 0 ? 14 : 1] ^= row === 0 ? 0x80 : 1;
      plan.blocks.push({ address: row * 16, before, after });
      await expect(candidate(io, workspace, plan, async () => {}, () => {})).rejects.toThrow('未确认');
      expect(io.sent).toHaveLength(0);
    }
    workspace.channels[0].rx = '439.55000'; const plan = planWrite(snapshot, workspace), io = new RadioSimulator([...snapshot.bytes]);
    plan.blocks.push(plan.blocks[0]);
    await expect(candidate(io, workspace, plan, async () => {}, () => {})).rejects.toThrow('未确认');
    expect(io.sent).toHaveLength(0);
  });
});

describe('Web Serial transport', () => {
  function port() {
    let input!: ReadableStreamDefaultController<Uint8Array>;
    const output: number[] = [];
    const device: SerialPortLike = { readable: new ReadableStream({ start(c) { input = c; } }),
      writable: new WritableStream({ write(bytes) { output.push(...bytes); } }),
      async open() {}, async close() {}, getInfo() { return {}; } };
    return { device, output, input };
  }
  it('drains stale identity tails and reboot output before HELLO, retaining all later bytes', async () => {
    vi.useFakeTimers();
    try {
      const { device, output, input } = port(), messages: string[] = [];
      input.enqueue(Uint8Array.of(1, 0, 8, 0x55));
      let ready = false;
      const opening = SerialLink.open(device, e => messages.push(e.hex)).then(link => { ready = true; return link; });
      await vi.advanceTimersByTimeAsync(300);
      const boot = new TextEncoder().encode('Uart functional API interrupt example\r\n'); input.enqueue(boot);
      await vi.advanceTimersByTimeAsync(225);
      expect(ready).toBe(false); expect(output).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(25);
      const link = await opening;
      expect(messages).toContain(`连接就绪 · 已清理 ${4 + boot.length} 字节`);
      input.enqueue(Uint8Array.of(0x55, 6));
      expect([...await link.read(2)]).toEqual([0x55, 6]);
      const closing = link.close(); await vi.advanceTimersByTimeAsync(2500); await closing;
    } finally { vi.useRealTimers(); }
  });
  it('honors cancellation during startup and completes the DTR-low exit interval before closing', async () => {
    vi.useFakeTimers();
    try {
      const { device, output } = port(), controller = new AbortController(), signals: unknown[] = [];
      let closedAt = -1;
      device.setSignals = async value => { signals.push(value); };
      device.close = async () => { closedAt = Date.now(); };
      const startedAt = Date.now();
      const outcome = SerialLink.open(device, () => {}, 5000, undefined, controller.signal).catch(e => e);
      await vi.advanceTimersByTimeAsync(100); controller.abort();
      await vi.advanceTimersByTimeAsync(25);
      expect(closedAt).toBe(-1);
      expect(signals.at(-1)).toEqual({ dataTerminalReady: false, requestToSend: false, break: false });
      await vi.advanceTimersByTimeAsync(2500);
      expect(await outcome).toBeInstanceOf(DOMException); expect(output).toHaveLength(0);
      expect(closedAt - startedAt).toBeGreaterThanOrEqual(2600);
      expect(device.readable?.locked).toBe(false); expect(device.writable?.locked).toBe(false);
    } finally { vi.useRealTimers(); }
  });
  it('refuses a port with continuous startup noise rather than discarding data indefinitely', async () => {
    vi.useFakeTimers();
    const { device, input, output } = port();
    const noise = setInterval(() => input.enqueue(Uint8Array.of(0x55)), 100);
    try {
      const outcome = SerialLink.open(device, () => {}).catch(e => e);
      await vi.advanceTimersByTimeAsync(3000); clearInterval(noise);
      await vi.advanceTimersByTimeAsync(2500);
      expect((await outcome).message).toBe('串口接收未稳定'); expect(output).toHaveLength(0);
      expect(device.readable?.locked).toBe(false); expect(device.writable?.locked).toBe(false);
    } finally { clearInterval(noise); vi.useRealTimers(); }
  });
  it('assembles fragmented responses and keeps surplus bytes for the next read', async () => {
    const { device, input } = port(), link = await SerialLink.open(device, () => {}, 100);
    const reading = link.read(4); input.enqueue(Uint8Array.of(1)); input.enqueue(Uint8Array.of(2, 3, 4, 5));
    expect([...await reading]).toEqual([1, 2, 3, 4]); expect([...await link.read(1)]).toEqual([5]); await link.close();
  });
  it('times out, cancels pending reads, rejects unplugged streams, and releases locks', async () => {
    const { device } = port(), link = await SerialLink.open(device, () => {}, 15);
    await expect(link.read(1)).rejects.toThrow('超时');
    const controller = new AbortController(), reading = link.read(1, controller.signal); controller.abort();
    await expect(reading).rejects.toThrow(); await link.close();
    await expect(link.read(1)).rejects.toThrow('关闭');
    expect(device.readable?.locked).toBe(false); expect(device.writable?.locked).toBe(false);
    const disconnected = port(), other = await SerialLink.open(disconnected.device, () => {});
    disconnected.input.close(); await expect(other.read(1)).rejects.toThrow('断开'); await other.close();
  }, 10000);
  it('writes bytes in order, rejects concurrent readers, and honors pre-cancelled sends', async () => {
    const { device, output, input } = port(), link = await SerialLink.open(device, () => {});
    const sending = link.write(Uint8Array.of(0x53, 0, 0, 64));
    await expect(link.write(Uint8Array.of(1))).rejects.toThrow('同时'); await sending; expect(output).toEqual([0x53, 0, 0, 64]);
    const first = link.read(1); await expect(link.read(1)).rejects.toThrow('同时'); input.enqueue(Uint8Array.of(6)); await first;
    const controller = new AbortController(); controller.abort(); await expect(link.write(Uint8Array.of(9), controller.signal)).rejects.toThrow();
    expect(output).toHaveLength(4); await link.close();
  });
  it('sets the captured DTR/RTS state and reports the transport parameters', async () => {
    const { device } = port(); const signals: unknown[] = [], messages: string[] = [];
    device.setSignals = async value => { signals.push(value); };
    const link = await SerialLink.open(device, entry => { messages.push(entry.hex); });
    expect(signals).toEqual([{ dataTerminalReady: true, requestToSend: false, break: false }]);
    expect(messages[0]).toContain('32 ms'); await link.close();
    expect(signals.at(-1)).toEqual({ dataTerminalReady: false, requestToSend: false, break: false });
  });
});
