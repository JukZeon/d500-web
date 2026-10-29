import capabilities from './radio-capabilities.json';
import { type Channel, type Workspace, newChannel } from './model';
import { type ChirpChannel, type ChirpDocument, type ChirpDraft, type ChirpFeatures, type ChirpModel, type RadioModel, makeChirpChannel, channelIssues, RADIO_MODELS } from './chirp';
import { encodeName } from './encoding';
import { validateChannels } from './dat';

/** Common channel fields only. Device settings, raw bytes and signalling stay in their profile. */
export interface ManagedChannel {
  id: string; number: number; name: string; rx: string; tx: string; rxTone: string; txTone: string;
  mode: string; power: string; scanAdd: boolean; step: number; group: string; note: string;
  sourceModel?: RadioModel; numberBase?:0|1; libraryId?: string; aliases?: Partial<Record<RadioModel, string>>;
}
export interface ChannelLibrary { schema: 'radio-channel-library-v1'; channels: ManagedChannel[]; updatedAt: string }
export type TransferMode = 'sync' | 'append' | 'merge' | 'replace';
export interface TransferRow { source: ManagedChannel; channel: ManagedChannel; errors: string[]; warnings: string[]; overwrites: boolean }
export interface TransferOptions { mode: TransferMode; start?: number; names?: Record<string, string> }
export const D500_STORAGE = 'ba7ktc-d500-workspace-v1';
export const LIBRARY_STORAGE = 'radio-workbench-library-v1';
export const chirpStorage = (model: ChirpModel) => `ba7ktc-chirp-${model}-v1`;
export const emptyLibrary = (): ChannelLibrary => ({ schema: 'radio-channel-library-v1', channels: [], updatedAt: new Date().toISOString() });
export const canonicalPower = (power: string) => /^(medium|med|mid)$/i.test(power) ? 'medium' : power.toLowerCase();
export const nativePower = (power: string, f: ChirpFeatures) => f.powers.find(p => canonicalPower(p) === canonicalPower(power)) ?? power;
export const baselineFeatures = (model: ChirpModel) => structuredClone(capabilities[model]) as ChirpFeatures;
export const boundsFor = (model: RadioModel, features?: ChirpFeatures): [number, number] => model === 'd500' ? [0, 199] : (features ?? baselineFeatures(model)).bounds;
export function offlineDraft(model: ChirpModel): ChirpDraft {
  const document: ChirpDocument = { schema: 'radio-workbench-chirp-v1', model, driverRevision: 'offline', features: baselineFeatures(model), channels: [], settings: [], image: '', firmware: '', settingsLimited: model === 'uvk5-losehu' };
  return { document, channels: [], settings: {}, name: RADIO_MODELS.find(m => m.id === model)!.label + ' 方案' };
}
export function managedD500(channels: Channel[]): ManagedChannel[] {
  return channels.map(c => ({ id: `d500:${c.slot}`, number: c.slot, name: c.name, rx: c.rx, tx: c.tx, rxTone: c.rxTone, txTone: c.txTone, mode: c.bandwidth === 'narrow' ? 'NFM' : 'FM', power: c.power, scanAdd: c.scanAdd, step: 5, group: c.group, note: c.note, sourceModel: 'd500', ...(c.libraryId ? {libraryId:c.libraryId} : {}) }));
}
export function managedChirp(channels: ChirpChannel[], model: ChirpModel): ManagedChannel[] {
  return channels.filter(c => !c.empty).map(c => ({ id: `${model}:${c.number}`, number: c.number, name: c.name, rx: c.rx, tx: c.tx, rxTone: c.rxTone.replace(/R$/, 'I'), txTone: c.txTone.replace(/R$/, 'I'), mode: c.mode, power: canonicalPower(c.power), scanAdd: c.skip !== 'S', step: c.step, group: c.group ?? '', note: c.comment, sourceModel: model, ...(c.libraryId ? {libraryId:c.libraryId} : {}) }));
}
export function d500Channel(row: ManagedChannel, before?: Channel): Channel {
  const frequency = (value: string) => value && Math.abs(Number(value) * 1e5 - Math.round(Number(value) * 1e5)) < 0.00001 ? Number(value).toFixed(5) : value;
  return { ...(before ?? newChannel(row.number)), slot: row.number, name: row.name, rx: frequency(row.rx), tx: frequency(row.tx), rxTone: row.rxTone, txTone: row.txTone, bandwidth: row.mode === 'NFM' ? 'narrow' : 'wide', power: row.power as Channel['power'], scanAdd: row.scanAdd, group: row.group, note: row.note, libraryId:row.libraryId };
}
export function chirpChannel(row: ManagedChannel, f: ChirpFeatures, before?: ChirpChannel): ChirpChannel {
  return { ...(before ?? makeChirpChannel(row.number, f)), number: row.number, empty: false, name: row.name, rx: row.rx, tx: row.tx, rxTone: row.rxTone.replace(/I$/, 'R'), txTone: row.txTone.replace(/I$/, 'R'), mode: row.mode, power: nativePower(row.power, f), skip: before && (before.skip !== 'S') === row.scanAdd ? before.skip : row.scanAdd ? '' : 'S', step: row.step, group: row.group, comment: row.note, libraryId:row.libraryId };
}
/** Keep target-specific advanced fields and deletion records, never source driver fields. */
export function replaceChirpChannels(before: ChirpChannel[], rows: ManagedChannel[], f: ChirpFeatures): ChirpChannel[] {
  const existing = new Map(before.map(c => [c.number, c]));
  const result = new Map<number, ChirpChannel>(before.map(c => [c.number, { ...c, empty: true }]));
  for (const row of rows) {
    const sourceNumber = Number(row.id.split(':').at(-1));
    result.set(row.number, chirpChannel(row, f, existing.get(sourceNumber) ?? existing.get(row.number)));
  }
  return [...result.values()].sort((a, b) => a.number - b.number);
}
export function channelIdentity(row: Pick<ManagedChannel, 'rx' | 'tx' | 'rxTone' | 'txTone' | 'mode'>): string {
  const frequency = (s: string) => s === '' ? '' : Number.isFinite(Number(s)) ? Number(s).toFixed(6) : s;
  const tone = (s: string) => /^D/i.test(s) ? s.toUpperCase().replace(/R$/, 'I') : s ? String(Number(s)) : '';
  return JSON.stringify([frequency(row.rx), frequency(row.tx), tone(row.rxTone), tone(row.txTone), row.mode]);
}
export function mergeLibrary(library: ChannelLibrary, rows: ManagedChannel[], id: () => string = () => crypto.randomUUID()): ChannelLibrary {
  const channels = library.channels.map(c => ({ ...c }));
  for (const row of rows) {
    const index = channels.findIndex(c => c.id === row.id || c.id === row.libraryId || channelIdentity(c) === channelIdentity(row));
    if (index >= 0) {
      const before = channels[index];
      channels[index] = row.sourceModel && before.sourceModel && row.sourceModel !== before.sourceModel && before.name
        ? { ...row, id:before.id, libraryId:before.id, sourceModel:before.sourceModel, name:before.name, aliases: { ...before.aliases, ...row.aliases, [row.sourceModel]: row.name } }
        : { ...row, id: before.id, libraryId:before.id, aliases: { ...before.aliases, ...row.aliases } };
    }
    else {const nextId=id();channels.push({ ...row, id:nextId, libraryId:nextId });}
  }
  if (channels.length > 5000) throw new Error('信道库最多 5000 条');
  return { ...library, channels, updatedAt: new Date().toISOString() };
}
export function rowIssues(row: ManagedChannel, model: RadioModel | 'library', f?: ChirpFeatures, original: ChirpChannel[] = []): string[] {
  if (model === 'library') {
    const issues: string[] = [];
    if (!Number.isFinite(Number(row.rx)) || Number(row.rx) <= 0) issues.push('接收频率无效');
    if (row.tx && (!Number.isFinite(Number(row.tx)) || Number(row.tx) <= 0)) issues.push('发射频率无效');
    return issues;
  }
  if (model === 'd500') {
    const issues = validateChannels([d500Channel(row)]).filter(i => i.severity === 'error').map(i => i.message);
    if (!['FM', 'NFM'].includes(row.mode)) issues.push(`不支持 ${row.mode}`);
    return issues;
  }
  const features = f ?? baselineFeatures(model);
  return channelIssues([chirpChannel(row, features)], features, original).map(s => s.replace(/^信道 \d+ /, ''));
}
export function compatibleName(name: string, model: RadioModel, number: number, f?: ChirpFeatures): string {
  let result = '';
  if (model === 'd500') {
    for (const char of name) { try { encodeName(result + char); result += char; } catch { break; } }
  } else {
    const features = f ?? baselineFeatures(model);
    for (const char of name) {
      const next = features.characters.includes(char) ? char : features.characters.includes(char.toUpperCase()) ? char.toUpperCase() : '';
      if (result.length + next.length > features.nameLength) break;
      if(features.nameBytes){try{encodeName(result+next,features.nameBytes);}catch{break;}}
      result += next;
    }
  }
  if(model!=='d500'&&result.trim()&&result.length<3&&[...name].some(char=>!(f??baselineFeatures(model)).characters.includes(char))){
    result=(result+String(number).padStart(3,'0')).slice(0,(f??baselineFeatures(model)).nameLength);
  }
  return result.trim() || `CH${String(number).padStart(3, '0')}`;
}
export function planTransfer(source: ManagedChannel[], model: RadioModel, target: ManagedChannel[], options: TransferOptions, features?: ChirpFeatures): TransferRow[] {
  const f = model === 'd500' ? undefined : features ?? baselineFeatures(model), [lo, hi] = boundsFor(model, f);
  const occupied = new Set(target.map(c => c.number)), planned = new Set<number>();
  let cursor = options.start ?? lo;
  return source.map(row => {
    const warnings: string[] = [];
    let number: number;
    if (options.mode === 'append' || options.mode === 'sync') {
      const link = row.libraryId ?? (!RADIO_MODELS.some(m=>row.id.startsWith(m.id+':')) ? row.id : undefined);
      const linked = options.mode === 'sync' ? target.find(c => link && c.libraryId === link)
        ?? target.find(c => (!link || !c.libraryId) && channelIdentity(c) === channelIdentity(row)) : undefined;
      if(linked) number=linked.number;
      else {while (occupied.has(cursor) && cursor <= hi) cursor++; number = cursor++;}
    }
    else number = row.number - (row.numberBase ?? (row.sourceModel ? boundsFor(row.sourceModel)[0] : 1)) + lo;
    const channel = { ...row, id: `${model}:${number}`, number, name: options.names?.[row.id] ?? row.aliases?.[model] ?? row.name, power: canonicalPower(row.power), sourceModel: model, libraryId:row.libraryId ?? (!RADIO_MODELS.some(m=>row.id.startsWith(m.id+':')) ? row.id : undefined) };
    const powers = model === 'd500' ? ['high', 'low'] : f!.powers.map(canonicalPower);
    if (!powers.includes(channel.power)) { channel.power = powers.includes('low') ? 'low' : powers[0]; if(row.power)warnings.push(`功率 ${row.power} → ${channel.power}`); }
    if (f && !f.steps.includes(channel.step)) { channel.step = f.steps[0] ?? 5; if (f.hasStep) warnings.push(`步进 → ${channel.step} kHz`); }
    const errors = rowIssues(channel, model, f);
    if (!Number.isInteger(number) || number < lo || number > hi) errors.push(`编号超出 ${lo}–${hi}，容量不足`);
    if (planned.has(number)) errors.push('本次列表有重复目标编号，请使用追加空位');
    planned.add(number);
    const overwrites = occupied.has(number) && options.mode !== 'append';
    occupied.add(number);
    return { source: row, channel, errors: [...new Set(errors)], warnings, overwrites };
  });
}
export function applyD500Transfer(workspace: Workspace, rows: ManagedChannel[], mode: TransferMode): Workspace {
  const previous = new Map(workspace.channels.map(c => [c.slot, c]));
  const map = mode === 'replace' ? new Map<number, Channel>() : new Map(previous);
  for (const row of rows) map.set(row.number, d500Channel(row, previous.get(row.number)));
  return { ...workspace, channels: [...map.values()].sort((a, b) => a.slot - b.slot), updatedAt: new Date().toISOString() };
}
export function applyChirpTransfer(draft: ChirpDraft, rows: ManagedChannel[], mode: TransferMode): ChirpDraft {
  const current = mode === 'replace' ? [] : managedChirp(draft.channels, draft.document.model);
  const map = new Map(current.map(c => [c.number, c]));
  for (const row of rows) map.set(row.number, row);
  return { ...draft, channels: replaceChirpChannels(draft.channels, [...map.values()], draft.document.features) };
}
export function parseLibrary(text: string): ChannelLibrary {
  if (text.length > 8_000_000) throw new Error('信道库文件过大');
  const value = JSON.parse(text);
  if (!value || value.schema !== 'radio-channel-library-v1' || !Array.isArray(value.channels) || value.channels.length > 5000) throw new Error('不是有效的共享信道库');
  const ids = new Set<string>();
  for (const row of value.channels) {
    if (!row || typeof row.id !== 'string' || row.id.length > 100 || ids.has(row.id) || !Number.isInteger(row.number) || typeof row.scanAdd !== 'boolean' || !Number.isFinite(row.step)) throw new Error('信道库记录无效');
    ids.add(row.id);
    for (const field of ['name', 'rx', 'tx', 'rxTone', 'txTone', 'mode', 'power', 'group', 'note']) if (typeof row[field] !== 'string' || row[field].length > 2000) throw new Error('信道库字段无效');
    if (row.libraryId !== undefined && (typeof row.libraryId !== 'string' || row.libraryId.length > 100)) throw new Error('共享信道关联无效');
    if (row.numberBase !== undefined && ![0,1].includes(row.numberBase)) throw new Error('来源编号无效');
    if (row.sourceModel !== undefined && !RADIO_MODELS.some(m => m.id === row.sourceModel)) throw new Error('来源型号无效');
    if (row.aliases && (typeof row.aliases !== 'object' || Array.isArray(row.aliases) || Object.entries(row.aliases).some(([key, name]) => !RADIO_MODELS.some(m => m.id === key) || typeof name !== 'string' || name.length > 2000))) throw new Error('机型名称无效');
  }
  return { schema: 'radio-channel-library-v1', channels: value.channels, updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : new Date().toISOString() };
}
