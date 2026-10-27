import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { parseDat, exportDat, encodeFrequency, decodeFrequency, encodeTone, decodeTone, parseRows } from './dat';
import { encodeName } from './encoding';
import { newChannel } from './model';
import { MENU_SETTINGS, VFO_SETTINGS } from './settings';
import { parseProject } from './project';

export function fixture(): string {
  const rows = Array.from({ length: 1025 }, (_, i) => [Math.floor(i / 16), i % 16, i, ...Array(16).fill(255) as number[]]);
  rows[0].splice(3, 16, ...encodeFrequency('438.50000'), ...encodeFrequency('433.50000'), 117, 3, 1, 0, 171, 205, 2, 0b10101100);
  const name = encodeName('测试信道'); rows[256].splice(3, 16, ...Array.from({ length: 16 }, (_, i) => name[i] ?? 255));
  rows[700].splice(3, 16, ...Array.from({ length: 16 }, (_, i) => i * 7));
  return rows.map(r => r.map(v => ` ${v} `).join('')).join('\r\n') + '\r\n';
}
describe('DAT integrity', () => {
  it('preserves every byte when unchanged', () => {
    const text = fixture(), parsed = parseDat(text);
    expect(exportDat(parsed.channels, parsed.template)).toBe(text);
    expect(parsed.channels[0].name).toBe('测试信道');
    expect(parsed.channels[0].rxTone).toBe('88.5');
  });
  it('preserves a UTF-8 BOM and alternative whitespace in unchanged files', () => {
    const text = '\uFEFF' + fixture().replaceAll('  ', '\t');
    const { channels, template } = parseDat(text);
    expect(exportDat(channels, template)).toBe(text);
  });
  it('changes only the intended frequency bytes and retains unknown fields', () => {
    const text = fixture(), { channels, template } = parseDat(text), before = parseRows(text);
    channels[0].rx = '439.55000';
    const after = parseRows(exportDat(channels, template));
    expect(after[0].slice(7)).toEqual(before[0].slice(7));
    expect(after.slice(1)).toEqual(before.slice(1));
    expect(decodeFrequency(after[0].slice(3, 7))).toBe('439.55000');
  });
  it('preserves unedited flag bits, and changes only the bandwidth bit', () => {
    const { channels, template } = parseDat(fixture()); channels[0].bandwidth = 'narrow';
    const after = parseRows(exportDat(channels, template));
    expect(after[0][18]).toBe(0b11101100);
  });
  it('clears removed channels and their names, retaining config rows', () => {
    const { template } = parseDat(fixture()), after = parseRows(exportDat([], template));
    expect(after[0].slice(3)).toEqual(Array(16).fill(255));
    expect(after[256].slice(3)).toEqual(Array(16).fill(255));
    expect(after[700]).toEqual(template.rows[700]);
  });
  it('rejects unsupported or malformed DAT instead of partially importing', () => {
    expect(() => parseDat('not a dat')).toThrow('1025');
    expect(() => parseDat(fixture().replace(' 0  0  0 ', ' 0  0  1 '))).toThrow('地址');
    expect(() => parseDat(fixture().replace(' 171 ', ' 999 '))).toThrow('字节');
  });
  it('requires a user template and rejects duplicate slots', () => {
    expect(() => exportDat([newChannel(1)], null)).toThrow('模板');
    expect(() => exportDat([newChannel(1), newChannel(1)], parseDat(fixture()).template)).toThrow('重复');
  });
  it('retains receive-only channels', () => {
    const { channels, template } = parseDat(fixture()); channels[0].tx = '';
    const out = exportDat(channels, template); expect(parseDat(out).channels[0].tx).toBe('');
  });
  it('duplicates a channel with all unknown bytes and original name encoding preserved', () => {
    const { channels, template } = parseDat(fixture());
    const duplicate = { ...channels[0], slot: 17 };
    const rows = parseRows(exportDat([...channels, duplicate], template));
    expect(rows[17].slice(3)).toEqual(template.rows[0].slice(3));
    expect(rows[273].slice(3)).toEqual(template.rows[256].slice(3));
  });
  it('copies raw provenance even when both slots have identical visible fields', () => {
    const rows = parseRows(fixture());
    rows[1].splice(3, 16, ...rows[0].slice(3)); rows[1][15] ^= 16;
    rows[257].splice(3, 16, ...rows[256].slice(3));
    const parsed = parseDat(rows.map(r => r.join(' ')).join('\n'));
    const result = parseRows(exportDat([parsed.channels[0], { ...parsed.channels[0], slot: 1 }], parsed.template));
    expect(result[1].slice(3)).toEqual(rows[0].slice(3));
  });
  it('moves a channel without losing unknown flags and clears its old slot', () => {
    const { channels, template } = parseDat(fixture());
    const rows = parseRows(exportDat([{ ...channels[0], slot: 19 }], template));
    expect(rows[19].slice(3)).toEqual(template.rows[0].slice(3));
    expect(rows[275].slice(3)).toEqual(template.rows[256].slice(3));
    expect(rows[0].slice(3)).toEqual(Array(16).fill(255));
  });
  it('decodes V1 power from the low two bits, preserving scrambler and reserved bits', () => {
    const rows = parseRows(fixture());
    rows[0][17] = 0b11110001;
    const text = rows.map(r => r.join(' ')).join('\r\n');
    const { channels, template } = parseDat(text);
    expect(channels[0].power).toBe('low');
    expect(channels[0].scramble).toBe(true);
    channels[0].power = 'high';
    expect(parseRows(exportDat(channels, template))[0][17]).toBe(0b11110000);
  });
  it.each([
    ['scanAdd', false, 15, 4, 0], ['pttId', 3, 15, 3, 3],
    ['busy', false, 15, 8, 0], ['signalCode', 4, 12, 15, 4],
    ['optionalSignal', 2, 13, 15, 2], ['muteMode', 1, 13, 240, 16],
    ['scramble', true, 14, 16, 16],
  ] as const)('patches only the documented %s field', (field, value, byte, mask, encoded) => {
    const { channels, template } = parseDat(fixture());
    const before = template.rows;
    Object.assign(channels[0], { [field]: value });
    const after = parseRows(exportDat(channels, template));
    expect(after[0][3 + byte]).toBe(before[0][3 + byte] & ~mask | encoded);
    for (let i = 0; i < 19; i++) if (i !== byte + 3) expect(after[0][i]).toBe(before[0][i]);
    expect(after.slice(1)).toEqual(before.slice(1));
    expect(parseDat(exportDat(channels, template)).channels[0][field]).toBe(value);
  });
  it('patches every exposed menu and VFO setting at its documented location only', () => {
    for (const d of MENU_SETTINGS) {
      const { channels, template, settings } = parseDat(fixture());
      settings.menu[d.key] = d.options.length - 1;
      const after = parseRows(exportDat(channels, template, settings));
      const expected = structuredClone(template.rows);
      expected[224 + Math.floor(Number(d.key) / 16)][3 + Number(d.key) % 16] = d.options.length - 1;
      expect(after).toEqual(expected);
    }
    for (let bank = 0; bank < 4; bank++) for (const d of VFO_SETTINGS) {
      const { channels, template, settings } = parseDat(fixture());
      settings.vfo[bank][d.key] = d.options.length - 1;
      const after = parseRows(exportDat(channels, template, settings));
      const expected = structuredClone(template.rows);
      expected[241 + bank * 2][3 + d.byte] = d.options.length - 1;
      expect(after).toEqual(expected);
    }
  });
  it('preserves unfamiliar device values unchanged and rejects new out-of-range values', () => {
    const { channels, template, settings } = parseDat(fixture());
    expect(exportDat(channels, template, settings)).toBe(fixture());
    settings.menu['2'] = 254;
    expect(() => exportDat(channels, template, settings)).toThrow('SQL');
  });
  it('migrates old three-power drafts against the original V1 template', () => {
    const rows = parseRows(fixture()); rows[0][17] = 1;
    const { channels, template } = parseDat(rows.map(r => r.join(' ')).join('\n'));
    const oldChannel = { ...channels[0], power: 'mid' };
    for (const key of ['scanAdd', 'pttId', 'signalCode', 'optionalSignal', 'muteMode', 'scramble']) delete (oldChannel as Record<string, unknown>)[key];
    const restored = parseProject(JSON.stringify({ schema: 1, name: 'legacy', channels: [oldChannel], template }));
    expect(restored.schema).toBe(2);
    expect(restored.channels[0]).toEqual(channels[0]);
    expect(exportDat(restored.channels, restored.template, restored.settings)).toBe(template.original);
  });
  it('enforces the verified V1 8-byte edit limit without truncating imported long names', () => {
    const { channels, template } = parseDat(fixture());
    channels[0].name = '一二三四五';
    expect(() => exportDat(channels, template)).toThrow('8 字节');
    const rows = parseRows(fixture()); rows[256].splice(3, 16, ...encodeName('一二三四五六七八'));
    const text = rows.map(r => r.join(' ')).join('\n'), long = parseDat(text);
    expect(exportDat(long.channels, long.template)).toBe(text);
    long.channels[0].rx = '438.51250';
    expect(parseRows(exportDat(long.channels, long.template))[256]).toEqual(rows[256]);
    expect(parseDat(exportDat([{ ...long.channels[0], slot: 17 }], long.template)).channels[0].name).toBe('一二三四五六七八');
  });
  it('restores edited device settings and rejects invalid setting values', () => {
    const parsed = parseDat(fixture());
    parsed.settings.menu['2'] = 5;
    parsed.settings.vfo[2].power = 1;
    const saved = { schema: 2, name: 'settings', ...parsed };
    const restored = parseProject(JSON.stringify(saved));
    expect(restored.settings).toEqual(parsed.settings);
    expect(parseDat(exportDat(restored.channels, restored.template, restored.settings)).settings).toEqual(parsed.settings);
    parsed.settings.menu['2'] = 300;
    expect(() => parseProject(JSON.stringify({ ...saved, settings: parsed.settings }))).toThrow('电台设置');
  });
  for (const name of ['KTC.dat', '出厂值参考.dat']) {
    const path = `.deploy/private-fixtures/${name}`;
    if (existsSync(path)) it(`round-trips local V1 export ${name} without changing a byte`, () => {
      const text = readFileSync(path, 'utf8'), { channels, template } = parseDat(text);
      expect(channels.length).toBeGreaterThan(0);
      expect(exportDat(channels, template)).toBe(text);
      const changed = channels.map((c, i) => i === 0 ? { ...c, rx: '438.51250' } : c);
      const rows = parseRows(exportDat(changed, template));
      expect(rows.slice(200)).toEqual(template.rows.slice(200));
      expect(parseDat(exportDat(changed, template)).channels[0].rx).toBe('438.51250');
    });
  }
});
describe('field encodings', () => {
  it('uses 10 Hz precision and rejects silent rounding', () => {
    expect(decodeFrequency(encodeFrequency('145.61250'))).toBe('145.61250');
    expect(() => encodeFrequency('145.123456')).toThrow('5');
    expect(() => encodeFrequency('-145')).toThrow();
  });
  it('round-trips CTCSS and normal/inverted DCS', () => {
    for (const tone of ['', '88.5', 'D023N', 'D754I']) expect(decodeTone(encodeTone(tone))).toBe(tone);
    expect(() => encodeTone('D999N')).toThrow();
  });
  it('supports GBK Chinese and rejects overflow or unsupported characters', () => {
    expect(encodeName('一二三四五六七八')).toHaveLength(16);
    expect(() => encodeName('一二三四五六七八九')).toThrow('16');
    expect(() => encodeName('😀')).toThrow('不支持');
  });
});
