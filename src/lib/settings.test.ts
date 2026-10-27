import { describe, expect, it } from 'vitest';
import { exportDat, parseDat, parseRows } from './dat';
import { emptyWorkspace, newChannel } from './model';
import { parseProject } from './project';
import { MENU_SETTINGS, VFO_SETTINGS, completeSettings, readSettings, settingsChanges, settingsFields, validateSettings } from './settings';
import { CONFIG_SIZE, describeWrite, planWrite, scopePlan, type RadioSnapshot } from './radio';

function fixture() {
  const rows = Array.from({ length: 1025 }, (_, row) => [row >> 4, row % 16, row, ...Array(16).fill(255)]);
  for (let row = 224; row < 228; row++) rows[row].fill(0, 3);
  for (let bank = 0; bank < 4; bank++) {
    rows[240 + bank * 2].splice(3, 14, ...[1, 4, 5, 5, 0, 0, 0, 0, 0, 0, 0, 6, 0, 0]);
    rows[241 + bank * 2].splice(3, 12, ...Array(12).fill(0));
  }
  rows[251].splice(3, 16, ...Array.from({ length: 16 }, (_, i) => 'TEST'[i]?.charCodeAt(0) ?? 32));
  const text = rows.map(r => r.join(' ')).join('\r\n') + '\r\n';
  const dat = parseDat(exportDat([newChannel(0)], parseDat(text).template));
  const workspace = { ...emptyWorkspace(), ...dat };
  const snapshot: RadioSnapshot = { schema: 'd500-radio-read-v1', capturedAt: '2026-10-28T00:00:00Z', hardwareVerified: false, identity: [], bytes: dat.template.rows.slice(0, CONFIG_SIZE / 16).flatMap(r => r.slice(3)) };
  return { workspace, snapshot };
}
describe('captured CPS ordinary settings', () => {
  it('distinguishes VFO decimal digit arrays from channel BCD and decodes offset/tone', () => {
    const { workspace } = fixture();
    expect(workspace.settings.vfo[0]).toMatchObject({ frequency: 14550000, offset: 600, rxTone: 0, txTone: 0 });
    expect(workspace.settings.text?.boot).toBe('TEST');
    expect(MENU_SETTINGS.find(d => d.key === '31')?.label).toBe('加发身份码');
    expect(MENU_SETTINGS.find(d => d.key === '51')?.label).toBe('信道同步显示');
    expect(MENU_SETTINGS.find(d => d.key === '52')?.label).toBe('手咪增益');
    expect(MENU_SETTINGS.find(d => d.key === '56')?.label).toBe('蓝牙适配器');
    expect(MENU_SETTINGS.find(d => d.key === '57')?.options).toHaveLength(251);
  });
  it('round-trips all new fields and changes only their exact byte ranges', () => {
    const { workspace } = fixture();
    const settings = structuredClone(workspace.settings);
    settings.vfo[0] = { ...settings.vfo[0], frequency: 43955000, offset: 5000, rxTone: 106, txTone: 885, scramble: 1 };
    settings.text = { boot: 'BA7KTC' };
    settings.menu['57'] = 30; settings.menu['58'] = 2; settings.menu['59'] = 1;
    const result = exportDat(workspace.channels, workspace.template, settings), rows = parseRows(result), restored = readSettings(rows);
    expect(restored).toEqual(settings);
    expect(rows[240].slice(3, 17)).toEqual([4, 3, 9, 5, 5, 0, 0, 0, 0, 0, 5, 0, 0, 0]);
    expect(rows[241].slice(3, 7)).toEqual([106, 0, 117, 3]);
    for (let r = 0; r < rows.length; r++) for (let b = 0; b < 16; b++) {
      if (rows[r][b + 3] !== workspace.template.rows[r][b + 3]) expect(settingsFields(r).some(f => f.includes(b))).toBe(true);
    }
    expect(exportDat(workspace.channels, workspace.template, workspace.settings)).toBe(workspace.template.original);
  });
  it('validates changed frequencies, tones, offsets and boot text without rewriting unknown original values', () => {
    const { workspace } = fixture(), old = workspace.settings;
    for (const patch of [{ frequency: 0 }, { offset: 100000 }, { rxTone: 555 }, { txTone: 65535 }]) {
      const next = structuredClone(old); Object.assign(next.vfo[0], patch);
      expect(validateSettings(next, old).length).toBeGreaterThan(0);
    }
    for (const boot of ['中文', 'ABCDEFGHIJKLMNOP', '\n']) expect(validateSettings({ ...old, text: { boot } }, old).length).toBeGreaterThan(0);
    const raw = structuredClone(old); raw.vfo[0].rxTone = 65535; raw.menu['58'] = 255;
    expect(validateSettings(raw, raw)).toEqual([]);
  });
  it('restores old projects with newly mapped fields inherited from their DAT', () => {
    const { workspace } = fixture();
    const legacy = structuredClone(workspace);
    legacy.settings.text = undefined;
    for (const v of legacy.settings.vfo) for (const key of ['frequency', 'offset', 'rxTone', 'txTone', 'scramble']) delete v[key];
    for (const key of ['57', '58', '59', '61']) delete legacy.settings.menu[key];
    const restored = parseProject(JSON.stringify(legacy));
    expect(restored.settings).toEqual(workspace.settings);
    expect(settingsChanges(legacy.settings, workspace.settings)).toBe(0);
    expect(completeSettings(legacy.settings, workspace.settings)).toEqual(workspace.settings);
  });
  it('treats the entire VFO frequency and boot text as indivisible conflict fields', () => {
    const { workspace, snapshot } = fixture();
    workspace.settings.vfo[0].frequency = 43955000;
    snapshot.bytes[240 * 16 + 7] = 5;
    expect(() => planWrite(snapshot, workspace)).toThrow('冲突');
    workspace.settings.vfo[0].frequency = 14550000;
    workspace.settings.text = { boot: 'BA7KTC' }; snapshot.bytes[251 * 16 + 14] = 33;
    expect(() => planWrite(snapshot, workspace)).toThrow('冲突');
  });
  it('reviews changes using channel and setting labels rather than protocol bytes', () => {
    const { workspace, snapshot } = fixture();
    workspace.channels[0].rx = '439.55000'; workspace.settings.vfo[0].txTone = 210; workspace.settings.text = { boot: 'BA7KTC' };
    const changes = describeWrite(snapshot, planWrite(snapshot, workspace));
    expect(changes).toContainEqual({ target: '信道 000', field: '接收频率', before: '438.50000 MHz', after: '439.55000 MHz' });
    expect(changes).toContainEqual({ target: 'A 区', field: '发射哑音', before: '关闭 / 空', after: 'D754I' });
    expect(changes).toContainEqual({ target: '开机显示', field: '文字', before: 'TEST', after: 'BA7KTC' });
  });
  it('isolates settings and channel write scopes and preserves reserved bytes', () => {
    const { workspace, snapshot } = fixture();
    workspace.channels[0].rx = '439.55000'; workspace.settings.vfo[0].txTone = 885;
    snapshot.bytes[241 * 16 + 15] = 42;
    const plan = planWrite(snapshot, workspace), settings = scopePlan(plan, 'settings'), channels = scopePlan(plan, 'channels');
    expect(channels.blocks.map(b => b.address)).toEqual([0]);
    expect(settings.blocks.map(b => b.address)).toEqual([241 * 16]);
    expect(settings.blocks[0].after[15]).toBe(42);
    expect(settings.changedBytes + channels.changedBytes).toBe(plan.changedBytes);
    expect(VFO_SETTINGS).toHaveLength(8);
  });
});
