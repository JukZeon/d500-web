import { describe, expect, it } from 'vitest';
import { editedChannels, makeChirpChannel } from './chirp';
import { emptyWorkspace, newChannel } from './model';
import { parseProject } from './project';
import { applyChirpTransfer, applyD500Transfer, baselineFeatures, channelIdentity, compatibleName, currentNameFeatures, d500Channel, emptyLibrary, managedChirp, managedD500, mergeLibrary, offlineDraft, parseLibrary, planTransfer, replaceChirpChannels, type ManagedChannel } from './shared-channels';
const row=(number=0):ManagedChannel=>({...managedD500([{...newChannel(number),name:'A中继',rx:'439.12500',tx:'434.12500',rxTone:'D023I',txTone:'88.5',group:'广州'}])[0]});
describe('shared channel library and cross-model plans',()=>{
 it('normalizes frequency precision and DCS polarity without combining different tones',()=>{
  expect(channelIdentity(row())).toBe(channelIdentity({...row(),rx:'439.125000',rxTone:'D023R'}));
  expect(channelIdentity(row())).not.toBe(channelIdentity({...row(),rxTone:'D025I'}));
  expect(channelIdentity(row())).not.toBe(channelIdentity({...row(),tx:''}));
 });
 it('updates a library record without changing its stable ID or aliases',()=>{
  const library=mergeLibrary(emptyLibrary(),[row()],()=> 'library-one');library.channels[0].aliases={uv5r:'GZ-A'};
  const updated=mergeLibrary(library,[{...row(),name:'广州中继'}],()=> 'unused');
  expect(updated.channels).toHaveLength(1);expect(updated.channels[0]).toMatchObject({id:'library-one',name:'广州中继',aliases:{uv5r:'GZ-A'}});
  expect(library.channels[0].name).toBe('A中继');
 });
 it('keeps a full library name when a second model supplies an ASCII alias',()=>{
  const library=mergeLibrary(emptyLibrary(),[row()],()=> 'library-one');
  const result=mergeLibrary(library,[{...row(),sourceModel:'uv5r',name:'GZ-A',libraryId:'library-one'}]);
  expect(result.channels[0]).toMatchObject({name:'A中继',aliases:{uv5r:'GZ-A'}});
 });
 it('supports offline drafts for every handheld without inventing a writable image',()=>{
  for(const model of ['uv5r','uv5rh','uvk5-stock','uvk5-losehu','uvk5-egzumer'] as const){
   const draft=offlineDraft(model);expect(draft.document.image).toBe('');expect(draft.document.features.bounds[1]).toBeGreaterThan(100);expect(draft.channels).toEqual([]);
  }
 });
 it('previews incompatible names and applies per-model aliases without truncating source names',()=>{
  const source=row(),bad=planTransfer([source],'uv5r',[],{mode:'merge'});
  expect(bad[0].errors.some(s=>s.includes('名称'))).toBe(true);expect(source.name).toBe('A中继');
  const good=planTransfer([{...source,aliases:{uv5r:'GZ-A'}}],'uv5r',[],{mode:'merge'});
  expect(good[0].errors).toEqual([]);expect(good[0].channel.name).toBe('GZ-A');
 });
 it('generates an explicit compatible name while leaving the original intact',()=>{
  expect(compatibleName('ABCDEFGHIJK','uv5r',0)).toBe('ABCDEFG');
  expect(compatibleName('广州中继','uv5r',1)).toBe('CH001');
  expect(compatibleName('广州中继','d500',1)).toBe('广州中继');
 });
 it('appends only to vacant positions and reports capacity without reusing a slot',()=>{
  const source=Array.from({length:3},(_,i)=>({...row(i),name:'TEST'}));
  const plan=planTransfer(source,'uv5r',[{...row(126)},{...row(127)}],{mode:'append',start:125});
  expect(plan.map(p=>p.channel.number)).toEqual([125,128,129]);expect(plan[0].errors).toEqual([]);expect(plan[1].errors.some(s=>s.includes('容量'))).toBe(true);
 });
 it('shifts zero-based source numbering for one-based targets and reverses it',()=>{
  const first=planTransfer([{...row(),name:'TEST'}],'uv5rh',[],{mode:'merge'})[0];expect(first.channel.number).toBe(1);
  expect(planTransfer([first.channel],'d500',[],{mode:'merge'})[0].channel.number).toBe(0);
  expect(planTransfer([{...row(150),name:'MARINE'}],'uv5rh',[],{mode:'merge'})[0].channel.number).toBe(151);
 });
 it('reports duplicate target numbers in a mixed-source merge',()=>{
  const plan=planTransfer([{...row(),name:'A'},{...row(1),sourceModel:'uv5rh',name:'B'}],'uv5r',[],{mode:'merge'});
  expect(plan[1].errors.some(s=>s.includes('重复目标编号'))).toBe(true);
 });
 it('blocks unsupported receive/transmit bands and modes',()=>{
  const cases=[{...row(),name:'AIR',rx:'118.125',tx:'',mode:'AM'},{...row(),name:'BADTX',tx:'999.5'}];
  const plan=planTransfer(cases,'uv5r',[],{mode:'append'});
  expect(plan[0].errors.some(s=>s.includes('频率')||s.includes('AM'))).toBe(true);expect(plan[1].errors.some(s=>s.includes('发射频率'))).toBe(true);
 });
 it('shows a low-power fallback for a target without medium power',()=>{
  const plan=planTransfer([{...row(),name:'TEST',power:'medium'}],'uv5r',[],{mode:'merge'});
  expect(plan[0].channel.power).toBe('low');expect(plan[0].warnings).toHaveLength(1);
 });
 it('copies from CHIRP to D500 without false frequency-precision failures or polarity loss',()=>{
  const f=baselineFeatures('uv5rh'),native={...makeChirpChannel(1,f),name:'TEST',rx:'439.125000',tx:'434.125000',rxTone:'D023R'};
  const plan=planTransfer(managedChirp([native],'uv5rh'),'d500',[],{mode:'merge'});
  expect(plan[0].errors).toEqual([]);expect(d500Channel(plan[0].channel)).toMatchObject({slot:0,rx:'439.12500',rxTone:'D023I'});
 });
 it('does not round unrepresentable 1 Hz frequencies for D500',()=>{
  const plan=planTransfer([{...row(),name:'TEST',rx:'439.125001'}],'d500',[],{mode:'merge'});
  expect(plan[0].errors.some(s=>s.includes('精度'))).toBe(true);
 });
 it('preserves D500 settings, template and destination advanced fields when applying channels',()=>{
  const original={...newChannel(0),busy:true,pttId:3,sourceSlot:0};
  const workspace={...emptyWorkspace(),channels:[original,newChannel(9)],settings:{menu:{squelch:5},vfo:[]}};
  const changed=applyD500Transfer(workspace,[{...row(),name:'UPDATED'}],'merge');
  expect(changed.settings).toBe(workspace.settings);expect(changed.template).toBe(workspace.template);expect(changed.channels[0]).toMatchObject({busy:true,pttId:3,sourceSlot:0,name:'UPDATED'});expect(changed.channels).toHaveLength(2);
  expect(applyD500Transfer(workspace,[row()],'replace').channels).toHaveLength(1);expect(workspace.channels).toHaveLength(2);
 });
 it('retains target driver extras and deletion tombstones on replacement',()=>{
  const draft=offlineDraft('uv5rh'),f=draft.document.features;
  draft.channels=[{...makeChirpChannel(1,f),extraEdits:{'/tx/field':[7]}},makeChirpChannel(2,f)];
  const next=applyChirpTransfer(draft,[{...row(1),name:'TEST',sourceModel:'uv5rh'}],'replace');
  expect(next.document).toBe(draft.document);expect(next.settings).toBe(draft.settings);expect(next.channels.find(c=>c.number===1)?.extraEdits).toEqual({'/tx/field':[7]});expect(next.channels.find(c=>c.number===2)?.empty).toBe(true);
  expect(next.channels[0].rxTone).toBe('D023R');expect(next.channels[0].group).toBe('广州');
 });
 it('retains channel-specific extras when moving within the same profile',()=>{
  const f=baselineFeatures('uv5rh'),before={...makeChirpChannel(1,f),extraEdits:{'/example':[true]}};
  const rows=managedChirp([before],'uv5rh').map(c=>({...c,number:5}));
  const result=replaceChirpChannels([before],rows,f);
  expect(result.find(c=>c.number===1)?.empty).toBe(true);expect(result.find(c=>c.number===5)?.extraEdits).toEqual(before.extraEdits);
 });
 it('roundtrips shared libraries with groups, notes and aliases; rejects corrupt records',()=>{
  const library=mergeLibrary(emptyLibrary(),[{...row(),note:'RELAY',aliases:{uv5r:'GZ-A'}}],()=> 'library-one');
  expect(parseLibrary(JSON.stringify(library))).toEqual(library);
  expect(()=>parseLibrary(JSON.stringify({...library,channels:[...library.channels,...library.channels]}))).toThrow('无效');
  expect(()=>parseLibrary(JSON.stringify({...library,channels:[{...row(),aliases:{unknown:'BAD'}}]}))).toThrow('机型名称');
 });
 it('updates linked channels in place after their frequency changes; appends only new entries',()=>{
  const source={...row(),id:'library-one',libraryId:'library-one',name:'UPDATED',rx:'439.25000'};
  const target=[{...row(45),id:'uv5rh:45',sourceModel:'uv5rh' as const,libraryId:'library-one'}];
  const plan=planTransfer([source,{...row(1),id:'library-two',libraryId:'library-two',name:'NEW'}],'uv5rh',target,{mode:'sync'});
  expect(plan.map(p=>p.channel.number)).toEqual([45,1]);expect(plan[0].overwrites).toBe(true);expect(plan[0].channel.libraryId).toBe('library-one');
 });
 it('links a matching unassociated channel without duplicating it',()=>{
  const source={...row(),id:'library-one',name:'TEST'};
  const plan=planTransfer([source],'uv5rh',[{...row(77),name:'TEST',sourceModel:'uv5rh'}],{mode:'sync'});
  expect(plan[0].channel.number).toBe(77);expect(plan[0].channel.libraryId).toBe('library-one');
 });
 it('does not mark metadata, normalized empty flags or untouched records as radio modifications',()=>{
  const draft=offlineDraft('uv5rh'),f=draft.document.features;
  draft.document.channels=[makeChirpChannel(1,f),makeChirpChannel(2,f)];draft.channels=draft.document.channels;
  const rows=managedChirp(draft.channels,'uv5rh').map(c=>({...c,group:'SHARED',libraryId:'library-one'}));
  const next={...draft,channels:replaceChirpChannels(draft.channels,rows,f)};
  expect(editedChannels(next)).toEqual([]);
  next.channels=next.channels.map(c=>c.number===2?{...c,name:'EDIT'}:c);
  expect(editedChannels(next).map(c=>c.number)).toEqual([2]);
  next.channels.push({...makeChirpChannel(99,f),empty:true});
  expect(editedChannels(next).map(c=>c.number)).toEqual([2]);
 });
 it('preserves the target priority-scan flag when unrelated common fields change',()=>{
  const draft=offlineDraft('uv5rh'),native={...makeChirpChannel(1,draft.document.features),skip:'P'};
  const rows=managedChirp([native],'uv5rh').map(c=>({...c,name:'TEST'}));
  expect(replaceChirpChannels([native],rows,draft.document.features)[0].skip).toBe('P');
 });

 it('preserves shared links when a D500 complete project is reopened',()=>{
  const workspace={...emptyWorkspace(),channels:[{...newChannel(0),libraryId:'library-one'}]};
  expect(parseProject(JSON.stringify(workspace)).channels[0].libraryId).toBe('library-one');
 });
 it('uses an explicit source numbering base for shared spreadsheet imports',()=>{
  const source={...row(),sourceModel:undefined,numberBase:0 as const,name:'TEST'};
  expect(planTransfer([source],'uv5rh',[],{mode:'merge'})[0].channel.number).toBe(1);
 });
 it('keeps aliases recognizable and distinct when a mixed Chinese name contains only one ASCII letter',()=>{
  expect(compatibleName('U段中继','uv5r',1)).toBe('U001');expect(compatibleName('V段中继','uv5r',5)).toBe('V005');
 });

 it('adapts UV-5RH names using GBK bytes instead of replacing Chinese with ASCII aliases',()=>{
  const plan=planTransfer([{...row(),name:'中文名称测试'}],'uv5rh',[],{mode:'append'});
  expect(plan[0].errors).toEqual([]);expect(plan[0].channel.name).toBe('中文名称测试');
  expect(compatibleName('一二三四五六七','uv5rh',1)).toBe('一二三四五六');
  expect(compatibleName('一二三四五六七','uvk5-losehu',1)).toBe('一二三四五六');
 });

 it('uses Chinese library names despite an inactive profile caching the old ASCII driver limits',()=>{
  const current=baselineFeatures('uv5rh'),stale={...current,characters:'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',nameEncoding:undefined,nameBytes:undefined,bands:[[430000000,440000000]] as [number,number][]};
  const source={...row(),name:'广州越秀金沙',aliases:{uv5rh:'GZ005'}};
  const plan=planTransfer([source],'uv5rh',[],{mode:'append'},stale);
  expect(plan[0].channel.name).toBe(source.name);expect(plan[0].errors).toEqual([]);
  expect(compatibleName(source.name,'uv5rh',1,stale)).toBe(source.name);
  expect(currentNameFeatures('uv5rh',stale).bands).toBe(stale.bands);
  expect(stale.nameEncoding).toBeUndefined();expect(source.aliases.uv5rh).toBe('GZ005');
 });
 it('offers saved aliases explicitly while manual names always take priority',()=>{
  const source={...row(),name:'广州中继',aliases:{uv5rh:'GZ-A'}};
  expect(planTransfer([source],'uv5rh',[],{mode:'append',nameMode:'aliases'})[0].channel.name).toBe('GZ-A');
  expect(planTransfer([source],'uv5rh',[],{mode:'append',nameMode:'aliases',names:{[source.id]:'中文名称'}})[0].channel.name).toBe('中文名称');
  const tooLong={...source,name:'一二三四五六七'};
  expect(planTransfer([tooLong],'uv5rh',[],{mode:'append'})[0].channel.name).toBe('GZ-A');
  expect(planTransfer([{...tooLong,aliases:undefined}],'uv5rh',[],{mode:'append'})[0].errors.join()).toContain('12 字节');
 });
 it('keeps separate co-channel stations and their aliases when importing or syncing',()=>{
  let id=0;const stations=[{...row(33),id:'a',name:'荷塘站',group:'江门'},{...row(130),id:'b',name:'福田站',group:'深圳'},{...row(131),id:'c',name:'福田二台',group:'深圳'}];
  const library=mergeLibrary(emptyLibrary(),stations,()=>`library-${++id}`);
  expect(library.channels.map(c=>c.name)).toEqual(['荷塘站','福田站','福田二台']);
  expect(mergeLibrary(library,stations).channels).toHaveLength(3);
  const target={...stations[0],id:'uv5rh:33',sourceModel:'uv5rh' as const};
  const plan=planTransfer(library.channels,'uv5rh',[target],{mode:'sync'});
  expect(plan.map(c=>c.channel.number)).toEqual([33,1,2]);expect(plan.every(c=>!c.errors.length)).toBe(true);
 });

});
