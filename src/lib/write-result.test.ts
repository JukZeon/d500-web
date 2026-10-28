import { describe, expect, it } from 'vitest';
import { exportDat, parseDat, parseRows } from './dat';
import { emptyWorkspace, newChannel, type Workspace } from './model';
import { CONFIG_SIZE, planFileWrite, planWrite, scopePlan, type RadioSnapshot, type WriteScope } from './radio';
import { acceptWriteResult } from './write-result';

function setup() {
  const blank = Array.from({ length: 1025 }, (_, i) => [i >> 4, i % 16, i, ...Array(16).fill(255)].join(' ')).join('\n');
  const parsed = parseDat(exportDat([{ ...newChannel(0), name: 'TEST' }], parseDat(blank).template));
  const workspace: Workspace = { ...emptyWorkspace(), ...parsed };
  const bytes = parsed.template.rows.slice(0, CONFIG_SIZE / 16).flatMap(r => r.slice(3));
  const snapshot: RadioSnapshot = { schema: 'd500-radio-read-v1', identity: [], capturedAt: new Date().toISOString(), hardwareVerified: false, bytes };
  return { workspace, snapshot };
}
function written(workspace: Workspace, before: RadioSnapshot, scope: WriteScope) {
  const after = { ...before, bytes: [...before.bytes] };
  for (const b of scopePlan(planWrite(before, workspace), scope).blocks) after.bytes.splice(b.address, 16, ...b.after);
  return after;
}
describe('acknowledged write baseline', () => {
  it('allows a subsequent write to restore the original value instead of losing that edit', () => {
    const { workspace, snapshot } = setup();
    workspace.channels[0].name = 'EDIT'; workspace.channels[0].group = 'Local'; workspace.channels[0].note = 'Keep';
    const after = written(workspace, snapshot, 'all'), next = acceptWriteResult(workspace, after, 'all');
    expect(planWrite(after, next).blocks).toHaveLength(0);
    expect(next.channels[0].group).toBe('Local'); expect(next.channels[0].note).toBe('Keep');
    next.channels[0].name = 'TEST';
    expect(planWrite(after, next).blocks.map(b => b.address)).toEqual([0x1000]);
  });
  it('retains pending settings after writing channels, and pending channel moves after writing settings', () => {
    for (const scope of ['channels', 'settings'] as const) {
      const { workspace, snapshot } = setup();
      workspace.channels[0] = { ...workspace.channels[0], slot: 4, sourceSlot: 0, name: 'MOVE', note: 'Keep' };
      workspace.settings!.text = { boot: 'TEST' };
      const after = written(workspace, snapshot, scope), next = acceptWriteResult(workspace, after, scope);
      expect(next.channels[0].slot).toBe(4); expect(next.channels[0].note).toBe('Keep');
      expect(next.channels[0].sourceSlot).toBe(scope === 'channels' ? 4 : 0);
      expect(next.settings!.text!.boot).toBe('TEST');
      expect(parseRows(exportDat(next.channels, next.template, next.settings))).toEqual(parseRows(exportDat(workspace.channels, workspace.template, workspace.settings)));
      const pending = planWrite(after, next);
      expect(scopePlan(pending, scope).blocks).toHaveLength(0);
      expect(scopePlan(pending, scope === 'channels' ? 'settings' : 'channels').blocks.length).toBeGreaterThan(0);
    }
  });
  it('preserves a pending channel move when settings were written from a file without a channel baseline', () => {
    const original = setup(), rows = parseRows(original.workspace.template!.original);
    rows[0][3 + 14] |= 0x80;
    const parsed = parseDat(rows.map(r => r.join(' ')).join('\n'));
    const workspace = { ...original.workspace, ...parsed };
    workspace.channels[0] = { ...workspace.channels[0], slot: 4, sourceSlot: 0, name: 'MOVE' };
    workspace.settings!.text = { boot: 'TEST' };
    const expected = exportDat(workspace.channels, workspace.template, workspace.settings);
    const snapshot: RadioSnapshot = { ...original.snapshot, source: 'write-ack', knownScopes: ['settings'], bytes: parseRows(expected).slice(0,CONFIG_SIZE/16).flatMap(r=>r.slice(3)) };
    const next = acceptWriteResult(workspace, snapshot, 'settings');
    expect(next.channels[0].sourceSlot).toBe(4);
    expect(parseRows(exportDat(next.channels,next.template,next.settings))).toEqual(parseRows(expected));
    expect(planFileWrite(next,'channels').blocks.find(b=>b.address===4*16)!.after[14]&0x80).toBe(0x80);
  });
  it('retains settings from an imported file when only its channels have been written', () => {
    const { workspace, snapshot } = setup();
    const settings = {...workspace.settings!,text:{boot:'FILE'}};
    const loaded = parseDat(exportDat([{...workspace.channels[0],name:'FILE'}],workspace.template,settings));
    const target = {...workspace,...loaded}, after = {...snapshot,bytes:[...snapshot.bytes]};
    for(const b of planFileWrite(target,'channels').blocks) after.bytes.splice(b.address,16,...b.after);
    const next = acceptWriteResult(target,after,'channels');
    expect(next.settings!.text!.boot).toBe('FILE');
    expect(planWrite(after,next).blocks.map(b=>b.address)).toEqual([251*16]);
  });
});
