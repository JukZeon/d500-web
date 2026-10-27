export type Power = 'high' | 'mid' | 'low' | `raw:${number}`;
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
  schema: 1;
  name: string;
  channels: Channel[];
  template: DatTemplate | null;
  updatedAt: string;
}
export interface Issue { slot: number; field: string; message: string; severity: 'error' | 'warning' }
export const MAX_CHANNELS = 200;
export const POWER_LABEL: Record<string, string> = { high: '高', mid: '中', low: '低' };
export const newChannel = (slot: number): Channel => ({ slot, name: '', rx: '438.50000', tx: '438.50000', rxTone: '', txTone: '', power: 'low', bandwidth: 'narrow', busy: false, group: '', note: '' });
export const emptyWorkspace = (): Workspace => ({ schema: 1, name: '未命名信道方案', channels: [], template: null, updatedAt: new Date().toISOString() });
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
    ['U段中继示例', '439.55000', '434.55000', '88.5', '中继'],
    ['V段直通', '145.50000', '145.50000', '', '直通'],
    ['车队频道', '438.65000', '438.65000', 'D023N', '车队'],
    ['备用频道', '438.80000', '438.80000', '', '车队'],
    ['V段中继示例', '145.65000', '145.05000', '88.5', '中继'],
  ];
  return { ...emptyWorkspace(), name: '我的 D500 信道方案', channels: examples.map(([name, rx, tx, tone, group], i) => ({ ...newChannel(i), name, rx, tx, txTone: tone, group, note: '演示数据，请按实际使用情况编辑' })) };
}
