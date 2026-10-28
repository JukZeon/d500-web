/** D500 configuration protocol, checked against CPS capture and a real radio read.
 * See docs/SERIAL_PROTOCOL.md for the evidence and remaining write limitations.
 */
import { exportDat, parseDat, parseRows } from './dat';
import { type Workspace, type Channel, POWER_LABEL, PTT_OPTIONS, SIGNAL_OPTIONS, MUTE_OPTIONS, slotLabel } from './model';
import { decodeTone } from './tone';
import { settingsFields, MENU_SETTINGS, VFO_SETTINGS } from './settings';
import { checkAbort, hex, type RadioLink } from './serial';

// Full-table / power-cycle validation is pending; the three-block smoke test passed.
export const HARDWARE_WRITE_VERIFIED = false;
export const HARDWARE_WRITE_SMOKE_TESTED = true;
export const CONFIG_SIZE = 0x3200;
export const HELLO = Uint8Array.of(0x55, 0x20, 0x25, 0x07, 0x06, 0xff, 0xdc, 0x02);
export interface RadioSnapshot {
  schema: 'd500-radio-read-v1';
  capturedAt: string;
  identity: number[];
  bytes: number[];
  hardwareVerified: false;
  communicationProfile?: 'cps-2025';
  /** ACK-only state is used for the next delta; it is never saved as a read backup. */
  source?: 'radio-read' | 'write-ack';
  /** Omitted on complete reads; file-only writes establish only these ranges. */
  knownScopes?: ('channels' | 'settings')[];
}
export type Progress = (done: number, total: number, label: string) => void;
export interface WriteBlock { address: number; before: number[]; after: number[] }
export interface WritePlan { blocks: WriteBlock[]; channels: number[]; names: number[]; settings: number; changedBytes: number; mode?: 'file' }
const addressText = (address: number) => `0x${address.toString(16).padStart(4, '0').toUpperCase()}`;
function editableByte(row: number, byte: number) {
  return row >= 0 && row < 200 || row >= 256 && row < 456 || settingsFields(row).some(field => field.includes(byte));
}
const CHANNEL_MASKS = [255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 15, 255, 0x13, 0x4f];
function editableMask(row: number, byte: number, old: number[], next: number[]) {
  if (!editableByte(row, byte)) return 0;
  if (row >= 200 || old.every(v => v === 255) || next.every(v => v === 255)) return 255;
  return CHANNEL_MASKS[byte];
}
type Field = { bytes: number[]; mask: number };
function fields(row: number, old: number[], next: number[]): Field[] {
  const span = (start: number, length: number): Field => ({ bytes: Array.from({ length }, (_, i) => start + i), mask: 255 });
  if (row >= 256 && row < 456 || row < 200 && (old.every(v => v === 255) || next.every(v => v === 255))) return [span(0, 16)];
  if (row < 200) return [span(0, 4), span(4, 4), span(8, 2), span(10, 2),
    ...[[12, 15], [13, 15], [13, 240], [14, 3], [14, 16], [15, 3], [15, 4], [15, 8], [15, 64]].map(([byte, mask]) => ({ bytes: [byte], mask }))];
  return settingsFields(row).map(bytes => ({ bytes, mask: 255 }));
}

