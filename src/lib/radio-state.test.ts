import { describe, expect, it, vi } from 'vitest';
import { CONFIG_SIZE, type RadioSnapshot } from './radio';
import { loadRadioState, saveRadioState, samePort, selectRadioPort, loadWriteScope, saveWriteScope, RADIO_STATE_KEY } from './radio-state';
import type { SerialPortLike } from './serial';
function memory() {
  const values=new Map<string,string>();
  return { getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);},removeItem:(key:string)=>{values.delete(key);} };
}
function fixture() {
  const identity=Array(49).fill(0);identity[48]=0x55;
  const snapshot:RadioSnapshot={schema:'d500-radio-read-v1',capturedAt:new Date().toISOString(),identity,bytes:Array(CONFIG_SIZE).fill(255),hardwareVerified:false,source:'write-ack',knownScopes:[],knownAddresses:[4096]};
  return {snapshot,portInfo:{usbVendorId:0x067b,usbProductId:0x2303}};
}
describe('locally remembered radio state',()=>{
  it('restores ACK-only partial block knowledge and scope across a page reload',()=>{
    const store=memory(),state=fixture();expect(saveRadioState(state,store)).toBe(true);
    expect(loadRadioState(store)).toEqual(state);
    saveWriteScope('channels',store);expect(loadWriteScope(store)).toBe('channels');
    saveRadioState(null,store);expect(loadRadioState(store)).toBeNull();
  });
  it('ignores malformed, oversized and invalid cached states instead of blocking file edits',()=>{
    const store=memory();
    for(const text of ['{','x'.repeat(200001),JSON.stringify({...fixture(),snapshot:{...fixture().snapshot,knownAddresses:[3]}}),JSON.stringify({...fixture(),snapshot:{...fixture().snapshot,bytes:[1]}}),JSON.stringify({...fixture(),snapshot:{...fixture().snapshot,identity:[1]}}),JSON.stringify({...fixture(),portInfo:{usbVendorId:-1}})]){
      store.setItem(RADIO_STATE_KEY,text);expect(loadRadioState(store)).toBeNull();
    }
  });
  it('tolerates unavailable storage and does not treat an unknown or different cable as the remembered one',()=>{
    const unavailable={getItem(){throw new Error('denied');},setItem(){throw new Error('full');},removeItem(){throw new Error('denied');}};
    expect(loadRadioState(unavailable)).toBeNull();expect(saveRadioState(fixture(),unavailable)).toBe(false);
    expect(loadWriteScope(unavailable)).toBe('all');expect(()=>saveWriteScope('settings',unavailable)).not.toThrow();
    const info=fixture().portInfo;expect(samePort(info,info)).toBe(true);expect(samePort(info,{...info,usbProductId:1})).toBe(false);expect(samePort(null,info)).toBe(false);expect(samePort({},{})).toBe(false);
  });
  it('reuses a single previously permitted USB port but asks when there are multiple matches or a change is requested',async()=>{
    const info=fixture().portInfo,port={getInfo:()=>info} as SerialPortLike;
    const requestPort=vi.fn(async()=>port),getPorts=vi.fn(async()=>[port]);
    const api={requestPort,getPorts};
    expect(await selectRadioPort(api,info)).toBe(port);expect(requestPort).not.toHaveBeenCalled();
    expect(await selectRadioPort(api,null)).toBe(port);expect(requestPort).not.toHaveBeenCalled();
    await selectRadioPort(api,info,true);expect(requestPort).toHaveBeenCalledTimes(1);
    getPorts.mockResolvedValue([port,port]);await selectRadioPort(api,info);expect(requestPort).toHaveBeenCalledTimes(2);
    getPorts.mockRejectedValue(new Error('unavailable'));await selectRadioPort(api,info);expect(requestPort).toHaveBeenCalledTimes(3);
    await selectRadioPort({requestPort},info);expect(requestPort).toHaveBeenCalledTimes(4);
  });
});
