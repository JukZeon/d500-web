import { describe, it, expect } from 'vitest';
import { BrowserRadioPort, CHIRP_BAUD } from './chirp-runtime';
import type { SerialPortLike } from './serial';
function fakePort() {
  let controller:ReadableStreamDefaultController<Uint8Array>;
  const sent:number[][]=[];
  let closed=false;
  const port:SerialPortLike={readable:new ReadableStream({start(c){controller=c;}}),writable:new WritableStream({write(data){sent.push([...data]);}}),async open(){},async close(){closed=true;},getInfo(){return{};}};
  return {port,sent,push:(bytes:number[])=>controller.enqueue(Uint8Array.from(bytes)),end:()=>controller.close(),closed:()=>closed};
}
describe('browser serial adapter for CHIRP',()=>{
  it('uses each driver baud rate',()=>{expect(CHIRP_BAUD.uv5r).toBe(9600);expect(CHIRP_BAUD.uv5rh).toBe(115200);expect(CHIRP_BAUD['uvk5-losehu']).toBe(38400);});
  it('joins fragmented packets and retains surplus bytes',async()=>{const p=fakePort(),link=new BrowserRadioPort(p.port,()=>{});p.push([1]);p.push([2,3,4]);expect(await link.io({op:'read',size:3,timeout:0.02})).toEqual({data:[1,2,3]});expect(await link.io({op:'read',size:1,timeout:0.02})).toEqual({data:[4]});await link.close();expect(p.closed()).toBe(true);});
  it('returns partial / empty reads on timeout like pyserial',async()=>{const p=fakePort(),link=new BrowserRadioPort(p.port,()=>{});p.push([0x06]);expect(await link.io({op:'read',size:4,timeout:0.01})).toEqual({data:[6]});expect(await link.io({op:'read',size:1,timeout:0.01})).toEqual({data:[]});await link.close();});
  it('writes complete driver frames without D500 byte pacing',async()=>{const p=fakePort(),link=new BrowserRadioPort(p.port,()=>{});expect(await link.io({op:'write',data:[0xab,0xcd,1]})).toEqual({written:3});expect(p.sent).toEqual([[0xab,0xcd,1]]);await link.close();});
  it('fails on disconnect and rejects invalid requests',async()=>{const p=fakePort(),link=new BrowserRadioPort(p.port,()=>{});await expect(link.io({op:'read',size:0})).rejects.toThrow('读取长度');p.end();await expect(link.io({op:'read',size:1,timeout:0.01})).rejects.toThrow('断开');await link.close();});
});