export function readCommand(address: number, length: 16 | 64) {
  if (![16, 64].includes(length) || !Number.isInteger(address) || address < 0 || address + length > 0x4000 || address % length) throw new Error('读取地址无效');
  return Uint8Array.of(0x53, address >> 8, address & 255, length);
}
function validSnapshot(snapshot: RadioSnapshot) {
  if (snapshot.schema !== 'd500-radio-read-v1' || snapshot.bytes.length !== CONFIG_SIZE || snapshot.bytes.some(b => !Number.isInteger(b) || b < 0 || b > 255)) throw new Error('读机备份无效');
}
export function snapshotDat(snapshot: RadioSnapshot): string {
  validSnapshot(snapshot);
  return Array.from({ length: 1025 }, (_, row) => [Math.floor(row / 16), row % 16, row,
    ...Array.from({ length: 16 }, (_, i) => snapshot.bytes[row * 16 + i] ?? 255)].join(' ')).join('\r\n') + '\r\n';
}
export function planWrite(snapshot: RadioSnapshot, workspace: Workspace): WritePlan {
  validSnapshot(snapshot);
  if (!workspace.template) throw new Error('缺少 DAT 模板');
  const before = parseRows(workspace.template.original);
  const after = parseRows(exportDat(workspace.channels, workspace.template, workspace.settings));
  const plan: WritePlan = { blocks: [], channels: [], names: [], settings: 0, changedBytes: 0 };
  for (let row = 0; row < 1025; row++) {
    const old = before[row].slice(3), next = after[row].slice(3);
    if (old.every((v, i) => v === next[i])) continue;
    const channel = row < 200, name = row >= 256 && row < 456;
    const address = row * 16, fresh = snapshot.bytes.slice(address, address + 16), patched = [...fresh];
    for (let i = 0; i < 16; i++) {
      if (old[i] === next[i]) continue;
      if (((old[i] ^ next[i]) & ~editableMask(row, i, old, next)) || address + i >= CONFIG_SIZE) throw new Error(`禁止写入未确认区域 ${addressText(address + i)}`);
    }
    // Compare complete logical fields: merging individual BCD bytes can invent a frequency.
    for (const field of fields(row, old, next)) {
      const { bytes, mask } = field;
      if (bytes.every(i => (old[i] & mask) === (next[i] & mask))) continue;
      if (!bytes.every(i => (fresh[i] & mask) === (old[i] & mask)) && !bytes.every(i => (fresh[i] & mask) === (next[i] & mask))) throw new Error(`${addressText(address + bytes[0])} 数据冲突，请重新读取。`);
      for (const i of bytes) patched[i] = (fresh[i] & ~mask) | (next[i] & mask);
    }
    const changes = patched.filter((v, i) => v !== fresh[i]).length;
    if (!changes) continue;
    plan.blocks.push({ address, before: fresh, after: patched }); plan.changedBytes += changes;
    if (channel) plan.channels.push(row);
    else if (name) plan.names.push(row - 256);
    else plan.settings++;
  }
  return plan;
}

const requestedScopes = (scope: WriteScope): ('channels' | 'settings')[] => scope === 'all' ? ['channels', 'settings'] : [scope];
export function hasWriteBaseline(snapshot: RadioSnapshot | null, scope: WriteScope): boolean {
  return !!snapshot && requestedScopes(scope).every(s => !snapshot.knownScopes || snapshot.knownScopes.includes(s));
}
/** Without a device baseline, write the loaded file's allowed ranges as-is. */
export function planFileWrite(workspace: Workspace, scope: WriteScope): WritePlan {
  const rows = parseRows(exportDat(workspace.channels, workspace.template, workspace.settings));
  const plan: WritePlan = { blocks: [], channels: [], names: [], settings: 0, changedBytes: 0, mode: 'file' };
  for (let row = 0; row < CONFIG_SIZE / 16; row++) {
    const channel = row < 200, name = row >= 256 && row < 456, settings = settingsFields(row).length > 0;
    if (!(channel || name || settings) || scope === 'channels' && settings || scope === 'settings' && !settings) continue;
    const data = rows[row].slice(3);
    plan.blocks.push({ address: row * 16, before: [...data], after: [...data] });
    if (channel) plan.channels.push(row);
    else if (name) plan.names.push(row - 256);
    else plan.settings++;
  }
  return plan;
}
export function planWorkspaceWrite(snapshot: RadioSnapshot | null, workspace: Workspace, scope: WriteScope): WritePlan {
  const target = snapshot ? { ...workspace, template: parseDat(snapshotDat(snapshot), workspace.template?.fileName).template } : workspace;
  const parts = requestedScopes(scope).map(part => hasWriteBaseline(snapshot, part)
    ? scopePlan(planWrite(snapshot!, target), part) : planFileWrite(workspace, part));
  return { blocks: parts.flatMap(p => p.blocks).sort((a,b) => a.address - b.address), channels: parts.flatMap(p => p.channels), names: parts.flatMap(p => p.names),
    settings: parts.reduce((n,p) => n+p.settings,0), changedBytes: parts.reduce((n,p) => n+p.changedBytes,0), ...(parts.some(p=>p.mode==='file') ? {mode:'file' as const} : {}) };
}

