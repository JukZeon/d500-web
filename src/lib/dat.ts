/** DAT field layout ported from Liuli-Lumine/K1toD500, GPL-3.0.
 * Upstream e65cbb309986f0f37babaae7fac77f9fd21b5ab1; see THIRD_PARTY.md.
 * This implementation preserves the imported template and untouched bytes.
 */
import { decodeName, encodeName } from './encoding';
import { type Channel, type DatTemplate, type Issue, type Power, type RadioSettings, newChannel, slotLabel } from './model';
import { readSettings, settingsChanges, writeSettings } from './settings';

export { DCS_CODES, CTCSS, encodeTone, decodeTone } from './tone';
import { encodeTone, decodeTone } from './tone';
const sameRadioFields = (a: Channel, b: Channel) => ['name', 'rx', 'tx', 'rxTone', 'txTone', 'power', 'bandwidth', 'busy', 'scanAdd', 'pttId', 'signalCode', 'optionalSignal', 'muteMode', 'scramble'].every(k => a[k as keyof Channel] === b[k as keyof Channel]);
export function parseRows(text: string): number[][] {
  if (text.length > 2_000_000) throw new Error('DAT 文件超过 2 MB，请确认选择的是 D500 写频文件。');
  const lines = text.replace(/^\uFEFF/, '').split(/\r\n|\n|\r/).filter(l => l.trim());
  if (lines.length !== 1025) throw new Error(`DAT 有 ${lines.length} 行；当前支持 D500 的 1025 行文本格式，未修改此文件。`);
  return lines.map((line, i) => {
    const parts = line.trim().split(/\s+/);
    if (parts.length !== 19 || parts.some(v => !/^\d+$/.test(v))) throw new Error(`DAT 第 ${i + 1} 行应为 19 个十进制整数字段。`);
    const row = parts.map(Number);
    if (row[0] !== Math.floor(i / 16) || row[1] !== i % 16 || row[2] !== i) throw new Error(`DAT 第 ${i + 1} 行地址不连续，无法安全解析。`);
    if (row.slice(3).some(n => n > 255)) throw new Error(`DAT 第 ${i + 1} 行包含超出字节范围的数据。`);
    return row;
  });
}
export function encodeFrequency(value: string): number[] {
  if (!/^\d{1,3}(?:\.\d{1,5})?$/.test(value.trim())) throw new Error('频率需为 MHz 数值，最多 5 位小数（10 Hz 精度）');
  const n = Math.round(Number(value) * 100000);
  if (n <= 0 || n > 99999999) throw new Error('频率超出可编码范围');
  return n.toString().padStart(8, '0').match(/../g)!.map(pair => parseInt(pair, 16)).reverse();
}
export function decodeFrequency(bytes: number[]): string {
  if (bytes.every(v => v === 255)) return '';
  if (bytes.some(v => (v >> 4) > 9 || (v & 15) > 9)) throw new Error('频率含非 BCD 数据');
  const str = [...bytes].reverse().map(v => v.toString(16).padStart(2, '0')).join('');
  const n = Number(str) / 100000;
  if (!n) throw new Error('频率为零');
  return n.toFixed(5);
}
export function parseDat(text: string, fileName = 'D500.dat'): { channels: Channel[]; template: DatTemplate; settings: RadioSettings; warnings: string[] } {
  const rows = parseRows(text);
  const channels: Channel[] = [];
  const warnings: string[] = [];
  for (let slot = 0; slot < 200; slot++) {
    const p = rows[slot].slice(3);
    if (p.every(v => v === 255)) continue;
    try {
      const rx = decodeFrequency(p.slice(0, 4));
      if (!rx) throw new Error('接收频率为空');
      const tx = decodeFrequency(p.slice(4, 8));
      let name = '';
      try { name = decodeName(rows[256 + slot].slice(3)); }
      catch { warnings.push(`信道 ${slotLabel(slot)} 名称不能按 GBK 解码；未编辑时保留原始名称字节。`); }
      const power: Power = (['high', 'low'] as const)[p[14] & 3] ?? `raw:${p[14] & 3}`;
      channels.push({ ...newChannel(slot), sourceSlot: slot, name, rx, tx, rxTone: decodeTone(p[8] | p[9] << 8), txTone: decodeTone(p[10] | p[11] << 8), power, bandwidth: p[15] & 64 ? 'narrow' : 'wide', busy: !!(p[15] & 8), scanAdd: !!(p[15] & 4), pttId: p[15] & 3, signalCode: p[12] & 15, optionalSignal: p[13] & 15, muteMode: p[13] >> 4, scramble: !!(p[14] & 16) });
    } catch (e) {
      // Do not silently drop a record and then clear it on export.
      throw new Error(`信道 ${slotLabel(slot)} 无法解析：${e instanceof Error ? e.message : String(e)}。已停止导入，原文件保持不变。`);
    }
  }
  return { channels, template: { rows, original: text, originalChannels: structuredClone(channels), fileName }, settings: readSettings(rows), warnings };
}
export function validateChannels(channels: Channel[], originalChannels?: Channel[]): Issue[] {
  const issues: Issue[] = [];
  const originals = new Map((originalChannels ?? []).map(c => [c.slot, c]));
  const slots = new Set<number>();
  for (const c of channels) {
    const add = (field: string, message: string, severity: 'error' | 'warning' = 'error') => issues.push({ slot: c.slot, field, message, severity });
    if (!Number.isInteger(c.slot) || c.slot < 0 || c.slot > 199) add('slot', '信道编号必须在 000–199 之间');
    if (slots.has(c.slot)) add('slot', '信道编号重复');
    slots.add(c.slot);
    try {
      const length = encodeName(c.name).length;
      const before = originals.get(c.sourceSlot ?? c.slot);
      if (length > 8 && before?.name !== c.name) add('name', `名称占 ${length} 字节；已验证的 V1 原厂保存逻辑最多支持 8 字节（常用汉字 4 个），请缩短后导出 DAT`, originalChannels ? 'error' : 'warning');
    } catch (e) { add('name', (e as Error).message); }
    for (const f of ['rx', 'tx'] as const) {
      if (f === 'tx' && c.tx === '') continue;
      try { encodeFrequency(c[f]); } catch (e) { add(f, (e as Error).message); }
    }
    for (const f of ['rxTone', 'txTone'] as const) try { encodeTone(c[f]); } catch (e) { add(f, (e as Error).message); }
    if (!['high', 'low'].includes(c.power) && (!/^raw:[0-3]$/.test(c.power))) add('power', '旧版 D500 仅支持高、低两档功率');
    for (const field of ['pttId', 'signalCode', 'optionalSignal', 'muteMode'] as const) if (!Number.isInteger(c[field]) || c[field] < 0 || c[field] > (field === 'pttId' ? 3 : 15)) add(field, '信令参数无效');
    for (const field of ['busy', 'scanAdd', 'scramble'] as const) if (typeof c[field] !== 'boolean') add(field, '开关参数无效');
    if (c.sourceSlot !== undefined && (!Number.isInteger(c.sourceSlot) || c.sourceSlot < 0 || c.sourceSlot > 199)) add('slot', '原始信道地址无效');
    if (c.bandwidth !== 'wide' && c.bandwidth !== 'narrow') add('bandwidth', '带宽值无效');
  }
  return issues;
}
export function exportDat(channels: Channel[], template: DatTemplate | null, settings?: RadioSettings): string {
  if (!template) throw new Error('请先导入本机原厂软件导出的 DAT，作为导出模板。这样可以保留旧版机器的其他设置。');
  const parsed = parseDat(template.original);
  const issues = validateChannels(channels, parsed.channels).filter(i => i.severity === 'error');
  if (issues.length) throw new Error(`信道 ${slotLabel(issues[0].slot)}：${issues[0].message}`);
  // Revalidate saved project metadata before trusting the stored template.
  const rows = parseRows(template.original);
  const original = new Map(parsed.channels.map(c => [c.slot, c]));
  const current = new Map(channels.map(c => [c.slot, c]));
  if (settings) writeSettings(rows, settings, parsed.settings);
  if (!settingsChanges(settings, parsed.settings) && current.size === original.size && channels.every(c => (c.sourceSlot === undefined || c.sourceSlot === c.slot) && original.has(c.slot) && sameRadioFields(c, original.get(c.slot)!))) return template.original;
  for (let slot = 0; slot < 200; slot++) {
    const c = current.get(slot);
    const origin = c?.sourceSlot ?? slot;
    const before = original.get(origin);
    if (!c) {
      if (original.has(slot)) { rows[slot].fill(255, 3); rows[256 + slot].fill(255, 3); }
      continue;
    }
    const p = before ? parsed.template.rows[origin].slice(3) : [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 68];
    if (!before || c.rx !== before.rx) p.splice(0, 4, ...encodeFrequency(c.rx));
    if (!before || c.tx !== before.tx) p.splice(4, 4, ...(c.tx ? encodeFrequency(c.tx) : [255, 255, 255, 255]));
    for (const [field, offset] of [['rxTone', 8], ['txTone', 10]] as const) if (!before || c[field] !== before[field]) {
      const v = encodeTone(c[field]); p[offset] = v & 255; p[offset + 1] = v >> 8;
    }
    if (!before || c.power !== before.power) p[14] = p[14] & ~3 | (c.power.startsWith('raw:') ? Number(c.power.slice(4)) : ['high', 'low'].indexOf(c.power));
    if (!before || c.bandwidth !== before.bandwidth) p[15] = p[15] & ~64 | (c.bandwidth === 'narrow' ? 64 : 0);
    if (!before || c.busy !== before.busy) p[15] = p[15] & ~8 | (c.busy ? 8 : 0);
    if (!before || c.scanAdd !== before.scanAdd) p[15] = p[15] & ~4 | (c.scanAdd ? 4 : 0);
    if (!before || c.pttId !== before.pttId) p[15] = p[15] & ~3 | c.pttId;
    if (!before || c.signalCode !== before.signalCode) p[12] = p[12] & ~15 | c.signalCode;
    if (!before || c.optionalSignal !== before.optionalSignal) p[13] = p[13] & ~15 | c.optionalSignal;
    if (!before || c.muteMode !== before.muteMode) p[13] = p[13] & 15 | c.muteMode << 4;
    if (!before || c.scramble !== before.scramble) p[14] = p[14] & ~16 | (c.scramble ? 16 : 0);
    rows[slot].splice(3, 16, ...p);
    if (before && origin !== slot && c.name === before.name) rows[256 + slot].splice(3, 16, ...parsed.template.rows[256 + origin].slice(3));
    if (!before || c.name !== before.name) {
      const bytes = encodeName(c.name); rows[256 + slot].splice(3, 16, ...Array.from({ length: 16 }, (_, i) => bytes[i] ?? 255));
    }
  }
  return rows.map(r => r.map(n => ` ${n} `).join('')).join('\r\n') + '\r\n';
}
