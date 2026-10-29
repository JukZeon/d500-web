import {describe,it,expect} from 'vitest';
import strings from './test-data/radio-settings-strings.json';
import {radioLabel} from './radio-labels';
// Text-only driver vocabulary: labels, declared enum choices and help text.
// No current setting values, channel contents or personal IMG data are included.
describe('radio setting display translations',()=>{
 it('translates all captured labels, list choices and descriptions across five handheld drivers',()=>{
  const untranslated=strings.filter(s=>/[A-Za-z]/.test(s)&&!/\p{Script=Han}/u.test(radioLabel(s))&&!/^[+\-]?[\d.]+\s*dB$/i.test(s));
  expect(untranslated).toEqual([]);
 });
 it('keeps distinct raw options distinguishable after translation',()=>{
  for(const options of [['Off','BOT','EOT','Both'],['Name','Frequency','Channel'],['Time','Carrier','Search'],['OFF','DT-ST','ANI-ST','DT+ANI']])expect(new Set(options.map(radioLabel)).size).toBe(options.length);
 });
 it('does not translate arbitrary user text or mutate the driver option values',()=>{
  const options=['Off','BOT','EOT','Both'],before=[...options];
  expect(options.map(value=>({value,label:radioLabel(value)}))).toContainEqual({value:'BOT',label:'按下发射键时'});expect(options).toEqual(before);
  expect(radioLabel('BA7KTC')).toBe('BA7KTC');expect(radioLabel('我的开机文字')).toBe('我的开机文字');expect(radioLabel('145.500 MHz')).toBe('145.500 MHz');
 });
});
