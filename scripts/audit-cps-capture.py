#!/usr/bin/env python3
"""Read-only audit of a Frida CPS serial JSONL capture. Never exports payloads.
Usage: python scripts/audit-cps-capture.py capture.jsonl mac-read-raw.bin -o report.json
The raw image is the 0x3200-byte configuration read from the same radio.
"""
import argparse
import hashlib
import json
from pathlib import Path


def audit(capture, baseline):
    raw = capture.read_bytes()
    image = baseline.read_bytes()
    if len(image) != 0x3200:
        raise ValueError('Expected a 0x3200-byte configuration image')
    sessions, current = [], None
    for line in raw.splitlines():
        if not line.strip():
            continue
        event = json.loads(line)
        event = event.get('payload', event)
        kind = event.get('event')
        if kind == 'OPEN':
            if current is None:
                current = {'start': event['time'], 'groups': [], 'closed': False}
                sessions.append(current)
        if current is None:
            continue
        if kind in ('TX', 'RX'):
            groups = current['groups']
            data = bytes.fromhex(event['hex'])
            if groups and groups[-1]['direction'] == kind:
                groups[-1]['data'] += data
            else:
                groups.append({'direction': kind, 'data': data})
        if kind == 'CLOSE':
            current['closed'] = bool(event.get('ok'))
            current = None
    reports = []
    for session in sessions:
        groups, reads, writes, checks, acknowledgements = session['groups'], [], [], [], []
        for i, group in enumerate(groups):
            data = group['data']
            # Only parse the beginning of a direction group. Do not scan payload bytes.
            while data[:1] in (b'\x06', b'\x05'):
                data = data[1:]
            if len(data) >= 4 and data[0] == 0x58 and len(data) >= 4 + data[3]:
                address, length = int.from_bytes(data[1:3], 'big'), data[3]
                if address >= len(image):
                    continue  # Excludes password status, never includes it in report.
                entry = {'address': address, 'length': length}
                checks.append(data[4:4 + length] == image[address:address + length])
                if group['direction'] == 'TX':
                    writes.append(entry)
                    acknowledgements.append(i + 1 < len(groups) and groups[i + 1]['direction'] == 'RX' and groups[i + 1]['data'] == b'\x06')
                else:
                    reads.append(entry)
        if not reads and not writes:
            continue
        reports.append({'startUtc': session['start'], 'closed': session['closed'],
                        'handshakeMatches': bool(groups and groups[0]['data'] == bytes.fromhex('5520250706FFDC02')),
                        'readBlocks': len(reads), 'writeBlocks': len(writes),
                        'readBytes': sum(v['length'] for v in reads), 'writeBytes': sum(v['length'] for v in writes),
                        'allPayloadsMatchMacRead': all(checks), 'allWritesAcknowledged': all(acknowledgements) if writes else None,
                        'readAddressBounds': [min(r['address'] for r in reads), max(r['address'] + r['length'] - 1 for r in reads)] if reads else None,
                        'writeAddressBounds': [min(r['address'] for r in writes), max(r['address'] + r['length'] - 1 for r in writes)] if writes else None})
    # Publish counts/ranges/hashes only. No personal channel names, frequencies or IDs.
    return {'captureSha256': hashlib.sha256(raw).hexdigest(), 'baselineSha256': hashlib.sha256(image).hexdigest(),
            'captureSessions': len(sessions), 'sessions': reports,
            'scope': 'One old D500 without aviation reception; factory writes preserved the existing values.'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('capture', type=Path)
    parser.add_argument('baseline', type=Path)
    parser.add_argument('-o', '--output', type=Path, required=True)
    args = parser.parse_args()
    args.output.write_text(json.dumps(audit(args.capture, args.baseline), indent=2) + '\n')
