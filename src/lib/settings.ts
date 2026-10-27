import type { RadioSettings } from './model';
import { MUTE_OPTIONS, PTT_OPTIONS, SIGNAL_OPTIONS } from './model';

export interface SettingDefinition { key: string; label: string; group: string; options: string[]; native: string }
const offOn = ['关闭', '开启'];
const range = (end: number, suffix = '') => Array.from({ length: end + 1 }, (_, i) => `${i}${suffix}`);
const colors = ['白色', '红色', '蓝色', '绿色', '黄色', '青色', '紫色', '灰色'];
// CPS ListIndex values. Updated against the captured 2025 CPS; see DAT_FORMAT.md.
export const MENU_SETTINGS: SettingDefinition[] = [
  { key: '0', label: '多守候 TDR', group: '接收与扫描', options: offOn, native: '4aaf10' },
  { key: '2', label: '静噪等级 SQL', group: '接收与扫描', options: range(9), native: '4a78c0' },
  { key: '17', label: '扫描恢复方式', group: '接收与扫描', options: ['时间 TO', '载波 CO', '搜索 SE'], native: '4a54f0' },
  { key: '48', label: '多守候返回时间', group: '接收与扫描', options: ['关闭', ...range(50).slice(1)], native: '4aaba0' },
  { key: '5', label: '发射限时 TOT', group: '发射与信令', options: Array.from({ length: 40 }, (_, i) => `${(i + 1) * 15} 秒`), native: '4ab550' },
  { key: '15', label: '频率模式繁忙禁发', group: '发射与信令', options: offOn, native: '49b900' },
  { key: '16', label: '频率模式扫描添加', group: '发射与信令', options: offOn, native: '4a5180' },
  { key: '20', label: '频率模式 PTT-ID', group: '发射与信令', options: PTT_OPTIONS, native: '4a1aa0' },
  { key: '21', label: 'PTT-ID 延迟', group: '发射与信令', options: range(30), native: '4a1e10' },
  { key: '14', label: 'DTMF 侧音', group: '发射与信令', options: offOn, native: '49c600' },
  { key: '52', label: '手咪增益', group: '声音与操作', options: range(127), native: '49c290' },
  { key: '25', label: '有效信令提示音', group: '发射与信令', options: offOn, native: '4a10d0' },
  { key: '45', label: 'ANI 码长度', group: '发射与信令', options: ['3 位', '4 位', '5 位'], native: '4993b0' },
  { key: '46', label: '中继激活音', group: '发射与信令', options: ['1000 Hz', '1450 Hz', '1750 Hz', '2100 Hz'], native: '4a37b0' },
  { key: '49', label: '尾音消除 STE', group: '发射与信令', options: offOn, native: '4a8af0' },
  { key: '50', label: '过中继尾音消除', group: '发射与信令', options: ['关闭', ...range(10).slice(1)], native: '4a3df0' },
  { key: '51', label: '信道同步显示', group: '屏幕显示', options: offOn, native: '4a9570' },
  { key: '7', label: '自动锁键', group: '声音与操作', options: offOn, native: '499a90' },
  { key: '9', label: '按键提示音', group: '声音与操作', options: offOn, native: '49bc70' },
  { key: '30', label: '声控 VOX 等级', group: '声音与操作', options: ['关闭', ...range(10).slice(1)], native: '4acbf0' },
  { key: '31', label: '加发身份码', group: '发射与信令', options: offOn, native: '499040' },
  { key: '47', label: '自动关机 APO', group: '声音与操作', options: ['关闭', ...range(200).slice(1)], native: '499720' },
  { key: '54', label: '扬声器位置', group: '声音与操作', options: ['主机', '面板'], native: '4a70f0' },
  { key: '55', label: '麦克风位置', group: '声音与操作', options: ['主机', '面板'], native: '49f570' },
  { key: '56', label: '蓝牙适配器', group: '声音与操作', options: offOn, native: '4a3440' },
  { key: '8', label: '界面语言', group: '屏幕显示', options: ['English', '中文'], native: '49d730' },
  { key: '27', label: 'A 区显示方式', group: '屏幕显示', options: ['频率 + 编号', '编号', '名称 + 编号'], native: '49e040' },
  { key: '28', label: 'B 区显示方式', group: '屏幕显示', options: ['频率 + 编号', '编号', '名称 + 编号'], native: '49e3b0' },
  ...(['状态栏', 'A 区', 'B 区', '电压', '信号', '菜单', '发射', '接收'].map((label, i) => ({ key: String(32 + i), label: `${label}颜色`, group: '屏幕显示', options: colors, native: ['4a8780', '4a5cc0', '4a6030', '49b590', '4a6d80', '49ef50', '4abe60', '4a4700'][i] }))),
  { key: '57', label: '自动背光', group: '屏幕显示', options: ['关闭', ...range(250).slice(1)], native: '498cd0' },
  { key: '58', label: '按下发送提示音', group: '声音与操作', options: ['关闭', '开启', '开启 + 本机响'], native: '49b220' },
  { key: '59', label: '松开发送提示音', group: '声音与操作', options: ['关闭', '开启', '开启 + 本机响'], native: '49c970' },
  { key: '61', label: '遥晕遥毙开关', group: '发射与信令', options: offOn, native: '49d3c0' },
  { key: '23', label: '报警方式', group: '报警', options: ['本机', '远程', '本机 + 远程'], native: '49a580' },
  { key: '24', label: '报警信道', group: '报警', options: range(199).map(v => v.padStart(3, '0')), native: '49a210' },
];
export const VFO_SETTINGS: (SettingDefinition & { byte: number })[] = [
  { key: 'signalCode', byte: 4, label: '信令码组', group: 'VFO', options: range(15).slice(1), native: '4a4a70' },
  { key: 'muteMode', byte: 5, label: '静音方式', group: 'VFO', options: MUTE_OPTIONS, native: '4a7460' },
  { key: 'optionalSignal', byte: 6, label: '可选信令', group: 'VFO', options: SIGNAL_OPTIONS, native: '4a0400' },
  { key: 'scramble', byte: 7, label: '扰频', group: 'VFO', options: offOn, native: '4a5860' },
  { key: 'bandwidth', byte: 8, label: '带宽', group: 'VFO', options: ['宽带 · 25 kHz', '窄带 · 12.5 kHz'], native: '4ad1c0' },
  { key: 'power', byte: 9, label: '功率', group: 'VFO', options: ['高', '低'], native: '4ac1d0' },
  { key: 'shift', byte: 10, label: '频差方向', group: 'VFO', options: ['关闭', '正频差 +', '负频差 −'], native: '4a6920' },
  { key: 'step', byte: 11, label: '频率步进', group: 'VFO', options: ['2.5 kHz', '5 kHz', '6.25 kHz', '10 kHz', '12.5 kHz', '25 kHz'], native: '4a8e60' },
];
export const VFO_NUMERIC = ['frequency', 'offset', 'rxTone', 'txTone'] as const;
export function settingsFields(row: number): number[][] {
  const span = (start: number, n: number) => Array.from({ length: n }, (_, i) => start + i);
  const menu = MENU_SETTINGS.filter(d => row === 224 + Math.floor(Number(d.key) / 16)).map(d => [Number(d.key) % 16]);
  if ([240, 242, 244, 246].includes(row)) return [span(0, 8), span(8, 6)];
  if ([241, 243, 245, 247].includes(row)) return [span(0, 2), span(2, 2), ...VFO_SETTINGS.map(d => [d.byte])];
  if (row === 251) return [span(0, 16)];
  return menu;
}
function digits(bytes: number[]) { return bytes.every(v => v <= 9) ? Number(bytes.join('')) : -1; }
export function readSettings(rows: number[][]): RadioSettings {
  return {
    menu: Object.fromEntries(MENU_SETTINGS.map(d => [d.key, rows[224 + Math.floor(Number(d.key) / 16)][3 + Number(d.key) % 16]])),
    vfo: Array.from({ length: 4 }, (_, bank) => {
      const freq = rows[240 + bank * 2].slice(3), param = rows[241 + bank * 2].slice(3);
      return { ...Object.fromEntries(VFO_SETTINGS.map(d => [d.key, param[d.byte]])), frequency: digits(freq.slice(0, 8)), offset: digits(freq.slice(8, 14)), rxTone: param[0] | param[1] << 8, txTone: param[2] | param[3] << 8 };
    }),
    text: { boot: String.fromCharCode(...rows[251].slice(3)).replace(/[ \x00\xff]+$/, '') },
  };
}
/** New fields absent in an older saved project inherit their original DAT values. */
export function completeSettings(settings: RadioSettings | undefined, baseline: RadioSettings): RadioSettings {
  return { menu: { ...baseline.menu, ...settings?.menu }, vfo: baseline.vfo.map((v, b) => ({ ...v, ...settings?.vfo[b] })), text: { ...baseline.text, ...settings?.text } };
}
export function validateSettings(input: RadioSettings, baseline: RadioSettings): string[] {
  const settings = completeSettings(input, baseline), issues: string[] = [];
  function check(value: number, old: number, d: SettingDefinition, prefix = '') {
    if (!Number.isInteger(value) || value < 0 || value > 255 || (value !== old && value >= d.options.length)) issues.push(`${prefix}${d.label}的值无效`);
  }
  for (const d of MENU_SETTINGS) check(settings.menu[d.key], baseline.menu[d.key], d);
  for (let bank = 0; bank < 4; bank++) {
    for (const d of VFO_SETTINGS) check(settings.vfo[bank][d.key], baseline.vfo[bank][d.key], d, `${'ABCD'[bank]} 区 `);
    for (const key of VFO_NUMERIC) {
      const v = settings.vfo[bank][key];
      if (v === baseline.vfo[bank][key]) continue;
      const valid = Number.isInteger(v) && (key === 'frequency' ? v > 0 && v <= 99999999 : key === 'offset' ? v >= 0 && v <= 99999 : v === 0 || v >= 1 && v <= 210 || v >= 600 && v <= 2600);
      if (!valid) issues.push(`${'ABCD'[bank]} 区${key === 'frequency' ? '频率' : key === 'offset' ? '频差' : '哑音'}无效`);
    }
  }
  if (settings.text?.boot !== baseline.text?.boot && !/^[\x20-\x7e]{0,15}$/.test(settings.text?.boot ?? '')) issues.push('开机文字最多 15 个英文、数字或符号');
  return issues;
}
export function settingsChanges(input: RadioSettings | undefined, baseline: RadioSettings): number {
  if (!input) return 0;
  const settings = completeSettings(input, baseline);
  return MENU_SETTINGS.filter(d => settings.menu[d.key] !== baseline.menu[d.key]).length + [...VFO_SETTINGS.map(d => d.key), ...VFO_NUMERIC].reduce((n, key) => n + baseline.vfo.filter((v, b) => v[key] !== settings.vfo[b][key]).length, 0) + Number(settings.text?.boot !== baseline.text?.boot);
}
export function writeSettings(rows: number[][], input: RadioSettings, baseline: RadioSettings): void {
  const settings = completeSettings(input, baseline), errors = validateSettings(settings, baseline);
  if (errors.length) throw new Error(errors[0]);
  for (const d of MENU_SETTINGS) if (settings.menu[d.key] !== baseline.menu[d.key]) rows[224 + Math.floor(Number(d.key) / 16)][3 + Number(d.key) % 16] = settings.menu[d.key];
  for (let b = 0; b < 4; b++) {
    const v = settings.vfo[b], old = baseline.vfo[b];
    for (const d of VFO_SETTINGS) if (v[d.key] !== old[d.key]) rows[241 + b * 2][3 + d.byte] = v[d.key];
    for (const [key, offset, length] of [['frequency', 0, 8], ['offset', 8, 6]] as const) if (v[key] !== old[key]) rows[240 + b * 2].splice(3 + offset, length, ...String(v[key]).padStart(length, '0').split('').map(Number));
    for (const [key, offset] of [['rxTone', 0], ['txTone', 2]] as const) if (v[key] !== old[key]) rows[241 + b * 2].splice(3 + offset, 2, v[key] & 255, v[key] >> 8);
  }
  if (settings.text?.boot !== baseline.text?.boot) rows[251].splice(3, 16, ...Array.from({ length: 16 }, (_, i) => settings.text?.boot?.charCodeAt(i) || 32));
}
