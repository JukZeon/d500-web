import { describe, expect, it } from 'vitest';
import { channelIssues, fromD500, editedChannels, makeChirpChannel, parseChirpDraft, importChirpTable, type ChirpFeatures, type ChirpDocument, type ChirpDraft } from './chirp';
import { newChannel } from './model';
import * as XLSX from 'xlsx';
const f: ChirpFeatures = { bounds:[1,1000],nameLength:7,characters:' ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',modes:['FM','NFM'],bands:[[136e6,174e6],[400e6,520e6]],powers:['High','Low','Medium'],steps:[2.5,5,6.25],skips:['','S'],tones:[88.5],dtcs:[23],hasSettings:true,hasStep:false };
const channel=makeChirpChannel(1,f);
const doc: ChirpDocument={schema:'radio-workbench-chirp-v1',model:'uv5rh',driverRevision:'test',features:f,channels:[channel],settings:[],image:'test',firmware:'',settingsLimited:false};
const draft: ChirpDraft={name:'Test',document:doc,channels:[channel],settings:{}};
function table(rows:unknown[][]){const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(rows),'信道');return XLSX.write(wb,{type:'array',bookType:'xlsx'}) as ArrayBuffer;}
describe('CHIRP model-aware workspaces',()=>{
  it('shifts D500 slot zero only for one-based models and converts DCS polarity',()=>{const c={...newChannel(0),name:'RELAY',rxTone:'D023I',power:'low' as const};const result=fromD500([c],f)[0];expect(result.number).toBe(1);expect(result.rxTone).toBe('D023R');expect(result.power).toBe('Low');expect(fromD500([c],{...f,bounds:[0,127]})[0].number).toBe(0);});
  it('isolates draft models',()=>{expect(()=>parseChirpDraft(JSON.stringify(draft),'uv5r')).toThrow('型号');expect(parseChirpDraft(JSON.stringify(draft),'uv5rh').channels.length).toBe(1);});
  it('rejects number/name/frequency conflicts but preserves existing unchanged long names',()=>{const c={...channel,name:'TOOLONGNAME'};expect(channelIssues([c],f)).toContain('信道 1 名称超出长度或字符范围');expect(channelIssues([c],f,[c])).toEqual([]);expect(channelIssues([channel,{...channel}],f)).toContain('信道 1 编号重复');expect(channelIssues([{...channel,number:1001}],f).length).toBeGreaterThan(0);expect(channelIssues([{...channel,rx:'100'}],f).length).toBeGreaterThan(0);});
  it('imports separate CTCSS and DCS columns from the existing D500 table',()=>{const [c]=importChirpTable(table([['信道编号','名称','接收频率','发射频率','接收亚音频类型','接收亚音频(Hz)','接收亚音数码','发送亚音类型','发送亚音频(Hz)','发送亚音数码'],[1,'TEST',439.125,434.125,'DCS','', 'D023I','CTCSS',88.5,'']]),f);expect(c.rxTone).toBe('D023R');expect(c.txTone).toBe('88.5');});
  it('allows RX-only and reports only modified/deleted records',()=>{expect(channelIssues([{...channel,tx:''}],f)).toEqual([]);expect(editedChannels(draft)).toEqual([]);expect(editedChannels({...draft,channels:[{...channel,empty:true}]})).toHaveLength(1);});
  it('imports more than 200 channels without D500 limits',()=>{const result=importChirpTable(table([['信道编号','名称','接收频率','发射频率'],...Array.from({length:1000},(_,i)=>[i+1,`CH${i+1}`,'438.5',''])]),f);expect(result).toHaveLength(1000);expect(result[999].number).toBe(1000);expect(result[0].tx).toBe('');});
  it('rejects missing TX column and ambiguous CHIRP CSV',()=>{expect(()=>importChirpTable(table([['名称','接收频率'],['A',438.5]]),f)).toThrow('发射频率');expect(()=>importChirpTable(table([['Name','Frequency','Duplex'],['A',438.5,'-']]),f)).toThrow('IMG');});
  it('imports independent tones, preserving explicit RX-only',()=>{const [c]=importChirpTable(table([['信道编号','名称','接收频率','发射频率','发射哑音','接收哑音','带宽','功率'],[23,'RELAY',439.125,'','88.5','D023I','窄带','中']]),f);expect(c).toMatchObject({number:23,tx:'',txTone:'88.5',rxTone:'D023R',mode:'NFM',power:'Medium'});});
  it('imports BOM-less Chinese CSV and pasted TSV without mangling headers or groups',()=>{
    for(const separator of [',','\t']){
      const text=[['信道编号','名称','接收频率','发射频率','发射哑音','分组'],['1','TEST','439.125','','88.5','广州']].map(row=>row.join(separator)).join('\n');
      const data=new TextEncoder().encode(text).buffer as ArrayBuffer;
      expect(importChirpTable(data,f)[0]).toMatchObject({number:1,name:'TEST',tx:'',txTone:'88.5',group:'广州'});
    }
  });
  it('imports UTF-16 text with a BOM',()=>{
    const text='信道编号\t名称\t接收频率\t发射频率\n1\tTEST\t439.125\t434.125';
    const bytes=new Uint8Array(2+text.length*2);bytes.set([255,254]);const view=new DataView(bytes.buffer);for(let i=0;i<text.length;i++)view.setUint16(2+i*2,text.charCodeAt(i),true);
    expect(importChirpTable(bytes.buffer,f)[0].name).toBe('TEST');
  });

});
