import { type Channel, type Workspace, type Power, newChannel } from './model';
import { parseDat } from './dat';
import { MENU_SETTINGS, VFO_SETTINGS, VFO_NUMERIC, completeSettings, validateSettings } from './settings';
const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
export function parseProject(text: string): Workspace {
  if (text.length > 4_000_000) throw new Error('方案文件过大。');
  const data: unknown = JSON.parse(text);
  if (!obj(data) || ![1, 2].includes(Number(data.schema)) || typeof data.name !== 'string' || !Array.isArray(data.channels) || data.channels.length > 200) throw new Error('不是有效的 D500 Workbench 方案。');
  let template = null;
  let settings;
  if (data.template !== null && data.template !== undefined) {
    if (!obj(data.template) || typeof data.template.original !== 'string') throw new Error('方案中的 DAT 模板无效。');
    const parsed = parseDat(data.template.original, typeof data.template.fileName === 'string' ? data.template.fileName : 'D500.dat');
    template = parsed.template;
    settings = parsed.settings;
    if (data.settings !== undefined) {
      if (!obj(data.settings) || !obj(data.settings.menu) || !Array.isArray(data.settings.vfo) || data.settings.vfo.length !== 4) throw new Error('方案中的电台设置无效。');
      const menu = data.settings.menu, vfo = data.settings.vfo;
      const restored = completeSettings({
        menu: Object.fromEntries(MENU_SETTINGS.map(d => [d.key, menu[d.key] === undefined ? settings!.menu[d.key] : Number(menu[d.key])])),
        vfo: vfo.map((v, b) => { if (!obj(v)) throw new Error('方案中的频率模式设置无效。'); return Object.fromEntries([...VFO_SETTINGS.map(d => d.key), ...VFO_NUMERIC].map(key => [key, v[key] === undefined ? settings!.vfo[b][key] : Number(v[key])])); }),
        text: obj(data.settings.text) && typeof data.settings.text.boot === 'string' ? { boot: data.settings.text.boot } : settings.text,
      }, settings);
      if (validateSettings(restored, settings).length) throw new Error('方案中的电台设置超出允许范围。');
      settings = restored;
    }
  }
  const channels: Channel[] = data.channels.map((c: unknown) => {
    if (!obj(c) || !Number.isInteger(c.slot) || Number(c.slot) < 0 || Number(c.slot) > 199 || !['wide', 'narrow'].includes(String(c.bandwidth)) || typeof c.busy !== 'boolean') throw new Error('方案中的信道字段无效。');
    for (const f of ['name', 'rx', 'tx', 'rxTone', 'txTone', 'power', 'group', 'note']) if (typeof c[f] !== 'string' || c[f].length > 2000) throw new Error('方案中的文字字段无效。');
    if (c.sourceSlot !== undefined && (!Number.isInteger(c.sourceSlot) || Number(c.sourceSlot) < 0 || Number(c.sourceSlot) > 199)) throw new Error('方案中的原始信道地址无效。');
    const origin = template?.originalChannels.find(v => v.slot === Number(c.sourceSlot ?? c.slot));
    let power = c.power as Power;
    if (data.schema === 1) {
      const originalByte = template?.rows[Number(c.sourceSlot ?? c.slot)]?.[17];
      if (origin && power === (['high', 'mid', 'low'][originalByte ?? -1] ?? `raw:${originalByte}`)) power = origin.power;
      else if (String(power) === 'mid') power = 'low';
    }
    const advanced = Object.fromEntries(['scanAdd', 'pttId', 'signalCode', 'optionalSignal', 'muteMode', 'scramble'].map(f => [f, c[f] ?? (origin ?? newChannel(Number(c.slot)))[f as keyof Channel]]));
    for (const f of ['scanAdd', 'scramble']) if (typeof advanced[f] !== 'boolean') throw new Error('方案中的开关字段无效。');
    for (const f of ['pttId', 'signalCode', 'optionalSignal', 'muteMode']) if (!Number.isInteger(advanced[f]) || Number(advanced[f]) < 0 || Number(advanced[f]) > (f === 'pttId' ? 3 : 15)) throw new Error('方案中的信令字段无效。');
    return { ...newChannel(Number(c.slot)), ...advanced, slot: Number(c.slot), ...(c.sourceSlot === undefined ? {} : { sourceSlot: Number(c.sourceSlot) }), name: String(c.name), rx: String(c.rx), tx: String(c.tx), rxTone: String(c.rxTone), txTone: String(c.txTone), power, bandwidth: c.bandwidth as 'wide' | 'narrow', busy: c.busy, group: String(c.group), note: String(c.note) };
  });
  if (new Set(channels.map(c => c.slot)).size !== channels.length) throw new Error('方案中存在重复信道编号。');
  return { schema: 2, name: data.name.slice(0, 200), channels, template, ...(settings ? { settings } : {}), updatedAt: new Date().toISOString() };
}
export function download(data: string | Uint8Array, name: string, mime = 'application/octet-stream'): void {
  const blob = new Blob([typeof data === 'string' ? data : new Uint8Array(data)], { type: mime });
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
  a.style.display = 'none'; document.body.appendChild(a); a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 10000);
}