export class D500Protocol {
  constructor(private link: RadioLink) {}
  async identify(signal?: AbortSignal): Promise<Uint8Array> {
    await this.link.write(HELLO, signal);
    let first: number;
    try { first = (await this.link.read(1, signal))[0]; }
    catch (error) {
      checkAbort(signal);
      throw new Error(`电台握手失败：${error instanceof Error ? error.message : String(error)}`);
    }
    if (first !== 6 && first !== 1) throw new Error(`未识别的握手响应 ${hex(Uint8Array.of(first))}；已停止通信。`);
    const identity = first === 6 ? await this.link.read(49, signal) : Uint8Array.of(first, ...await this.link.read(48, signal));
    if (identity[48] !== 0x55) throw new Error('设备识别帧不符合旧版 CPS 格式，已停止。');
    // The CPS interprets these twelve bytes as four three-digit band limits.
    const digits = [0, 1, 2, 3, 4, 5, 16, 17, 18, 19, 20, 21];
    if (digits.some(i => identity[i] > 9)) throw new Error('设备频段识别数据异常，已停止。');
    await this.link.write(Uint8Array.of(6), signal);
    const password = await this.readBlock(0x3df0, 16, signal);
    // The 2025 CPS reads this exact status without prompting for a password.
    // Accept only the observed zero-password status, not arbitrary zero-prefixed data.
    const observedUnprotected = password.every((v, i) => v === (i === 12 ? 1 : i === 15 ? 16 : 0));
    if (!password.slice(0, 6).every(v => v === 0x20) && !observedUnprotected) throw new Error('设备受密码保护或使用未知密码格式。');
    return identity;
  }
  async readBlock(address: number, length: 16 | 64, signal?: AbortSignal): Promise<Uint8Array> {
    await this.link.write(readCommand(address, length), signal);
    let marker = (await this.link.read(1, signal))[0];
    // On the tested Mac cable, 05 follows the identity ACK. The CPS purges it;
    // consume it only at this exact boundary, without discarding unknown frames.
    if (marker === 5 && address === 0x3df0) marker = (await this.link.read(1, signal))[0];
    // A single ACK before each data response is present in the real capture.
    if (marker === 6) marker = (await this.link.read(1, signal))[0];
    if (marker !== 0x58) throw new Error(`${addressText(address)} 返回了未知帧 ${hex(Uint8Array.of(marker))}，已停止。`);
    const header = await this.link.read(3, signal);
    if ((header[0] << 8 | header[1]) !== address || header[2] !== length) throw new Error(`${addressText(address)} 的响应地址或长度不匹配，已停止。`);
    const data = await this.link.read(length, signal);
    await this.link.write(Uint8Array.of(6), signal);
    return data;
  }
  async readImage(progress: Progress, signal?: AbortSignal): Promise<RadioSnapshot> {
    progress(0, CONFIG_SIZE, '识别电台');
    const identity = await this.identify(signal), bytes = new Uint8Array(CONFIG_SIZE);
    for (let address = 0; address < CONFIG_SIZE; address += 64) {
      checkAbort(signal);
      try { bytes.set(await this.readBlock(address, 64, signal), address); }
      catch (error) { checkAbort(signal); throw new Error(`读取配置 ${addressText(address)} 失败：${error instanceof Error ? error.message : String(error)}`); }
      progress(address + 64, CONFIG_SIZE, `读取配置 ${addressText(address)}`);
    }
    return { schema: 'd500-radio-read-v1', capturedAt: new Date().toISOString(), identity: [...identity], bytes: [...bytes], hardwareVerified: false, communicationProfile: 'cps-2025', source: 'radio-read' };
  }
  /** A dedicated write session follows the factory capture: password ACK, X/ACK,
   * then host ACK + X/ACK for each following block. */
  async writeBlocks(plan: WritePlan, identity: number[] | null, progress: Progress, signal?: AbortSignal): Promise<number[]> {
    validatePlan(plan);
    const actualIdentity = await this.identify(signal);
    if (identity && (identity.length !== actualIdentity.length || identity.some((v, i) => v !== actualIdentity[i]))) throw new Error('设备识别不一致，写入已取消。');
    if ((await this.link.read(1, signal))[0] !== 6) throw new Error('电台未确认写入');
    for (const [index, block] of plan.blocks.entries()) {
      checkAbort(signal);
      // A started frame completes atomically; cancellation acts between blocks.
      if (index) await this.link.write(Uint8Array.of(6));
      await this.link.write(Uint8Array.of(0x58, block.address >> 8, block.address & 255, 16, ...block.after));
      if ((await this.link.read(1))[0] !== 6) throw new Error(`写入 ${addressText(block.address)} 未获确认，请重新读取。`);
      progress(index + 1, plan.blocks.length, `写入 ${addressText(block.address)}`);
    }
    return [...actualIdentity];
  }
}
export function validatePlan(plan: WritePlan) {
  const addresses = new Set<number>();
  for (const block of plan.blocks) {
    const row = block.address / 16;
    if (!Number.isInteger(row) || row < 0 || block.address >= CONFIG_SIZE || addresses.has(block.address) || block.before.length !== 16 || block.after.length !== 16 ||
      [...block.before, ...block.after].some(v => !Number.isInteger(v) || v < 0 || v > 255) ||
      !Array.from({ length: 16 }, (_, i) => i).some(i => editableByte(row, i)) ||
      block.after.some((v, i) => ((v ^ block.before[i]) & ~editableMask(row, i, block.before, block.after)) !== 0)) throw new Error('写入计划无效或包含未确认区域');
    addresses.add(block.address);
  }
}
export type WriteScope = 'all' | 'channels' | 'settings';
export function scopePlan(plan: WritePlan, scope: WriteScope): WritePlan {
  const blocks = plan.blocks.filter(b => scope === 'all' || (b.address < 3200 || b.address >= 4096) === (scope === 'channels'));
  return { blocks, channels: plan.channels.filter(c => blocks.some(b => b.address === c * 16)), names: plan.names.filter(c => blocks.some(b => b.address === (256 + c) * 16)), settings: blocks.filter(b => b.address >= 3200 && b.address < 4096).length, changedBytes: blocks.reduce((n, b) => n + b.after.filter((v, i) => v !== b.before[i]).length, 0), ...(plan.mode ? { mode: plan.mode } : {}) };
}
export type SessionFactory = () => Promise<RadioLink & { close(): Promise<void> }>;
/** Direct file / delta write. No automatic configuration read or readback. */
export async function programWorkspace(open: SessionFactory, workspace: Workspace, input: { snapshot: RadioSnapshot | null; plan: WritePlan; identity?: number[] | null }, scope: WriteScope, backup: (snapshot: RadioSnapshot) => Promise<void>, progress: Progress, signal?: AbortSignal): Promise<RadioSnapshot> {
  const { snapshot: before, plan: reviewed } = input;
  if (before) validSnapshot(before);
  validatePlan(reviewed);
  if (!reviewed.blocks.length) throw new Error('没有需要写入的修改。');
  const fresh = planWorkspaceWrite(before, workspace, scope);
  if (fresh.mode !== reviewed.mode || JSON.stringify(fresh.blocks) !== JSON.stringify(reviewed.blocks)) throw new Error('方案已变化，请重试。');
  // Preserve the last actual read. Acknowledged expected bytes are not a read backup.
  if (before && before.source !== 'write-ack') await backup(before);
  checkAbort(signal); progress(0, 1, '连接电台');
  const link = await open(); let writingStarted = false; let identity: number[];
  try {
    writingStarted = true;
    identity = await new D500Protocol(link).writeBlocks(fresh, before?.identity ?? input.identity ?? null, progress, signal);
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}${writingStarted ? ' 写入未完成，请重新读取。' : ''}`);
  } finally { await link.close(); }
  const expected = before ? [...before.bytes] : parseRows(exportDat(workspace.channels, workspace.template, workspace.settings)).slice(0, CONFIG_SIZE / 16).flatMap(r => r.slice(3));
  for (const block of fresh.blocks) expected.splice(block.address, 16, ...block.after);
  progress(1, 1, '写入完成');
  const knownScopes = [...new Set([...(before ? before.knownScopes ?? ['channels', 'settings'] as const : []), ...requestedScopes(scope)])];
  return { schema: 'd500-radio-read-v1', capturedAt: new Date().toISOString(), bytes: expected, identity, source: 'write-ack', hardwareVerified: false, communicationProfile: 'cps-2025', knownScopes };
}

export interface WriteChange { target: string; field: string; before: string; after: string }
export function describeWrite(snapshot: RadioSnapshot, plan: WritePlan): WriteChange[] {
  const next = { ...snapshot, bytes: [...snapshot.bytes] };
  for (const block of plan.blocks) next.bytes.splice(block.address, 16, ...block.after);
  const before = parseDat(snapshotDat(snapshot)), after = parseDat(snapshotDat(next)), changes: WriteChange[] = [];
  const add = (target: string, field: string, a: string, b: string) => { if (a !== b) changes.push({ target, field, before: a || '关闭 / 空', after: b || '关闭 / 空' }); };
  const labels: Partial<Record<keyof Channel, string>> = { name: '名称', rx: '接收频率', tx: '发射频率', rxTone: '接收哑音', txTone: '发射哑音', power: '功率', bandwidth: '带宽', busy: '繁忙禁发', scanAdd: '扫描添加', pttId: 'PTT-ID', signalCode: '信令码组', optionalSignal: '可选信令', muteMode: '静音方式', scramble: '扰频' };
  const channelValue = (c: Channel, key: keyof Channel) => {
    const v = c[key];
    if (typeof v === 'boolean') return v ? '开启' : '关闭';
    if (key === 'bandwidth') return v === 'wide' ? '宽带' : '窄带';
    if (key === 'power') return POWER_LABEL[String(v)] ?? String(v);
    if (key === 'signalCode') return String(Number(v) + 1);
    if (key === 'pttId') return PTT_OPTIONS[Number(v)] ?? String(v);
    if (key === 'optionalSignal') return SIGNAL_OPTIONS[Number(v)] ?? String(v);
    if (key === 'muteMode') return MUTE_OPTIONS[Number(v)] ?? String(v);
    if (key === 'rx' || key === 'tx') return v ? `${v} MHz` : '仅接收';
    return String(v ?? '');
  };
  for (const slot of [...new Set([...plan.channels, ...plan.names])].sort((a, b) => a - b)) {
    const a = before.channels.find(c => c.slot === slot), b = after.channels.find(c => c.slot === slot), target = `信道 ${slotLabel(slot)}`;
    if (!a || !b) { add(target, b ? '新增信道' : '删除信道', a ? `${a.name} ${a.rx} MHz` : '空闲', b ? `${b.name} ${b.rx} MHz` : '空闲'); continue; }
    for (const key of Object.keys(labels) as (keyof Channel)[]) add(target, labels[key]!, channelValue(a, key), channelValue(b, key));
  }
  for (const d of MENU_SETTINGS) add('整机设置', d.label, d.options[before.settings.menu[d.key]] ?? `原值 ${before.settings.menu[d.key]}`, d.options[after.settings.menu[d.key]] ?? `原值 ${after.settings.menu[d.key]}`);
  for (let b = 0; b < 4; b++) {
    const target = `${'ABCD'[b]} 区`, a = before.settings.vfo[b], z = after.settings.vfo[b];
    for (const d of VFO_SETTINGS) add(target, d.label, d.options[a[d.key]] ?? `原值 ${a[d.key]}`, d.options[z[d.key]] ?? `原值 ${z[d.key]}`);
    for (const key of ['frequency', 'offset', 'rxTone', 'txTone']) {
      const label = { frequency: '频率', offset: '频差', rxTone: '接收哑音', txTone: '发射哑音' }[key]!;
      const format = (v: number) => key.includes('Tone') ? decodeTone(v) : v < 0 ? '保留原值' : `${(v / (key === 'frequency' ? 100000 : 1000)).toFixed(key === 'frequency' ? 5 : 3)} MHz`;
      add(target, label, format(a[key]), format(z[key]));
    }
  }
  add('开机显示', '文字', before.settings.text?.boot ?? '', after.settings.text?.boot ?? '');
  return changes;
}
