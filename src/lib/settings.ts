import type { RadioSettings } from './model';
import { MUTE_OPTIONS, PTT_OPTIONS, SIGNAL_OPTIONS } from './model';

export interface SettingDefinition { key: string; label: string; group: string; options: string[]; native: string }
const offOn = ['关闭', '开启'];
const range = (end: number, suffix = '') => Array.from({ length: end + 1 }, (_, i) => `${i}${suffix}`);
const colors = ['白色', '红色', '蓝色', '绿色', '黄色', '青色', '紫色', '灰色'];
// Zero-based ComboBox ListIndex values traced from the V1 native CPS handlers.
export const MENU_SETTINGS: SettingDefinition[] = [
  { key: '0', label: '多守候 TDR', group: '接收与扫描', options: offOn, native: '4a8150' },
  { key: '2', label: '静噪等级 SQL', group: '接收与扫描', options: range(9), native: '4a4e80' },
  { key: '17', label: '扫描恢复方式', group: '接收与扫描', options: ['时间 TO', '载波 CO', '搜索 SE'], native: '4a2ab0' },
  { key: '48', label: '多守候返回时间', group: '接收与扫描', options: ['关闭', ...range(50).slice(1)], native: '4a7de0' },
  { key: '5', label: '发射限时 TOT', group: '发射与信令', options: Array.from({ length: 40 }, (_, i) => `${(i + 1) * 15} 秒`), native: '4a8790' },
  { key: '15', label: '频率模式繁忙禁发', group: '发射与信令', options: offOn, native: '4991a0' },
  { key: '16', label: '频率模式扫描添加', group: '发射与信令', options: offOn, native: '4a2740' },
  { key: '20', label: '频率模式 PTT-ID', group: '发射与信令', options: PTT_OPTIONS, native: '49f080' },
  { key: '21', label: 'PTT-ID 延迟', group: '发射与信令', options: range(30), native: '49f3f0' },
  { key: '14', label: 'DTMF 侧音', group: '发射与信令', options: offOn, native: '499ea0' },
  { key: '52', label: 'DTMF 增益', group: '发射与信令', options: range(127), native: '499b30' },
  { key: '25', label: '有效信令提示音', group: '发射与信令', options: offOn, native: '49e610' },
  { key: '45', label: 'ANI 码长度', group: '发射与信令', options: ['3 位', '4 位', '5 位'], native: '496fc0' },
  { key: '46', label: '中继激活音', group: '发射与信令', options: ['1000 Hz', '1450 Hz', '1750 Hz', '2100 Hz'], native: '4a0cd0' },
  { key: '49', label: '尾音消除 STE', group: '发射与信令', options: offOn, native: '4a60a0' },
  { key: '50', label: '过中继尾音消除', group: '发射与信令', options: ['关闭', ...range(10).slice(1)], native: '4a1310' },
  { key: '51', label: '中继尾音延迟', group: '发射与信令', options: ['关闭', ...range(10).slice(1)], native: '4a1680' },
  { key: '7', label: '自动锁键', group: '声音与操作', options: offOn, native: '4976a0' },
  { key: '9', label: '按键提示音', group: '声音与操作', options: offOn, native: '499510' },
  { key: '30', label: '声控 VOX 等级', group: '声音与操作', options: ['关闭', ...range(10).slice(1)], native: '4a9e30' },
  { key: '31', label: '声控延迟', group: '声音与操作', options: range(20), native: '4aa130' },
  { key: '47', label: '自动关机 APO', group: '声音与操作', options: ['关闭', ...range(200).slice(1)], native: '497330' },
  { key: '54', label: '扬声器位置', group: '声音与操作', options: ['主机', '面板'], native: '4a46b0' },
  { key: '55', label: '麦克风位置', group: '声音与操作', options: ['主机', '面板'], native: '49cab0' },
  { key: '56', label: '面板类型', group: '声音与操作', options: ['短面板', '长面板'], native: '49e980' },
  { key: '8', label: '界面语言', group: '屏幕显示', options: ['English', '中文'], native: '49ac60' },
  { key: '27', label: 'A 区显示方式', group: '屏幕显示', options: ['频率 + 编号', '编号', '名称 + 编号'], native: '49b570' },
  { key: '28', label: 'B 区显示方式', group: '屏幕显示', options: ['频率 + 编号', '编号', '名称 + 编号'], native: '49b8e0' },
  ...(['状态栏', 'A 区', 'B 区', '电压', '信号', '菜单', '发射', '接收'].map((label, i) => ({ key: String(32 + i), label: `${label}颜色`, group: '屏幕显示', options: colors, native: ['4a5d30', '4a3280', '4a35f0', '498e30', '4a4340', '49c480', '4a90a0', '4a1cc0'][i] }))),
  { key: '23', label: '报警方式', group: '报警', options: ['本机', '远程', '本机 + 远程'], native: '49a580' },
  { key: '24', label: '报警信道', group: '报警', options: range(199).map(v => v.padStart(3, '0')), native: '49a210' },
];
export const VFO_SETTINGS: (SettingDefinition & { byte: number })[] = [
  { key: 'signalCode', byte: 4, label: '信令码组', group: 'VFO', options: range(15).slice(1), native: '4a2030' },
  { key: 'muteMode', byte: 5, label: '静音方式', group: 'VFO', options: MUTE_OPTIONS, native: '4a4a20' },
  { key: 'optionalSignal', byte: 6, label: '可选信令', group: 'VFO', options: SIGNAL_OPTIONS, native: '49d940' },
  { key: 'bandwidth', byte: 8, label: '带宽', group: 'VFO', options: ['宽带 · 25 kHz', '窄带 · 12.5 kHz'], native: '4aa4a0' },
  { key: 'power', byte: 9, label: '功率', group: 'VFO', options: ['高', '低'], native: '4a9410' },
  { key: 'shift', byte: 10, label: '频差方向', group: 'VFO', options: ['关闭', '正频差 +', '负频差 −'], native: '4a3ee0' },
  { key: 'step', byte: 11, label: '频率步进', group: 'VFO', options: ['2.5 kHz', '5 kHz', '6.25 kHz', '10 kHz', '12.5 kHz', '25 kHz'], native: '4a6410' },
];
export function readSettings(rows: number[][]): RadioSettings {
  return {
    menu: Object.fromEntries(MENU_SETTINGS.map(d => [d.key, rows[224 + Math.floor(Number(d.key) / 16)][3 + Number(d.key) % 16]])),
    vfo: Array.from({ length: 4 }, (_, bank) => Object.fromEntries(VFO_SETTINGS.map(d => [d.key, rows[241 + bank * 2][3 + d.byte]]))),
  };
}
export function validateSettings(settings: RadioSettings, baseline: RadioSettings): string[] {
  const issues: string[] = [];
  function check(value: number, old: number, d: SettingDefinition, prefix = '') {
    if (!Number.isInteger(value) || value < 0 || value > 255 || (value !== old && value >= d.options.length)) issues.push(`${prefix}${d.label}的值无效`);
  }
  for (const d of MENU_SETTINGS) check(settings.menu[d.key], baseline.menu[d.key], d);
  for (let bank = 0; bank < 4; bank++) for (const d of VFO_SETTINGS) check(settings.vfo[bank]?.[d.key], baseline.vfo[bank][d.key], d, `${'ABCD'[bank]} 区 `);
  return issues;
}
export function settingsChanges(settings: RadioSettings | undefined, baseline: RadioSettings): number {
  if (!settings) return 0;
  return MENU_SETTINGS.filter(d => settings.menu[d.key] !== baseline.menu[d.key]).length + VFO_SETTINGS.reduce((n, d) => n + baseline.vfo.filter((v, b) => v[d.key] !== settings.vfo[b]?.[d.key]).length, 0);
}
export function writeSettings(rows: number[][], settings: RadioSettings, baseline: RadioSettings): void {
  const errors = validateSettings(settings, baseline);
  if (errors.length) throw new Error(errors[0]);
  for (const d of MENU_SETTINGS) if (settings.menu[d.key] !== baseline.menu[d.key]) rows[224 + Math.floor(Number(d.key) / 16)][3 + Number(d.key) % 16] = settings.menu[d.key];
  for (let b = 0; b < 4; b++) for (const d of VFO_SETTINGS) if (settings.vfo[b][d.key] !== baseline.vfo[b][d.key]) rows[241 + b * 2][3 + d.byte] = settings.vfo[b][d.key];
}
