/** Experimental D500 V1 protocol reconstructed from the pinned native CPS.
 * See docs/SERIAL_PROTOCOL.md. Mock tests are not hardware validation.
 */
import { exportDat, parseRows } from './dat';
import type { Workspace } from './model';
import { MENU_SETTINGS, VFO_SETTINGS } from './settings';
import { checkAbort, hex, type RadioLink } from './serial';

export const HARDWARE_WRITE_VERIFIED = false;
export const CONFIG_SIZE = 0x3200;
export const HELLO = Uint8Array.of(0x55, 0x20, 0x21, 0x01, 0x23, 0xff, 0xdc, 0x02);
export interface RadioSnapshot {
  schema: 'd500-radio-read-v1';
  capturedAt: string;
  identity: number[];
  bytes: number[];
  hardwareVerified: false;
}
export type Progress = (done: number, total: number, label: string) => void;
export interface WriteBlock { address: number; before: number[]; after: number[] }
export interface WritePlan { blocks: WriteBlock[]; channels: number[]; names: number[]; settings: number; changedBytes: number }
const addressText = (address: number) => `0x${address.toString(16).padStart(4, '0').toUpperCase()}`;
function editableByte(row: number, byte: number) {
  return row >= 0 && row < 200 || row >= 256 && row < 456 ||
    MENU_SETTINGS.some(d => row === 224 + Math.floor(Number(d.key) / 16) && byte === Number(d.key) % 16) ||
    [241, 243, 245, 247].includes(row) && VFO_SETTINGS.some(d => d.byte === byte);
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
  return Array.from({ length: 16 }, (_, i) => span(i, 1)).filter(field => editableByte(row, field.bytes[0]));
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
  if (!workspace.template) throw new Error('请先读取电台或导入本机 DAT 模板。');
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
      if (!bytes.every(i => (fresh[i] & mask) === (old[i] & mask)) && !bytes.every(i => (fresh[i] & mask) === (next[i] & mask))) throw new Error(`${addressText(address + bytes[0])} 与 DAT 模板冲突，请重新读取并合并方案。`);
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

export class D500Protocol {
  constructor(private link: RadioLink) {}
  async identify(signal?: AbortSignal): Promise<Uint8Array> {
    await this.link.write(HELLO, signal);
    const first = (await this.link.read(1, signal))[0];
    if (first !== 6 && first !== 1) throw new Error(`未识别的握手响应 ${hex(Uint8Array.of(first))}；已停止通信。`);
    const identity = first === 6 ? await this.link.read(49, signal) : Uint8Array.of(first, ...await this.link.read(48, signal));
    if (identity[48] !== 0x55) throw new Error('设备识别帧不符合旧版 CPS 格式，已停止。');
    // The CPS interprets these twelve bytes as four three-digit band limits.
    const digits = [0, 1, 2, 3, 4, 5, 16, 17, 18, 19, 20, 21];
    if (digits.some(i => identity[i] > 9)) throw new Error('设备频段识别数据异常，已停止。');
    await this.link.write(Uint8Array.of(6), signal);
    const password = await this.readBlock(0x3df0, 16, signal);
    if (!password.slice(0, 6).every(v => v === 0x20)) throw new Error('设备可能设置了读写密码；请使用原厂软件处理后再试。');
    return identity;
  }
  async readBlock(address: number, length: 16 | 64, signal?: AbortSignal): Promise<Uint8Array> {
    await this.link.write(readCommand(address, length), signal);
    let marker = (await this.link.read(1, signal))[0];
    // Native CPS searches for X near the frame start; accept a single ACK prefix only.
    if (marker === 6) marker = (await this.link.read(1, signal))[0];
    if (marker !== 0x58) throw new Error(`${addressText(address)} 返回了未知帧 ${hex(Uint8Array.of(marker))}，已停止。`);
    const header = await this.link.read(3, signal);
    if ((header[0] << 8 | header[1]) !== address || header[2] !== length) throw new Error(`${addressText(address)} 的响应地址或长度不匹配，已停止。`);
    const data = await this.link.read(length, signal);
    await this.link.write(Uint8Array.of(6), signal);
    return data;
  }
  async readImage(progress: Progress, signal?: AbortSignal): Promise<RadioSnapshot> {
    progress(0, CONFIG_SIZE, '识别旧版 D500');
    const identity = await this.identify(signal), bytes = new Uint8Array(CONFIG_SIZE);
    for (let address = 0; address < CONFIG_SIZE; address += 64) {
      checkAbort(signal);
      bytes.set(await this.readBlock(address, 64, signal), address);
      progress(address + 64, CONFIG_SIZE, `读取配置 ${addressText(address)}`);
    }
    return { schema: 'd500-radio-read-v1', capturedAt: new Date().toISOString(), identity: [...identity], bytes: [...bytes], hardwareVerified: false };
  }
  /** Internal candidate only. Production UI never invokes X until hardware validation.
   * Fresh preflight + durable backup must succeed before the first write command.
   * No retry after an uncertain ACK; a partial write requires a new read.
   */
  async writeCandidate(plan: WritePlan, backup: (snapshot: RadioSnapshot) => Promise<void>, progress: Progress, signal?: AbortSignal) {
    const addresses = new Set<number>();
    for (const block of plan.blocks) {
      const row = block.address / 16;
      if (!Number.isInteger(row) || row < 0 || block.address >= CONFIG_SIZE || addresses.has(block.address) || block.before.length !== 16 || block.after.length !== 16 ||
        [...block.before, ...block.after].some(v => !Number.isInteger(v) || v < 0 || v > 255) ||
        !Array.from({ length: 16 }, (_, i) => i).some(i => editableByte(row, i)) ||
        block.after.some((v, i) => ((v ^ block.before[i]) & ~editableMask(row, i, block.before, block.after)) !== 0)) throw new Error('写入计划无效或包含未确认区域');
      addresses.add(block.address);
    }
    const fresh = await this.readImage(progress, signal);
    for (const block of plan.blocks) if (block.before.some((v, i) => v !== fresh.bytes[block.address + i])) throw new Error('电台内容已变化，已取消写入。请重新读取。');
    await backup(fresh); checkAbort(signal);
    for (const [index, block] of plan.blocks.entries()) {
      checkAbort(signal);
      // Cancellation takes effect between blocks, not halfway through a write frame.
      await this.link.write(Uint8Array.of(0x58, block.address >> 8, block.address & 255, 16, ...block.after));
      if ((await this.link.read(1))[0] !== 6) throw new Error(`写入 ${addressText(block.address)} 未获确认；停止后续写入，请重新读取检查。`);
      const actual = await this.readBlock(block.address, 16);
      if (block.after.some((v, i) => actual[i] !== v)) throw new Error(`${addressText(block.address)} 写后回读不一致；已停止，请重新读取检查。`);
      progress(index + 1, plan.blocks.length, `已回读核对 ${addressText(block.address)}`);
    }
  }
}
