import { type Channel, type Workspace, type Power } from './model';
import { parseDat } from './dat';
const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
export function parseProject(text: string): Workspace {
  if (text.length > 4_000_000) throw new Error('方案文件过大。');
  const data: unknown = JSON.parse(text);
  if (!obj(data) || data.schema !== 1 || typeof data.name !== 'string' || !Array.isArray(data.channels) || data.channels.length > 200) throw new Error('不是有效的 D500 Workbench 方案。');
  const channels: Channel[] = data.channels.map((c: unknown) => {
    if (!obj(c) || !Number.isInteger(c.slot) || Number(c.slot) < 0 || Number(c.slot) > 199 || !['wide', 'narrow'].includes(String(c.bandwidth)) || typeof c.busy !== 'boolean') throw new Error('方案中的信道字段无效。');
    for (const f of ['name', 'rx', 'tx', 'rxTone', 'txTone', 'power', 'group', 'note']) if (typeof c[f] !== 'string' || c[f].length > 2000) throw new Error('方案中的文字字段无效。');
    if (c.sourceSlot !== undefined && (!Number.isInteger(c.sourceSlot) || Number(c.sourceSlot) < 0 || Number(c.sourceSlot) > 199)) throw new Error('方案中的原始信道地址无效。');
    return { slot: Number(c.slot), ...(c.sourceSlot === undefined ? {} : { sourceSlot: Number(c.sourceSlot) }), name: String(c.name), rx: String(c.rx), tx: String(c.tx), rxTone: String(c.rxTone), txTone: String(c.txTone), power: c.power as Power, bandwidth: c.bandwidth as 'wide' | 'narrow', busy: c.busy, group: String(c.group), note: String(c.note) };
  });
  if (new Set(channels.map(c => c.slot)).size !== channels.length) throw new Error('方案中存在重复信道编号。');
  let template = null;
  if (data.template !== null && data.template !== undefined) {
    if (!obj(data.template) || typeof data.template.original !== 'string') throw new Error('方案中的 DAT 模板无效。');
    template = parseDat(data.template.original, typeof data.template.fileName === 'string' ? data.template.fileName : 'D500.dat').template;
  }
  return { schema: 1, name: data.name.slice(0, 200), channels, template, updatedAt: new Date().toISOString() };
}
export function download(data: string | Uint8Array, name: string, mime = 'application/octet-stream'): void {
  const blob = new Blob([typeof data === 'string' ? data : new Uint8Array(data)], { type: mime });
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
  a.style.display = 'none'; document.body.appendChild(a); a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 10000);
}
