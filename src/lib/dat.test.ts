import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { parseDat, exportDat, encodeFrequency, decodeFrequency, encodeTone, decodeTone, parseRows } from './dat';
import { encodeName } from './encoding';
import { newChannel } from './model';

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
