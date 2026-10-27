import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import { exportWorkbook, importWorkbook } from './workbook';
import { demoWorkspace, newChannel } from './model';
import { parseProject } from './project';

describe('spreadsheets', () => {
  const local = '.deploy/private-fixtures/2605.xlsx';
  if (existsSync(local)) it('imports the user-provided K5-format workbook without publishing its contents', () => {
    const bytes = readFileSync(local);
    const result = importWorkbook(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, '2605写频表b.xlsx');
    expect(result.channels.length).toBeGreaterThan(100);
    expect(result.channels.find(c => c.slot === 1)?.rx).toBe('438.50000');
    expect(result.channels.find(c => c.slot === 3)?.rxTone).toBe('D252N');
    expect(result.detected).toBe('K5Web / K1');
  });
  it('round-trips the native workbook, including slot zero, group, note and tones', () => {
    const channels = demoWorkspace().channels;
    const bytes = exportWorkbook(channels, 'test');
    const out = importWorkbook(bytes.buffer as ArrayBuffer, 'test.xlsx');
    expect(out.channels).toEqual(channels);
  });
  it('maps K5 200 to zero and leaves 1–199 unchanged', () => {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['#', 'Name', 'RX Frequency', 'TX Frequency', 'RX Tone Type', 'RX Tone', 'TX Tone Type', 'TX Tone'], [200, 'ZERO', 438.5, 438.5, 'DCS', '23', 'DCS I', '754'], [1, 'ONE', 145.5, 145.5, '', '', '', '']]), 'K5Channel');
    const result = importWorkbook(XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer, 'K5Channel.xlsx');
    expect(result.channels[0].slot).toBe(0); expect(result.channels[1].slot).toBe(1);
    expect(result.channels[0].rxTone).toBe('D023N'); expect(result.channels[0].txTone).toBe('D754I');
  });
  it('rejects duplicate channels instead of silently discarding one', () => {
    const bytes = exportWorkbook([newChannel(2), newChannel(2)], 'bad');
    expect(() => importWorkbook(bytes.buffer as ArrayBuffer, 'bad.xlsx')).toThrow('重复');
  });
  it('honors the explicit DCS polarity suffix over a legacy type label', () => {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['#', '接收频率', '接收亚音频类型', '接收亚音数码'], [3, 438.5, 'DCSH', 'D252N']]), '写频表');
    const result = importWorkbook(XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer, 'legacy.xlsx');
    expect(result.channels[0].rxTone).toBe('D252N');
  });
  it('separates analog frequency and digital code columns, including inverted DCS and advanced flags', () => {
    const channel = { ...newChannel(7), rxTone: '94.8', txTone: 'D252I', pttId: 3, scanAdd: false, busy: true, signalCode: 12, optionalSignal: 2, muteMode: 1, scramble: true };
    const bytes = exportWorkbook([channel], 'test');
    const book = XLSX.read(bytes, { type: 'array' });
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(book.Sheets['D500信道']);
    expect(rows[0]['接收亚音频类型']).toBe('CTCSS');
    expect(rows[0]['接收亚音频(Hz)']).toBe('94.8');
    expect(rows[0]['发送亚音数码']).toBe('D252I');
    expect(importWorkbook(bytes.buffer as ArrayBuffer, 'test.xlsx').channels[0]).toEqual(channel);
  });
  it('rejects medium power for the V1 model', () => {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['接收频率', '功率'], [438.5, '中']]), 'D500');
    expect(() => importWorkbook(XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer, 'bad.xlsx')).toThrow('两档');
  });
});
describe('project backup', () => {
  it('restores a valid project', () => expect(parseProject(JSON.stringify(demoWorkspace())).channels).toHaveLength(6));
  it('rejects untrusted malformed project metadata', () => {
    expect(() => parseProject('{"schema":1,"name":"x","channels":[{}]}')).toThrow('字段');
  });

});
