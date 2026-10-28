import type { Workspace } from './model';
import { parseDat } from './dat';
import { planWrite, snapshotDat, type RadioSnapshot, type WriteScope } from './radio';

/** Rebase on acknowledged writes, retaining pending edits from the other scope. */
export function acceptWriteResult(workspace: Workspace, snapshot: RadioSnapshot, scope: WriteScope): Workspace {
  const actual = parseDat(snapshotDat(snapshot), workspace.template?.fileName);
  const desired = { ...snapshot, bytes: [...snapshot.bytes] };
  for (const block of planWrite(snapshot, workspace).blocks) desired.bytes.splice(block.address, 16, ...block.after);
  const pending = parseDat(snapshotDat(desired));
  const local = new Map(workspace.channels.map(c => [c.slot, c]));
  return {
    ...workspace, template: actual.template, settings: pending.settings,
    channels: pending.channels.map(c => {
      const previous = local.get(c.slot);
      return { ...c, group: previous?.group ?? '', note: previous?.note ?? '',
        ...(scope === 'settings' ? previous?.sourceSlot === undefined ? {} : { sourceSlot: previous.sourceSlot } : { sourceSlot: c.slot }) };
    }),
    updatedAt: new Date().toISOString(),
  };
}
