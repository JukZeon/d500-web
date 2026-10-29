"""Profile, byte-codec and complete simulated LOSEHU clone sessions."""
import struct
import unittest
import engine
from chirp import memmap, errors, checksum
from chirp.drivers import uvk5
from losehu_profiles import profile_for, encode_name, decode_name, FONT_117, FONT_117_ENCODE
from test_engine import fixture


def radio_for(firmware):
    profile = profile_for(firmware)
    raw = bytearray(engine.image_bytes(fixture('uvk5-losehu'))[:profile.backup_size])
    raw[0xf50:0x1bd0] = bytes(3200)
    r = engine.LosehuRadio(None)
    r.metadata = {'uvk5_firmware': firmware}
    r._mmap = memmap.MemoryMapBytes(bytes(raw))
    r.process_mmap()
    r.status_fn = lambda status: None
    return r


class K5Pipe:
    """Byte-level radio emulator, including real XOR, CRC and response headers."""
    timeout = 1
    def __init__(self, radio):
        self.firmware = radio.metadata['uvk5_firmware']
        self.image = bytearray(engine.image_bytes(radio))
        self.queue, self.commands = bytearray(), []
        self.bad_address = False

    def log(self, unused): pass

    def read(self, size):
        result = bytes(self.queue[:size])
        del self.queue[:size]
        return result

    def reply(self, body):
        self.queue.extend(b'\xab\xcd' + bytes((len(body), 0)) + uvk5.xorarr(body + struct.pack('<H', checksum.crc16_xmodem(body))) + b'\xdc\xba')

    def write(self, packet):
        assert packet[:2] == b'\xab\xcd' and packet[-2:] == b'\xdc\xba'
        decoded = uvk5.xorarr(packet[4:-2])
        body = decoded[:packet[2]]
        assert decoded[-2:] == struct.pack('<H', checksum.crc16_xmodem(body))
        command = int.from_bytes(body[:2], 'little')
        self.commands.append(body)
        if command == 0x514:
            assert body[4:8] == b'\x6a\x39\x57\x64'
            self.reply(b'\x15\x05\x10\x00' + self.firmware.encode().ljust(16, b'\x00'))
        elif command in (0x51b, 0x52b, 0x51d, 0x538):
            assert body[8:12] == b'\x6a\x39\x57\x64'
            header_addr = int.from_bytes(body[4:6], 'little')
            size = body[6]
            expanded = command in (0x52b, 0x538)
            address = (header_addr << 16) + int.from_bytes(body[12:14], 'little') if expanded else header_addr
            response_addr = header_addr ^ 1 if self.bad_address else header_addr
            if command in (0x51b, 0x52b):
                self.reply(b'\x1c\x05' + struct.pack('<HHBB', size + 4, response_addr, size, 0) + bytes(self.image[address:address + size]))
            else:
                payload = body[14:] if expanded else body[12:]
                assert len(payload) == size - (2 if expanded else 0)
                assert address + len(payload) <= 0x1d00
                self.image[address:address + len(payload)] = payload
                self.reply(b'\x1e\x05\x02\x00' + struct.pack('<H', response_addr))
        elif command != 0x5dd:
            raise AssertionError(f'Unknown command {command:x}')
        return len(packet)


