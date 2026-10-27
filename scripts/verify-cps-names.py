#!/usr/bin/env python3
"""Read-only verification harness for the V1 CPS channel-name copy path.

Dependencies: pefile, unicorn. The proprietary executable is supplied locally.
Runs native instructions at VA 0x48c33e through 0x48c886/0x48c99a.
GBK bytes and the cleared 16-byte destination are initialized as the preceding
CPS code does. Only integer VARIANT/loop helpers are replaced; no Windows UI,
USB access, firmware, or full VB6 runtime is executed. Results apply to this
binary's copy path; they are not proof of physical LCD rendering behavior.
"""
from pathlib import Path
import struct, json, pefile
from unicorn import Uc, UC_ARCH_X86, UC_MODE_32, UC_HOOK_CODE
from unicorn.x86_const import UC_X86_REG_EAX, UC_X86_REG_EBP, UC_X86_REG_ESP, UC_X86_REG_EIP, UC_X86_REG_ECX, UC_X86_REG_EDX
import argparse, hashlib
parser = argparse.ArgumentParser(description='Execute the official V1 CPS name-copy machine code in Unicorn, with minimal VB runtime substitutes. This is not a GUI or hardware test.')
parser.add_argument('exe', type=Path)
parser.add_argument('-o', '--output', type=Path, required=True)
args = parser.parse_args()
if hashlib.sha256(args.exe.read_bytes()).hexdigest() != 'c2d7e2d42a78d949b03d7557b0785139a856485d20c0cb12e9ae43979a3c3559':
    raise ValueError('Unsupported CPS revision')
P=pefile.PE(str(args.exe))
BASE=P.OPTIONAL_HEADER.ImageBase
IMPORTS={i.address:i.name.decode() for m in P.DIRECTORY_ENTRY_IMPORT for i in m.imports if i.name}

def run(text):
 u=Uc(UC_ARCH_X86,UC_MODE_32)
 u.mem_map(BASE,0x200000);u.mem_write(BASE,P.get_memory_mapped_image())
 STACK=0xe000000;HEAP=0x2000000;STUB=0xf000000
 u.mem_map(STACK,0x10000);u.mem_map(HEAP,0x20000);u.mem_map(STUB,0x10000)
 bp=STACK+0xf000;u.reg_write(UC_X86_REG_EBP,bp);u.reg_write(UC_X86_REG_ESP,bp-0x400)
 def get(a):return struct.unpack('<I',u.mem_read(a,4))[0]
 def put(a,v):u.mem_write(a,struct.pack('<I',v&0xffffffff))
 def var(a):
  t=get(a)&0xffff;v=get(a+8)
  if t==2:return struct.unpack('<h',u.mem_read(a+8,2))[0]
  return v if v<0x80000000 else v-0x100000000
 def setvar(a,v):u.mem_write(a,struct.pack('<IIII',3,0,v&0xffffffff,0))
 data=text.encode('gbk'); matrix=HEAP;array=HEAP+0x10000;blob=HEAP+0x11000
 put(0x57c0ac,matrix);put(bp-0x78,array)
 u.mem_write(array,struct.pack('<HHIIIII',1,0,1,0,blob,len(data),0));u.mem_write(blob,data)
 for c in range(16):u.mem_write(matrix+(c*1025+256)*2,struct.pack('<H',255))
 setvar(bp-0x24,256);setvar(bp-0x90,len(data)-1)
 stubs={}
 for n,(iat,name) in enumerate(IMPORTS.items()):
  addr=STUB+n*16;put(iat,addr);stubs[addr]=name
 loops={};count=[0]
 def hook(uc,pc,size,extra):
  count[0]+=1
  if pc in [0x48c886,0x48c99a]:uc.emu_stop();return
  if pc not in stubs:return
  name=stubs[pc];sp=uc.reg_read(UC_X86_REG_ESP);ret=get(sp);args=lambda n:[get(sp+4+i*4) for i in range(n)]
  n=0;result=0
  if name=='__vbaVarMove':
   src=uc.reg_read(UC_X86_REG_EDX);dest=uc.reg_read(UC_X86_REG_ECX);u.mem_write(dest,bytes(u.mem_read(src,16)));result=dest
  elif name=='__vbaI4Var':n=1;result=var(args(1)[0])
  elif name=='__vbaBoolVarNull':n=1;result=0xffff if var(args(1)[0]) else 0
  elif name in ['__vbaVarTstGe','__vbaVarTstGt']:
   n=2;a,b=args(n);result=0xffff if (var(b)>=var(a) if name.endswith('Ge') else var(b)>var(a)) else 0
  elif name in ['__vbaVarCmpGt','__vbaVarCmpLt','__vbaVarAnd','__vbaVarAdd']:
   n=3;dest,a,b=args(n);x,y=var(b),var(a)
   v= (-1 if x>y else 0) if name.endswith('CmpGt') else (-1 if x<y else 0) if name.endswith('CmpLt') else x&y if name.endswith('And') else x+y
   setvar(dest,v);result=dest
  elif name=='__vbaVarForInit':
   n=6;index,temp1,temp2,start,end,step=args(n);loops[index]=[var(end),var(step)];setvar(index,var(start));result=int(var(start)<=var(end) if var(step)>0 else var(start)>=var(end))
  elif name=='__vbaVarForNext':
   n=3;index,_,_=args(n);end,step=loops[index];v=var(index)+step;setvar(index,v);result=int(v<=end if step>0 else v>=end)
  elif name=='__vbaGenerateBoundsError':raise RuntimeError('Native bounds check failed')
  else:raise RuntimeError('Unexpected runtime helper '+name)
  uc.reg_write(UC_X86_REG_EAX,result&0xffffffff);uc.reg_write(UC_X86_REG_ESP,sp+4+n*4);uc.reg_write(UC_X86_REG_EIP,ret)
 u.hook_add(UC_HOOK_CODE,hook)
 u.emu_start(0x48c33e,0x48c886,count=50000)
 out=bytes(struct.unpack('<H',u.mem_read(matrix+(c*1025+256)*2,2))[0] for c in range(16)).split(b'\xff')[0]
 return {'input':text,'input_gbk_bytes':len(data),'saved':out.decode('gbk',errors='replace'),'saved_bytes':list(out),'native_instructions':count[0]}

results=[run(t) for t in ['一二三四','一二三四五','一二三四五六七八','ABCDEFGH','ABCDEFGHIJ','A一二三四','测试名称五']]
args.output.write_text(json.dumps(results,ensure_ascii=False,indent=2))
assert [r['saved'] for r in results] == ['一二三四', '一二三四', '一二三四', 'ABCDEFGH', 'ABCDEFGH', 'A一二三', '测试名称']
print(json.dumps(results,ensure_ascii=False,indent=2))
