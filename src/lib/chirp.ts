import * as XLSX from 'xlsx';
import { readSpreadsheet } from './sheet-input';
import { encodeName } from './encoding';
import type { Channel } from './model';

export const RADIO_MODELS = [
  { id: 'd500', label: '即时通 D500', variant: '原版', note: '网页直连' },
  { id: 'uv5r', label: '宝锋 UV-5R', variant: '原厂', note: '128 信道 · 7 位英文名称' },
  { id: 'uv5rh', label: '宝锋 UV-5RH', variant: '普通版', note: '1000 信道 · 多频段' },
  { id: 'uvk5-losehu', label: '泉盛 UV-K5 / K6', variant: 'LOSEHU', note: '按固件适配名称与读写' },
  { id: 'uvk5-stock', label: '泉盛 UV-K5 / K6', variant: '原厂', note: '200 信道 · 原厂固件' },
  { id: 'uvk5-egzumer', label: '泉盛 UV-K5 / K6', variant: 'Egzumer', note: '200 信道 · Egzumer 固件' },
] as const;
export type RadioModel = typeof RADIO_MODELS[number]['id'];
export type ChirpModel = Exclude<RadioModel, 'd500'>;
export interface SettingValue { type: 'list' | 'boolean' | 'number' | 'string'; value: string | number | boolean; mutable: boolean; options?: string[]; min?: number; max?: number; step?: number }
export interface SettingNode { key: string; label: string; doc?: string; children?: SettingNode[]; values?: SettingValue[] }
export type SettingEdits = Record<string, (string | number | boolean)[]>;
export interface ChirpChannel {
  number: number; name: string; rx: string; tx: string; rxTone: string; txTone: string;
  mode: string; power: string; skip: string; step: number; comment: string; extra: SettingNode[];
  empty?: boolean; extraEdits?: SettingEdits;
  group?: string;
  libraryId?: string;
}
export interface ChirpFeatures { nameBytes?: number; nameEncoding?: 'gbk' | 'gb2312' | 'ascii' | 'losehu117'; bounds: [number, number]; nameLength: number; characters: string; modes: string[]; bands: [number, number][]; powers: string[]; steps: number[]; skips: string[]; tones: number[]; dtcs: number[]; hasSettings: boolean; hasStep: boolean }
export interface ChirpDocument { schema: 'radio-workbench-chirp-v1'; model: ChirpModel; driverRevision: string; features: ChirpFeatures; channels: ChirpChannel[]; settings: SettingNode[]; image: string; firmware: string; settingsLimited: boolean; settingsCoverage?: 'basic' | 'channels' | 'driver' }
export interface ChirpDraft { document: ChirpDocument; channels: ChirpChannel[]; settings: SettingEdits; name: string }
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
function validNodes(value: unknown, depth = 0): boolean {
  return depth < 16 && Array.isArray(value) && value.length <= 1000 && value.every(n => object(n) && typeof n.key === 'string' && typeof n.label === 'string' &&
    (n.children !== undefined ? validNodes(n.children, depth + 1) : Array.isArray(n.values) && n.values.length <= 16 && n.values.every(v => object(v) && ['list','boolean','number','string'].includes(String(v.type)) && typeof v.mutable === 'boolean' && ['string','number','boolean'].includes(typeof v.value) && (v.options === undefined || Array.isArray(v.options) && v.options.length <= 2000 && v.options.every(s => typeof s === 'string')))));
}
export function isChirpDocument(value: unknown): value is ChirpDocument {
  if (!object(value) || value.schema !== 'radio-workbench-chirp-v1' || !RADIO_MODELS.some(m => m.id === value.model && m.id !== 'd500') || typeof value.image !== 'string' || value.image.length > 900_000 || !object(value.features) || !Array.isArray(value.channels) || value.channels.length > 1000 || !validNodes(value.settings) || typeof value.firmware !== 'string' || typeof value.settingsLimited !== 'boolean') return false;
  const f = value.features;
  return Array.isArray(f.bounds) && f.bounds.length === 2 && f.bounds.every(Number.isInteger) && Number(f.bounds[0]) >= 0 && Number(f.bounds[0]) <= Number(f.bounds[1]) && Number(f.bounds[1]) <= 1000 &&
    ['modes', 'powers', 'steps', 'skips', 'tones', 'dtcs', 'bands'].every(k => Array.isArray(f[k])) && typeof f.nameLength === 'number' && typeof f.characters === 'string' && typeof f.hasStep === 'boolean' && ['modes','powers','skips'].every(k => (f[k] as unknown[]).every(v => typeof v === 'string')) &&
    value.channels.every(c => object(c) && Number.isInteger(c.number) && ['name','rx','tx','rxTone','txTone','mode','power','skip','comment'].every(k => typeof c[k] === 'string') && typeof c.step === 'number' && validNodes(c.extra) && (c.empty === undefined || typeof c.empty === 'boolean') && (c.group === undefined || typeof c.group === 'string' && c.group.length <= 2000) && (c.libraryId === undefined || typeof c.libraryId === 'string' && c.libraryId.length <= 100));
}
export function parseChirpDraft(text: string, model: ChirpModel): ChirpDraft {
  const v: unknown = JSON.parse(text);
  if (!object(v) || !isChirpDocument(v.document) || v.document.model !== model || !Array.isArray(v.channels) || v.channels.length > 1000 || !object(v.settings) || typeof v.name !== 'string') throw new Error('方案型号／固件不匹配');
  if (!isChirpDocument({ ...v.document, channels: v.channels })) throw new Error('方案信道无效');
  return v as unknown as ChirpDraft;
}
export function makeChirpChannel(number: number, f: ChirpFeatures): ChirpChannel {
  return { number, name: '', rx: '438.500000', tx: '438.500000', rxTone: '', txTone: '', mode: f.modes.includes('NFM') ? 'NFM' : f.modes[0], power: f.powers[0] ?? '', skip: '', step: f.steps[0] ?? 5, comment: '', extra: [] };
}
export function fromD500(channels: Channel[], f: ChirpFeatures): ChirpChannel[] {
  const shift = channels.some(c => c.slot === 0) && f.bounds[0] === 1 ? 1 : 0;
  return channels.map(c => ({ ...makeChirpChannel(c.slot + shift, f), name: c.name, rx: c.rx, tx: c.tx,
    rxTone: c.rxTone.replace(/I$/, 'R'), txTone: c.txTone.replace(/I$/, 'R'),
    mode: c.bandwidth === 'narrow' ? 'NFM' : 'FM', power: f.powers.find(p => p.toLowerCase() === c.power) ?? f.powers[0],
    skip: c.scanAdd ? '' : f.skips.includes('S') ? 'S' : '', comment: [c.group, c.note].filter(Boolean).join(' / ') }));
}
export function channelNameIssues(name:string,f:ChirpFeatures):string[] {
  const issues:string[]=[];
  if(name.length>f.nameLength||[...name].some(char=>!f.characters.includes(char)))issues.push('名称超出长度或字符范围');
  if(f.nameBytes){
    if(f.nameEncoding==='ascii'||f.nameEncoding==='losehu117'){
      const length=[...name].reduce((size,char)=>size+(char.codePointAt(0)!<128?1:2),0);
      if(length>f.nameBytes)issues.push(`名称占 ${length} 字节，最多 ${f.nameBytes} 字节`);
    }else try{encodeName(name,f.nameBytes);}catch(e){issues.push((e as Error).message);}
  }
  return issues;
}
export function channelIssues(channels: ChirpChannel[], f: ChirpFeatures, original: ChirpChannel[] = []): string[] {
  const issues: string[] = [], used = new Set<number>();
  for (const c of channels) {
    if (used.has(c.number)) issues.push(`信道 ${c.number} 编号重复`);
    used.add(c.number);
    if (!Number.isInteger(c.number) || c.number < f.bounds[0] || c.number > f.bounds[1]) issues.push(`信道 ${c.number} 超出编号范围`);
    if (c.empty) continue;
    if (!original.some(old => old.number === c.number && old.name === c.name))issues.push(...channelNameIssues(c.name,f).map(issue=>`信道 ${c.number} ${issue}`));
    if (!Number.isFinite(Number(c.rx)) || Number(c.rx) <= 0 || !f.bands.some(([lo, hi]) => Number(c.rx) * 1e6 >= lo && Number(c.rx) * 1e6 < hi)) issues.push(`信道 ${c.number} 接收频率超出范围`);
    if (c.tx && (!Number.isFinite(Number(c.tx)) || Number(c.tx) <= 0)) issues.push(`信道 ${c.number} 发射频率无效`);
    else if (c.tx && !f.bands.some(([lo,hi]) => Number(c.tx)*1e6>=lo && Number(c.tx)*1e6<hi)) issues.push(`信道 ${c.number} 发射频率超出范围`);
    if (!f.modes.includes(c.mode)) issues.push(`信道 ${c.number} 不支持 ${c.mode}`);
    if (c.power && !f.powers.includes(c.power)) issues.push(`信道 ${c.number} 功率无效`);
    for (const tone of [c.rxTone, c.txTone]) {
      if (tone && !/^D\d{3}[NR]$/.test(tone) && !/^\d+(\.\d+)?$/.test(tone)) issues.push(`信道 ${c.number} 哑音格式无效`);
      else if (/^D/.test(tone) && !f.dtcs.includes(Number(tone.slice(1,-1)))) issues.push(`信道 ${c.number} 不支持 ${tone}`);
      else if (tone && !/^D/.test(tone) && !f.tones.includes(Number(tone))) issues.push(`信道 ${c.number} 不支持哑音 ${tone}`);
    }
  }
  return [...new Set(issues)];
}
export function editedChannels(draft: ChirpDraft): ChirpChannel[] {
  const before = new Map(draft.document.channels.map(c => [c.number, c]));
  const radioFields = (c: ChirpChannel | undefined) => c && [c.number,c.name,c.rx,c.tx,c.rxTone,c.txTone,c.mode,c.power,c.skip,c.step,c.comment,!!c.empty,c.extra,c.extraEdits??{}];
  return draft.channels.filter(c => c.empty ? before.has(c.number) : JSON.stringify(radioFields(c)) !== JSON.stringify(radioFields(before.get(c.number))));
}
export function importChirpTable(data: ArrayBuffer, f: ChirpFeatures): ChirpChannel[] {
  const book = readSpreadsheet(data, { cellFormula:false, cellHTML:false, sheetRows:f.bounds[1]-f.bounds[0]+22 });
  const normalize = (v: unknown) => String(v ?? '').trim().toLowerCase().replace(/[\s()（）_\-/]/g, '');
  const aliases = {
    number: ['number', 'location', '信道', '信道编号', '信道号', '序号', '信道编号0199'], name: ['name', '名称', '信道名称'],
    rx: ['rx', 'frequency', '接收频率', '接收频率mhz', '频率'], tx: ['tx', '发射频率', '发射频率mhz'],
    rxTone: ['rxtone', '接收哑音', '接收亚音', '接收亚音频hz'], txTone: ['txtone', '发射哑音', '发射亚音', '发送亚音频hz'], group: ['group','分组','地区','分区'],
    rxType: ['接收亚音类型','接收亚音频类型','rxtonetype'], txType:['发送亚音类型','发射亚音类型','txtonetype'], rxDcs:['接收亚音数码','rxdcs'], txDcs:['发送亚音数码','发射亚音数码','txdcs'], mode: ['mode', '模式', '带宽'], power: ['power', '功率'], comment: ['comment', '备注'], scan:['扫描添加','scanadd'],skip:['skip','跳过扫描'],
  };
  for (const sheet of book.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[sheet], { header: 1, defval: '' });
    const head = rows.slice(0, 20).findIndex(row => row.some(v => aliases.rx.includes(normalize(v))));
    if (head < 0) continue;
    const columns = Object.fromEntries(Object.entries(aliases).map(([k, names]) => [k, rows[head].findIndex(v => names.includes(normalize(v)))]));
    if (rows[head].some(v => normalize(v) === 'duplex')) throw new Error('CHIRP CSV 请先在 CHIRP 中保存为 IMG 导入；本表格使用独立收发频率列');
    const get = (row: unknown[], k: string) => String(row[columns[k]] ?? '').trim();
    const result = rows.slice(head + 1).filter(row => get(row, 'rx')).map((row, i) => {
      const n = get(row, 'number');
      if (columns.tx < 0) throw new Error('缺少发射频率列；接收专用信道可保留空单元格');
      const c = makeChirpChannel(n ? Number(n) : f.bounds[0] + i, f);
      for (const k of ['name', 'rx', 'tx', 'rxTone', 'txTone', 'comment'] as const) if (columns[k] >= 0) c[k] = k.endsWith('Tone') ? get(row, k).replace(/I$/, 'R') : get(row, k);
      if (columns.group >= 0) c.group = get(row, 'group');
      for (const side of ['rx', 'tx'] as const) {
        const type = get(row, side + 'Type').toUpperCase(), code = get(row, side + 'Dcs').toUpperCase();
        if (['关闭','OFF','NONE','无','0'].includes(type)) c[`${side}Tone`] = '';
        else if (/DCS|数字|数码/.test(type)) {
          const value = (code || c[`${side}Tone`]).replace(/^D/, '');
          if (!value) throw new Error(`信道 ${c.number} 缺少 DCS 码`);
          const suffix = /[NIR]$/.test(value) ? value.slice(-1).replace('I','R') : /反|INV|DCSI/.test(type) ? 'R' : 'N';
          c[`${side}Tone`] = 'D' + value.replace(/[NIR]$/, '').padStart(3,'0') + suffix;
        }
      }
      const mode = get(row, 'mode');
      if (mode) c.mode = /窄|nfm|narrow|12\.5/i.test(mode) ? 'NFM' : /宽|wide|25/i.test(mode) ? 'FM' : mode.toUpperCase();
      const power = get(row, 'power');
      if (power) c.power = f.powers.find(p => p.toLowerCase() === ({ 高: 'high', 中: 'medium', 低: 'low' }[power] ?? power.toLowerCase())) ?? power;
      const scan=get(row,'scan').toLowerCase(),skip=get(row,'skip').toUpperCase();
      if(columns.skip>=0&&skip){
        if(!['S','P'].includes(skip))throw Error(`信道 ${c.number} 扫描标记无效`);
        c.skip=skip;
      }else if(columns.scan>=0&&scan){
        if(['否','关闭','关','0','false','off','no','停用'].includes(scan))c.skip='S';
        else if(['是','开启','开','1','true','on','yes','启用'].includes(scan))c.skip='';
        else throw Error(`信道 ${c.number} 扫描添加值无效`);
      }
      return c;
    });
    if (!result.length) throw new Error('表格没有信道');
    if (result.length > f.bounds[1] - f.bounds[0] + 1) throw new Error('信道数量超过容量');
    return result;
  }
  throw new Error('找不到接收频率表头');
}

/** Re-decode the retained IMG while keeping intentional pending edits and local metadata. */
export function migrateUv5rhDraft(draft:ChirpDraft,document:ChirpDocument):ChirpDraft {
 if(draft.document.model!=='uv5rh'||document.model!=='uv5rh')throw Error('名称迁移型号不匹配');
 const old=new Map(draft.document.channels.map(c=>[c.number,c])),decoded=new Map(document.channels.map(c=>[c.number,c]));
 return {...draft,document,channels:draft.channels.map(channel=>{
  const before=old.get(channel.number),fresh=decoded.get(channel.number);
  return before&&fresh&&channel.name===before.name?{...channel,name:fresh.name}:channel;
 })};
}