class LosehuProfileTest(unittest.TestCase):
    def test_version_matrix_and_english_expansion(self):
        cases = {
            'LOSEHU112': ('losehu117', 'official', 'ascii', 10, 8192),
            'LOSEHU117K': ('losehu117k', 'expanded', 'losehu117', 13, 131072),
            'LOSEHU118K': ('losehu118k', 'expanded', 'gb2312', 13, 131072),
            'LOSEHU118H': ('losehu118h', 'expanded', 'gb2312', 13, 262144),
            'LOSEHU120K': ('losehu120k', 'expanded', 'gb2312', 13, 131072),
            'LOSEHU123H': ('losehu118h', 'expanded', 'gb2312', 13, 262144),
            'LOSEHU124HS': ('losehu124h', 'expanded', 'gb2312', 13, 262144),
            'LOSEHU131': ('losehu118', 'official', 'ascii', 10, 8192),
            'LOSEHU132': ('losehu118', 'official', 'ascii', 10, 8192),
            'LOSEHU133E': ('losehu118', 'official', 'ascii', 10, 8192),
            'LOSEHU132EK': ('losehu120k', 'expanded', 'ascii', 10, 131072),
            'LOSEHU131PK': ('ltsk', 'expanded', 'losehu117', 13, 131072),
            'LOSEHU131P': ('lts', 'official', 'ascii', 10, 8192),
            'LOSEHU132D': ('losehud', 'expanded', 'gb2312', 13, 262144),
        }
        for firmware, expected in cases.items():
            with self.subTest(firmware=firmware):
                p = profile_for(firmware)
                self.assertEqual((p.key, p.protocol, p.encoding, p.name_bytes, p.backup_size), expected)
                self.assertTrue(engine.LosehuRadio.k5_approve_firmware(firmware))

    def test_unknown_future_fork_and_bootloader_rejected(self):
        for value in ('', 'UNKNOWN', 'LOSEHU111', 'LOSEHU134', 'LOSEHU999H', 'LOSEHU131garbageH', 'XLOSEHU131', 'LOSEHU117H', 'LOSEHU119KS', 'L_BL002', '7.1.0', '*OEFW-LOSEHU131'):
            with self.subTest(value=value):
                self.assertIsNone(profile_for(value))
                self.assertFalse(engine.LosehuRadio.k5_approve_firmware(value))

    def test_basic_settings_only_audited_versions(self):
        for firmware in ('LOSEHU131', 'LOSEHU131K', 'LOSEHU131HS', 'LOSEHU132', 'LOSEHU133E', 'LOSEHU133EK'):
            self.assertTrue(profile_for(firmware).basic_settings, firmware)
        for firmware in ('LOSEHU130HS', 'LOSEHU117K', 'LOSEHU131P', 'LOSEHU132D'):
            self.assertFalse(profile_for(firmware).basic_settings, firmware)

    def test_standard_image_geometry_and_profile_metadata(self):
        r = radio_for('LOSEHU132')
        rebuilt = engine.load_image('uvk5-losehu', engine.image_export(r))
        self.assertEqual(rebuilt.NAME_ENCODING, 'ascii')
        self.assertEqual(rebuilt.eeprom_size, 8192)
        r._mmap = memmap.MemoryMapBytes(bytes(0x40000))
        with self.assertRaises(errors.RadioError): r.process_mmap()

    def test_unrecognized_firmware_stops_after_hello(self):
        r = radio_for('LOSEHU132');pipe = K5Pipe(r);pipe.firmware = 'LOSEHU134'
        target = engine.LosehuRadio(pipe);target.status_fn = lambda status: None
        with self.assertRaisesRegex(errors.RadioError, 'LOSEHU134'): target.sync_in()
        self.assertEqual(len(pipe.commands), 1)


class LosehuCodecTest(unittest.TestCase):
    def test_legacy_map_is_distinct_and_all_glyphs_roundtrip(self):
        self.assertEqual(sum(map(len, FONT_117.values())), 6999)
        for char in FONT_117_ENCODE:
            self.assertEqual(decode_name(encode_name(char, 'losehu117'), 'losehu117'), char)
        self.assertNotEqual(encode_name('新会中继', 'losehu117'), '新会中继'.encode('gb2312'))
        edge = FONT_117[128][254]
        self.assertEqual(encode_name(edge, 'losehu117'), b'\x80\xff')
        self.assertEqual(decode_name(b'\x80\xff\x00', 'losehu117'), edge)

    def test_three_codecs_and_strict_limits_in_actual_engine(self):
        for firmware, name in (('LOSEHU132', 'TEST123456'), ('LOSEHU132EK', 'TEST123456'), ('LOSEHU117K', '新会中继A'), ('LOSEHU131HS', '新会中继A')):
            with self.subTest(firmware=firmware):
                r = radio_for(firmware)
                channel = engine.document(r, 'uvk5-losehu')['channels'][0]
                channel['name'] = name
                engine.apply_memory(r, channel)
                self.assertEqual(r.get_memory(channel['number']).name, name)
                encoded = encode_name(name, r.NAME_ENCODING)
                addr = 0xf50 + (channel['number'] - 1) * 16
                self.assertEqual(engine.image_bytes(r)[addr:addr + len(encoded)], encoded)
                for invalid in ('一二三四五六七', '😀', '12345678901234'):
                    with self.assertRaises(ValueError): engine.apply_memory(r, {**channel, 'name': invalid})

    def test_non_grid_airband_frequency_is_not_rewritten_by_a_rename(self):
        r = radio_for('LOSEHU132')
        channel = engine.document(r, 'uvk5-losehu')['channels'][0]
        channel.update(rx='118.870000', tx='', mode='AM', name='AIR')
        engine.apply_memory(r, channel)
        before = engine.image_bytes(r)
        decoded = engine.memory_dict(r, r.get_memory(channel['number']))
        self.assertEqual(decoded['rx'], '118.870000')
        decoded['name'] = 'AIRPORT'
        engine.apply_memory(r, decoded)
        after = engine.image_bytes(r)
        addr = 16 * (channel['number'] - 1)
        self.assertEqual(before[addr:addr + 16], after[addr:addr + 16])

    def test_ascii_chinese_rejection_is_version_specific(self):
        for firmware in ('LOSEHU131', 'LOSEHU132', 'LOSEHU133E', 'LOSEHU132EK'):
            r = radio_for(firmware);channel = engine.document(r, 'uvk5-losehu')['channels'][0]
            with self.assertRaises(ValueError): engine.apply_memory(r, {**channel, 'name': '新会中继'})

    def test_unmodified_name_retains_unknown_bytes_in_all_codecs(self):
        for firmware in ('LOSEHU132', 'LOSEHU117K', 'LOSEHU131HS'):
            r = radio_for(firmware)
            channel = engine.document(r, 'uvk5-losehu')['channels'][0]
            addr = 0xf50 + (channel['number'] - 1) * 16
            raw_name = b'\x80\x7fTEST' + b'\x00' * 10
            r._mmap[addr] = raw_name
            channel = engine.memory_dict(r, r.get_memory(channel['number']))
            channel['rxTone'] = '88.5'
            engine.apply_memory(r, channel)
            self.assertEqual(engine.image_bytes(r)[addr:addr + 16], raw_name)


