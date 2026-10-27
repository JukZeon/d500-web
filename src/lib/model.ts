export type Power = 'high' | 'low' | `raw:${number}`;
export interface Channel {
  slot: number;
  sourceSlot?: number;
  name: string;
  rx: string;
  tx: string;
  rxTone: string;
  txTone: string;
  power: Power;
  bandwidth: 'wide' | 'narrow';
  busy: boolean;
  scanAdd: boolean;
  pttId: number;
  signalCode: number;
  optionalSignal: number;
  muteMode: number;
  scramble: boolean;
  group: string;
  note: string;
}
export interface DatTemplate {
  rows: number[][];
  original: string;
  originalChannels: Channel[];
  fileName: string;
}
export interface Workspace {
  schema: 2;
  name: string;
  channels: Channel[];
  template: DatTemplate | null;
  settings?: RadioSettings;
  updatedAt: string;
}
export interface RadioSettings {
  menu: Record<string, number>;
  vfo: Record<string, number>[];
  text?: Record<string, string>;
}
export interface Issue { slot: number; field: string; message: string; severity: 'error' | 'warning' }
export const MAX_CHANNELS = 200;
export const POWER_LABEL: Record<string, string> = { high: '高', low: '低' };
export const PTT_OPTIONS = ['关闭', '按下时 BOT', '松开时 EOT', '两者 BOTH'];
export const SIGNAL_OPTIONS = ['关闭', 'DTMF', '2TONE', '5TONE'];
export const MUTE_OPTIONS = ['仅哑音 QT', '哑音且信令 AND', '哑音或信令 OR'];
export const newChannel = (slot: number): Channel => ({ slot, name: '', rx: '438.50000', tx: '438.50000', rxTone: '', txTone: '', power: 'low', bandwidth: 'narrow', busy: false, scanAdd: true, pttId: 0, signalCode: 0, optionalSignal: 0, muteMode: 0, scramble: false, group: '', note: '' });
export const emptyWorkspace = (): Workspace => ({ schema: 2, name: '未命名信道方案', channels: [], template: null, updatedAt: new Date().toISOString() });
export function nextSlot(channels: Channel[]): number {
  const used = new Set(channels.map(c => c.slot));
  for (let i = 0; i < MAX_CHANNELS; i++) if (!used.has(i)) return i;
  throw new Error('200 个信道槽位已满，请先删除或合并信道。');
}
export const slotLabel = (slot: number) => String(slot).padStart(3, '0');
export const frequency = (value: string) => Number(value).toFixed(5);
export function demoWorkspace(): Workspace {
  const examples = [
    ['本地直通', '438.50000', '438.50000', '', '直通'],
    ['U段中继', '439.55000', '434.55000', '88.5', '中继'],
    ['V段直通', '145.50000', '145.50000', '', '直通'],
    ['车队频道', '438.65000', '438.65000', 'D023N', '车队'],
    ['备用频道', '438.80000', '438.80000', '', '车队'],
    ['V段中继', '145.65000', '145.05000', '88.5', '中继'],
  ];
  return { ...emptyWorkspace(), name: '我的 D500 信道方案', channels: examples.map(([name, rx, tx, tone, group], i) => ({ ...newChannel(i), name, rx, tx, txTone: tone, group, note: '演示数据，请按实际使用情况编辑' })) };
}
