#!/usr/bin/env python3
"""Read-only metadata inspection of the official D500 V1 native VB6 CPS.

Usage: python inspect-cps.py /path/to/D500_vip_CPS.exe -o /tmp/cps-map.json
Optional dependencies: pefile, capstone. Never executes or modifies the EXE.
The structure offsets below are specific to the SHA-256 pinned V1 binary.
"""
import argparse
import hashlib
import json
import struct
from pathlib import Path

import capstone
import pefile

EXPECTED_SHA256 = 'c2d7e2d42a78d949b03d7557b0785139a856485d20c0cb12e9ae43979a3c3559'


def inspect(path: Path) -> dict:
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    if digest != EXPECTED_SHA256:
        raise ValueError('Unsupported CPS revision; expected the official V1 1.0.0.0 executable.')
    pe = pefile.PE(str(path))
    base = pe.OPTIONAL_HEADER.ImageBase
    image_end = base + pe.OPTIONAL_HEADER.SizeOfImage
    disassembler = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_32)

    def read(address, size):
        if not base <= address < image_end or address + size > image_end:
            raise ValueError(f'Out-of-image address: {address:x}')
        return pe.get_data(address - base, size)

    def uint(address):
        return struct.unpack('<I', read(address, 4))[0]

    def string(address):
        return read(address, 180).split(b'\0')[0].decode('ascii', 'replace')

    def jump(address):
        if not base < address < base + 0x17b000:
            return None
        for instruction in disassembler.disasm(read(address, 24), address):
            if instruction.mnemonic == 'jmp' and instruction.op_str.startswith('0x'):
                return int(instruction.op_str, 16)
        return None

    objects = []
    for index in range(29):
        descriptor = 0x423bb4 + index * 0x30
        name = string(uint(descriptor + 0x18))
        item = {'name': name, 'descriptor': hex(descriptor), 'controls': []}
        if uint(descriptor + 0x28) & 0x80:
            optional = uint(descriptor) + 0x38
            count, controls = uint(optional + 0x20), uint(optional + 0x24)
            if count > 1000:
                raise ValueError('Invalid control count')
            for control in range(count):
                address = controls + control * 0x28
                event_count = uint(address) >> 16
                events = uint(address + 0x18)
                handlers = []
                if events:
                    for event in range(event_count):
                        stub = uint(events + (6 + event) * 4)
                        target = jump(stub)
                        if target:
                            handlers.append({'event_index': event, 'stub': hex(stub), 'native': hex(target)})
                item['controls'].append({'name': string(uint(address + 0x20)), 'handlers': handlers})
        objects.append(item)
    return {'sha256': digest, 'version': '1.0.0.0', 'format': 'PE32 / native VB6', 'objects': objects}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('exe', type=Path)
    parser.add_argument('-o', '--output', type=Path, required=True)
    args = parser.parse_args()
    result = inspect(args.exe)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print(f"Inspected {len(result['objects'])} VB6 objects; wrote metadata to {args.output}")