class LosehuCloneTest(unittest.TestCase):
    def test_complete_read_and_write_standard_and_expanded(self):
        for firmware in ('LOSEHU131', 'LOSEHU132', 'LOSEHU117K', 'LOSEHU118K', 'LOSEHU131HS', 'LOSEHU132EK'):
            with self.subTest(firmware=firmware):
                source = radio_for(firmware);pipe = K5Pipe(source)
                target = engine.LosehuRadio(pipe);target.status_fn = lambda status: None
                target.sync_in()
                self.assertEqual(engine.image_bytes(target), bytes(pipe.image))
                read_id = b'\x1b\x05' if target.profile.protocol == 'official' else b'\x2b\x05'
                self.assertEqual([b[:2] for b in pipe.commands], [b'\x14\x05'] + [read_id] * (len(pipe.image) // 128))
                pipe.commands.clear()
                target.sync_out()
                write_id = b'\x1d\x05' if target.profile.protocol == 'official' else b'\x38\x05'
                self.assertEqual([b[:2] for b in pipe.commands], [b'\x14\x05'] + [write_id] * 116 + [b'\xdd\x05'])
                self.assertEqual(engine.image_bytes(target), bytes(pipe.image))

    def test_mismatched_image_rejected_before_first_write(self):
        for before, actual in (('LOSEHU131HS', 'LOSEHU132'), ('LOSEHU131', 'LOSEHU132'), ('LOSEHU117K', 'LOSEHU118K'), ('LOSEHU132EK', 'LOSEHU132K')):
            r = radio_for(before);r.pipe = K5Pipe(r);r.pipe.firmware = actual
            with self.assertRaisesRegex(errors.RadioError, '不同'): r.sync_out()
            self.assertEqual([c[:2] for c in r.pipe.commands], [b'\x14\x05'])

    def test_invalid_ack_aborts_without_retry_reset_or_readback(self):
        for firmware in ('LOSEHU132', 'LOSEHU131HS'):
            r = radio_for(firmware);r.pipe = K5Pipe(r);r.pipe.bad_address = True
            with self.assertRaisesRegex(errors.RadioError, '确认地址'): r.sync_out()
            self.assertEqual(len(r.pipe.commands), 2)

    def test_wrong_read_address_and_out_of_range_writes_rejected(self):
        for firmware in ('LOSEHU132', 'LOSEHU131HS'):
            r = radio_for(firmware);pipe = K5Pipe(r);pipe.bad_address = True
            with self.assertRaisesRegex(errors.RadioError, '返回地址'): r._read_mem_block(pipe, 0, 128)
            for offset in (-1, 0x1ce0, 0x1d00, 0x1e00, 0x40000):
                with self.assertRaises(errors.RadioError): r._write_mem_block(pipe, bytes(64), offset)
            self.assertEqual(len(pipe.commands), 1)

    def test_basic_setting_edits_only_change_requested_byte(self):
        for firmware in ('LOSEHU131', 'LOSEHU132', 'LOSEHU133EK', 'LOSEHU131HS'):
            r = radio_for(firmware);before = engine.image_bytes(r)
            engine.apply_settings(r, {'/losehu_basic/losehu_squelch': [3]})
            after = engine.image_bytes(r)
            self.assertEqual([i for i, (a, b) in enumerate(zip(before, after)) if a != b], [0xe71])


if __name__ == '__main__': unittest.main()
