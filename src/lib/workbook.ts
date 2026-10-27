import * as XLSX from 'xlsx';
import { type Channel, type Power, newChannel, slotLabel } from './model';
import { validateChannels } from './dat';

export const HEADERS = ['信道编号(0-199)', '信道名称', '接收频率(MHz)', '发射频率(MHz)', '接收亚音', '发射亚音', '功率', '带宽', '繁忙禁发', '分组', '备注'];
const clean = (s: unknown) => String(s ?? '').trim();
const key = (s: unknown) => clean(s).toLowerCase().replace(/[\s_()（）\-./]/g, '');
const asFreq = (v: unknown): string => {
  const s = clean(v).replace(/mhz|兆赫/ig, '');
  if (!s || /^(off|无|禁发|rxonly)$/i.test(s)) return '';
  let n = Number(s.replace(/khz|hz/ig, ''));
  if (/khz/i.test(s)) n /= 1000;
  else if (/hz/i.test(s) || n >= 1e6) n /= 1e6;
  else if (n >= 100000) n /= 1000;
  return Number.isFinite(n) ? n.toFixed(5) : s;
};
const bool = (v: unknown) => ['1', 'true', 'on', 'yes', '是', '开', '开启', '启用'].includes(clean(v).toLowerCase());
const power = (v: unknown): Power => {
  const s = clean(v).toLowerCase();
  if (['高', 'h', 'high', '0', '高功率'].includes(s)) return 'high';
  if (['中', 'm', 'mid', 'middle', '1', '中功率'].includes(s)) return 'mid';
  if (/^raw:\d{1,3}$/.test(s)) return s as Power;
  if (!s || ['低', 'l', 'low', '2', '低功率'].includes(s)) return 'low';
  throw new Error(`未知功率“${clean(v)}”，请使用 高 / 中 / 低`);
};
type Field = 'slot' | 'name' | 'rx' | 'tx' | 'rxTone' | 'txTone' | 'rxType' | 'txType' | 'rxDcs' | 'txDcs' | 'power' | 'bandwidth' | 'busy' | 'group' | 'note';
const aliases: Record<Field, string[]> = {
  slot: ['信道编号0199', '信道编号', '信道号', '信道', 'channel', 'channelnumber', 'no', '#', '序号'],
  name: ['信道名称', '名称', 'name', 'channelname', 'chname'],
  rx: ['接收频率mhz', '接收频率', '接收', 'rxfreq', 'rxfrequency', 'rx', 'frequency', '频率'],
  tx: ['发射频率mhz', '发射频率', '发射', 'txfreq', 'txfrequency', 'tx', '发送频率'],
  rxTone: ['接收亚音', '接收亚音频', '接收亚音频hz', '接收亚音数值', 'rxtone', 'rxctcssdcs', 'rctcs', 'tsql', 'tonesql'],
  txTone: ['发射亚音', '发送亚音', '发送亚音频hz', '发射亚音频hz', '发射亚音数值', 'txtone', 'txctcssdcs', 'tctcs', 'tone'],
  rxType: ['rxtonetype', '接收亚音类型', '接收亚音频类型'], txType: ['txtonetype', '发射亚音类型', '发送亚音类型'],
  rxDcs: ['接收亚音数码', 'rxdcs'], txDcs: ['发送亚音数码', '发射亚音数码', 'txdcs'],
  power: ['功率', '发射功率', '发送功率', 'power', 'txpower'],
  bandwidth: ['带宽', 'bandwidth', 'bw', 'mode', '调制模式'],
  busy: ['繁忙禁发', 'bcl', 'busy', 'busylock', 'busylockout'],
  group: ['分组', 'group', '区域', 'zone', '分类'], note: ['备注', 'note', 'notes', 'comment', '说明'],
};
function findColumns(row: unknown[]): Partial<Record<Field, number>> {
  const map: Partial<Record<Field, number>> = {};
  for (const [field, names] of Object.entries(aliases) as [Field, string[]][]) {
    const i = row.findIndex(v => names.includes(key(v)));
    if (i >= 0) map[field] = i;
  }
  return map;
}
function tone(value: unknown, type: unknown, dcsValue?: unknown): string {
  const s = clean(value).toUpperCase(), t = clean(type).toUpperCase();
  if (['NONE', 'OFF', '无', '0'].includes(t)) return '';
  if (/DCS|数字|数码/.test(t) && clean(dcsValue)) {
    const code = clean(dcsValue).toUpperCase();
    // An explicit N/I suffix is authoritative, even when the type column is DCSH.
    const suffix = /[NI]$/.test(code) ? code.slice(-1) : /反|INV|DCSI|DCS I/.test(t) ? 'I' : 'N';
    return 'D' + code.replace(/^D/, '').replace(/[NI]$/, '').padStart(3, '0') + suffix;
  }
  if (!s || s === '-' || s === '0' || s === 'OFF') return '';
  if (t.includes('DCS')) return 'D' + s.replace(/^D/, '').replace(/[NI]$/, '').padStart(3, '0') + (t.includes('I') || /I$/.test(s) ? 'I' : 'N');
  return s.replace(/HZ$/, '');
}
export interface WorkbookImport { channels: Channel[]; sheetName: string; warnings: string[]; detected: string; providedFields: string[] }
export function importWorkbook(data: ArrayBuffer, fileName: string): WorkbookImport {
  if (data.byteLength > 8 * 1024 * 1024) throw new Error('表格超过 8 MB，请只保留需要导入的信道工作表。');
  const book = XLSX.read(data, { type: 'array', cellFormula: false, cellHTML: false, sheetRows: 1200 });
  for (const sheetName of book.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[sheetName], { header: 1, defval: '', raw: true });
    let columns: Partial<Record<Field, number>> = {}, head = -1;
    for (let i = 0; i < Math.min(rows.length, 20); i++) {
      const found = findColumns(rows[i]);
      if (found.rx !== undefined) { columns = found; head = i; break; }
    }
    if (head < 0) continue;
    const isK5 = /k5channel/i.test(sheetName) || (columns.slot !== undefined && clean(rows[head][columns.slot]) === '#');
    const channels: Channel[] = [], warnings: string[] = [];
    for (let i = head + 1; i < rows.length; i++) {
      const row = rows[i];
      const get = (field: Field): unknown => columns[field] === undefined ? '' : row[columns[field]!];
      if (!clean(get('rx'))) continue;
      let slot = columns.slot === undefined || !clean(get('slot')) ? channels.length : Number(get('slot'));
      if (isK5 && slot === 200) slot = 0;
      const rx = asFreq(get('rx')), tx = columns.tx === undefined ? rx : asFreq(get('tx'));
      const bw = clean(get('bandwidth')).toLowerCase();
      if (bw && !['wide', '宽', '宽带', 'w', 'fm', '25', '25k', '25khz', 'narrow', '窄', '窄带', 'n', 'nfm', '12.5', '12.5k', '12.5khz', '0', '1'].includes(bw)) throw new Error(`表格第 ${i + 1} 行带宽“${bw}”不支持`);
      const c: Channel = { ...newChannel(slot), name: clean(get('name')), rx, tx, rxTone: tone(get('rxTone'), get('rxType'), get('rxDcs')), txTone: tone(get('txTone'), get('txType'), get('txDcs')), power: power(get('power')), bandwidth: ['wide', '宽', '宽带', 'w', 'fm', '25', '25k', '25khz', '0'].includes(bw) ? 'wide' : 'narrow', busy: bool(get('busy')), group: clean(get('group')), note: clean(get('note')) };
      channels.push(c);
      if (channels.length > 200) throw new Error('信道超过 200 条，请分成多个方案。');
    }
    if (!channels.length) throw new Error('找到接收频率列，但没有有效信道。');
    const errors = validateChannels(channels).filter(i => i.severity === 'error');
    if (errors.length) throw new Error(`信道 ${slotLabel(errors[0].slot)}：${errors[0].message}（共 ${errors.length} 个问题）`);
    if (isK5) warnings.push('已识别 K5Web 表格：信道 200 对应 D500 的 000，1–199 保持原号。');
    warnings.push('只转换已支持的信道字段；扫描列表、步进、信令等由原始 DAT 模板保留。');
    return { channels, sheetName, warnings, detected: isK5 ? 'K5Web / K1' : /csv$/i.test(fileName) ? 'CSV' : 'D500 / 通用表格', providedFields: Object.keys(columns) };
  }
  throw new Error('没有找到接收频率列。请使用“下载模板”，或在前 20 行放置“接收频率 / RX Frequency”表头。');
}
export function exportWorkbook(channels: Channel[], name: string): Uint8Array {
  const rows = channels.slice().sort((a, b) => a.slot - b.slot).map(c => [c.slot, c.name, c.rx, c.tx, c.rxTone, c.txTone, ({ high: '高', mid: '中', low: '低' } as Record<string, string>)[c.power] ?? c.power, c.bandwidth === 'wide' ? '宽带' : '窄带', c.busy ? '是' : '否', c.group, c.note]);
  const sheet = XLSX.utils.aoa_to_sheet([HEADERS, ...rows]);
  sheet['!cols'] = [14, 20, 20, 20, 14, 14, 10, 10, 12, 16, 40].map(wch => ({ wch }));
  sheet['!autofilter'] = { ref: `A1:K${rows.length + 1}` };
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'D500信道');
  const info = XLSX.utils.aoa_to_sheet([
    ['D500 Workbench 信道表', name], ['编号', 'D500 原生编号 0–199；不要把 000 改成 200。'],
    ['频率', '单位 MHz，最多五位小数。发射频率空白表示接收专用。'], ['亚音', '留空 / 88.5 / D023N / D023I'],
    ['名称', 'GBK 编码最多 16 字节，通常为 8 个汉字；不支持表情符号。'],
    ['DAT', '导出 DAT 前需导入原厂软件导出的文件作为模板，保留其他机器设置。'],
    ['分组与备注', '只用于网页和表格，不写入电台 DAT。'], ['隐私', '文件在浏览器本地处理。'],
  ]);
  info['!cols'] = [{ wch: 20 }, { wch: 86 }];
  XLSX.utils.book_append_sheet(book, info, '使用说明');
  return new Uint8Array(XLSX.write(book, { type: 'array', bookType: 'xlsx', compression: true }));
}
export function exportCsv(channels: Channel[]): string {
  const book = XLSX.read(exportWorkbook(channels, ''), { type: 'array' });
  return '\uFEFF' + XLSX.utils.sheet_to_csv(book.Sheets['D500信道']);
}
