import { validSnapshot, type RadioSnapshot, type WriteScope } from './radio';
import type { SerialApi, SerialPortLike } from './serial';

export const RADIO_STATE_KEY = 'ba7ktc-d500-radio-state-v1';
const SCOPE_KEY = 'ba7ktc-d500-write-scope-v1';
type PortInfo = ReturnType<SerialPortLike['getInfo']>;
export interface RadioState { snapshot: RadioSnapshot; portInfo: PortInfo | null }
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const storage = (): Store | null => { try { return globalThis.localStorage ?? null; } catch { return null; } };
export function loadRadioState(store = storage()): RadioState | null {
  try {
    const text = store?.getItem(RADIO_STATE_KEY); if (!text || text.length > 200000) return null;
    const state = JSON.parse(text) as RadioState;
    validSnapshot(state.snapshot);
    if (!Array.isArray(state.snapshot.identity) || state.snapshot.identity.length !== 49 || state.snapshot.identity.some(v => !Number.isInteger(v) || v < 0 || v > 255) || state.snapshot.identity[48] !== 0x55) return null;
    if (!['radio-read', 'write-ack'].includes(state.snapshot.source ?? 'radio-read') || !Number.isFinite(Date.parse(state.snapshot.capturedAt))) return null;
    if (state.portInfo !== null && (typeof state.portInfo !== 'object' || !state.portInfo || Object.values(state.portInfo).some(v => !Number.isInteger(v) || v < 0 || v > 65535))) return null;
    return state;
  } catch { return null; }
}
export function saveRadioState(state: RadioState | null, store = storage()): boolean {
  try {
    if (!store) return false;
    if (state) { validSnapshot(state.snapshot); store.setItem(RADIO_STATE_KEY, JSON.stringify(state)); }
    else store.removeItem(RADIO_STATE_KEY);
    return true;
  } catch { return false; }
}
export function samePort(a: PortInfo | null, b: PortInfo): boolean {
  return !!a && a.usbVendorId !== undefined && a.usbProductId !== undefined && a.usbVendorId === b.usbVendorId && a.usbProductId === b.usbProductId;
}
/** Reuse one previously granted USB port only after an explicit user action. */
export async function selectRadioPort(api: SerialApi, previous: PortInfo | null, change = false): Promise<SerialPortLike> {
  if (!change && api.getPorts) {
    try {
      const ports = (await api.getPorts()).filter(p => {
        const info = p.getInfo();
        return previous ? samePort(previous, info) : info.usbVendorId !== undefined && info.usbProductId !== undefined;
      });
      if (ports.length === 1) return ports[0];
    } catch { /* Fall back to the browser chooser when permission discovery fails. */ }
  }
  return api.requestPort();
}
export function loadWriteScope(store = storage()): WriteScope {
  try { const scope = store?.getItem(SCOPE_KEY); return scope === 'channels' || scope === 'settings' ? scope : 'all'; } catch { return 'all'; }
}
export function saveWriteScope(scope: WriteScope, store = storage()): void { try { store?.setItem(SCOPE_KEY, scope); } catch { /* The current selection still works without persistence. */ } }
