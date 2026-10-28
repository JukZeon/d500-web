import type { Workspace } from './model';
import { exportDat, parseDat } from './dat';
import { hasWriteBaseline, snapshotDat, type RadioSnapshot, type WriteScope } from './radio';

/** Rebase on acknowledged writes, retaining pending edits from the other scope. */
export function acceptWriteResult(workspace: Workspace, snapshot: RadioSnapshot, scope: WriteScope): Workspace {
  const actual = parseDat(snapshotDat(snapshot), workspace.template?.fileName);
  const channels = workspace.channels.map(c => scope === 'settings' && hasWriteBaseline(snapshot, 'channels') ? c : { ...c, sourceSlot: c.slot });
  const pending = parseDat(exportDat(channels, actual.template, workspace.settings));
  const local = new Map(workspace.channels.map(c => [c.slot, c]));
  return {
    ...workspace, template: actual.template, settings: pending.settings,
    channels: pending.channels.map(c => {
      const previous = local.get(c.slot);
      return { ...c, group: previous?.group ?? '', note: previous?.note ?? '',
        ...(scope === 'settings' && hasWriteBaseline(snapshot, 'channels') ? previous?.sourceSlot === undefined ? {} : { sourceSlot: previous.sourceSlot } : { sourceSlot: c.slot }) };
    }),
    updatedAt: new Date().toISOString(),
  };
}
