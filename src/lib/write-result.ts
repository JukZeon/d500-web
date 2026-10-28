import type { Workspace } from './model';
import { exportDat, parseDat, parseRows } from './dat';
import { type RadioSnapshot, type WriteScope } from './radio';

/** Rebase on acknowledged writes, retaining pending edits from the other scope. */
export function acceptWriteResult(workspace: Workspace, snapshot: RadioSnapshot, _scope: WriteScope): Workspace {
  if (!workspace.template) throw new Error('缺少 DAT 模板');
  const rows = parseRows(workspace.template.original);
  const desired = parseRows(exportDat(workspace.channels, workspace.template, workspace.settings));
  for (let row = 0; row < snapshot.bytes.length / 16; row++) rows[row].splice(3, 16, ...snapshot.bytes.slice(row * 16, row * 16 + 16));
  const actual = parseDat(rows.map(r => r.join(' ')).join('\r\n') + '\r\n', workspace.template.fileName);
  return {
    ...workspace, template: actual.template,
    channels: workspace.channels.map(c => {
      const applied = [c.slot, 256 + c.slot].every(row => rows[row].slice(3).every((v,i) => v === desired[row][i+3]));
      return applied ? { ...c, sourceSlot: c.slot } : c;
    }),
    updatedAt: new Date().toISOString(),
  };
}
