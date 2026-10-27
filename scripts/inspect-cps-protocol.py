#!/usr/bin/env python3
"""Read-only extraction of constants from the SHA-pinned official V1 CPS.

Requires pefile and capstone. Does not execute the executable or validate a radio.
"""
import argparse
import hashlib
import json
import re
from pathlib import Path

import capstone
import pefile

SHA = 'c2d7e2d42a78d949b03d7557b0785139a856485d20c0cb12e9ae43979a3c3559'


def inspect(path):
    if hashlib.sha256(path.read_bytes()).hexdigest() != SHA:
        raise ValueError('Unsupported CPS revision')
    pe = pefile.PE(str(path))
    base = pe.OPTIONAL_HEADER.ImageBase
    read = lambda address, size: pe.get_data(address - base, size)
    md = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_32)
    # 0x4651fb loads EDI from __vbaUI1I2 at IAT 0x40110c.
    handshake, literal, converted = {}, None, None
    for ins in md.disasm(read(0x465201, 0x7f), 0x465201):
        match = re.fullmatch(r'ecx, (0x[0-9a-f]+|\d+)', ins.op_str)
        if ins.mnemonic == 'mov' and match:
            literal = int(match[1], 0)
        match = re.fullmatch(r'byte ptr \[e(?:dx|cx)(?: \+ (0x[0-9a-f]+|\d+))?\], al', ins.op_str)
        if ins.mnemonic == 'mov' and match:
            # The next ECX argument can already have been loaded before the store.
            # Recover the conversion argument at the most recent helper call below.
            if converted is None:
                raise ValueError('Store without a preceding byte conversion')
            handshake[int(match[1] or '0', 0)] = converted
        if ins.mnemonic == 'call' and ins.op_str == 'edi':
            converted = literal
    magic = [handshake[i] for i in range(8)]
    settings = read(0x426b6c, 20).decode('utf-16-le')
    if magic != [0x55, 0x20, 0x21, 1, 0x23, 255, 0xdc, 2] or settings != '9600,N,8,1':
        raise ValueError('Protocol constant extraction mismatch')
    return {'sha256': SHA, 'method': 'static constant extraction; not hardware validation',
            'serial': {'address': '0x426b6c', 'settings': settings},
            'handshake': {'start': '0x465201', 'end': '0x46527d', 'bytes': magic,
                          'hex': ' '.join(f'{v:02X}' for v in magic)}, 'hardwareTested': False}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('exe', type=Path)
    parser.add_argument('-o', '--output', type=Path, required=True)
    args = parser.parse_args()
    args.output.write_text(json.dumps(inspect(args.exe), ensure_ascii=False, indent=2) + '\n')
    print(f'Wrote static protocol evidence to {args.output}')
