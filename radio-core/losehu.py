"""Audited LOSEHU basic settings extension; unrelated bytes remain untouched.

Source: losehu/uv-k5-firmware-custom settings.c, revision
49222a9f431a006dfaaaa665b839e4953b1a1882, SETTINGS_InitEEPROM / save.
The bundled legacy CHIRP script uses obsolete side-key addresses; those keys
are deliberately NOT exposed here. No calibration, passwords, locks or boot
code are editable. Byte offsets must not be inferred from OEM settings.
"""
import struct
from chirp import chirp_common, errors, memmap
from chirp.drivers import uvk5
from chirp.drivers.uvk5_cn import UVK5LoseHuRadio, gb2312_charset, readmem_command, writemem_command
from losehu_profiles import profile_for, encode_name, decode_name, FONT_117_ENCODE
from chirp.settings import (RadioSetting, RadioSettingGroup,
                            RadioSettingValueInteger, RadioSettingValueBoolean, RadioSettingValueList,
                            RadioSettingValueString, RadioSettings)

# key, Chinese label, offset, maximum, display offset (firmware is zero-based).
FIELDS = [
    ('call', '一键呼叫信道', 0xE70, 199, 1),
    ('squelch', '静噪等级', 0xE71, 9, 0),
    ('tot', '发射限时', 0xE72, 10, 0),
    ('keylock', '键盘锁', 0xE74, 1, 0),
    ('vox', '声控开关', 0xE75, 1, 0),
    ('voxlevel', '声控等级', 0xE76, 9, 1),
    ('mic', '话筒灵敏度', 0xE77, 4, 0),
    ('display', '信道显示模式（固件编号）', 0xE79, 3, 0),
    ('crossband', '跨段收发（固件编号）', 0xE7A, 2, 0),
    ('save', '省电模式（固件编号）', 0xE7B, 4, 0),
    ('dualwatch', '双守候（固件编号）', 0xE7C, 2, 0),
    ('tail', '尾音消除', 0xE7E, 1, 0),
    ('vfo', '频率模式可用', 0xE7F, 1, 0),
    ('scanmode', '扫描恢复方式（固件编号）', 0xE95, 2, 0),
    ('voice', '语音提示（固件编号）', 0xEA0, 2, 0),
    ('alarm', '报警方式（固件编号）', 0xEA8, 1, 0),
    ('roger', '结束提示音（固件编号）', 0xEA9, 5, 0),
    ('rpttail', '中继尾音消除', 0xEAA, 10, 0),
    ('txvfo', '当前发射工作区（0 A / 1 B）', 0xEAB, 1, 0),
]
OPTIONS = {
    'tot': ['30 秒'] + [f'{n} 分钟' for n in range(1, 10)] + ['15 分钟'],
    'display': ['频率', '信道号', '名称', '名称 + 频率'],
    'crossband': ['关闭', 'A 区', 'B 区'],
    'save': ['关闭', '一级', '二级', '三级', '四级'],
    'dualwatch': ['关闭', 'A 区', 'B 区'],
    'scanmode': ['定时恢复', '载波恢复', '遇信号停止'],
    'voice': ['关闭', '中文', '英文'],
    'alarm': ['现场', '音调'],
    'roger': ['关闭', 'ROGER 尾音', 'MDC 尾音', 'MDC 首音', 'MDC 首尾音', 'MDC 首音 + ROGER'],
    'txvfo': ['A 区', 'B 区'],
}

BY_KEY = {f[0]: f for f in FIELDS}
# A boolean mask, rather than replacing the byte, preserves other packed flags.
BY_KEY['beep'] = ('beep', '按键音', 0xE90, 1, 0)


class LosehuRadio(UVK5LoseHuRadio):
    @property
    def profile(self):
        return profile_for(self.metadata.get('uvk5_firmware', ''))

    def require_profile(self):
        if self.profile is None:
            firmware = self.metadata.get('uvk5_firmware', '') or '未识别'
            raise errors.RadioError(f'暂不支持固件 {firmware}，未读写配置')
        return self.profile

    @classmethod
    def k5_approve_firmware(cls, firmware):
        return profile_for(firmware) is not None

    @property
    def eeprom_size(self):
        if self._eeprom_size:
            return self._eeprom_size
        return self.profile.backup_size if self.profile else 0x2000

    @property
    def NAME_BYTES(self):
        return self.profile.name_bytes if self.profile else 10

    @property
    def NAME_ENCODING(self):
        return self.profile.encoding if self.profile else 'ascii'

    def get_features(self):
        features = super().get_features()
        features.valid_name_length = self.NAME_BYTES
        features.valid_characters = (chirp_common.CHARSET_ASCII if self.NAME_ENCODING == 'ascii' else
                                     chirp_common.CHARSET_ASCII + ''.join(FONT_117_ENCODE) if self.NAME_ENCODING == 'losehu117' else gb2312_charset())
        return features

    def process_mmap(self):
        self.require_profile()
        self._check_download_size(len(self._mmap))
        super().process_mmap()

    def _check_download_size(self, size):
        profile = self.require_profile()
        valid = (0x2000,) if profile.protocol == 'official' else (0x2000, 0x4000, 0x8000, 0x10000, 0x20000, 0x40000)
        if size not in valid:
            raise errors.RadioError('镜像长度与该固件的备份范围不匹配')

    def _check_upload_image(self, image_size, firmware):
        self._check_download_size(image_size)
        # A channel library can cross versions, an entire EEPROM configuration
        # cannot: unnamed settings bytes may have moved between releases.
        image_firmware = self.metadata.get('uvk5_firmware', '')
        if firmware != image_firmware:
            raise errors.RadioError(f'方案固件 {image_firmware} 与电台 {firmware} 不同，请使用目标电台的方案')
        if image_size != self.eeprom_size or image_size < self.prog_size:
            raise errors.RadioError('镜像长度与当前方案不匹配')
        if self._upload_calibration:
            raise errors.RadioError('不支持写入校准区域')

    def _read_mem_block(self, pipe, offset, length):
        profile = self.require_profile()
        if not 1 <= length <= 128 or offset < 0 or offset + length > self.eeprom_size:
            raise errors.RadioError('读取地址超出备份范围')
        if profile.protocol == 'official':
            command = b'\x1b\x05\x08\x00' + struct.pack('<HBB', offset, length, 0) + b'\x6a\x39\x57\x64'
            reply_address = offset
        else:
            command = readmem_command(offset, length)
            reply_address = offset >> 16
        uvk5._send_command(pipe, command)
        reply = uvk5._receive_reply(pipe)
        if len(reply) != length + 8 or reply[:2] != b'\x1c\x05' or reply[4:7] != struct.pack('<HB', reply_address, length):
            raise errors.RadioError(f'读取 0x{offset:04X}：返回地址或长度不匹配')
        return reply[8:]

    def _write_mem_block(self, pipe, data, offset):
        if not data or len(data) > self.write_block or offset < 0 or offset + len(data) > self.prog_size:
            raise errors.RadioError('写入超出信道和基本设置区域')
        if self.require_profile().protocol == 'official':
            command = b'\x1d\x05' + struct.pack('<BBHBB', len(data) + 8, 0, offset, len(data), 1) + b'\x6a\x39\x57\x64' + data
            reply_address = offset
        else:
            command = writemem_command(offset, data)
            reply_address = offset >> 16
        uvk5._send_command(pipe, command)
        reply = uvk5._receive_reply(pipe)
        if len(reply) != 6 or reply[:2] != b'\x1e\x05' or reply[4:6] != struct.pack('<H', reply_address):
            raise errors.RadioError(f'写入 0x{offset:04X}：确认地址不匹配')
        return True

    def sync_in(self):
        self.pipe.timeout = 1.0
        self.metadata = {'uvk5_firmware': uvk5._sayhello(self.pipe)}
        self.require_profile()
        size = self.eeprom_size
        self._check_download_size(size)
        status = chirp_common.Status()
        status.max, status.cur, status.msg = size, 0, '读取配置'
        self.status_fn(status)
        data = bytearray()
        for address in range(0, size, self.read_block):
            data.extend(self._read_mem_block(self.pipe, address, min(self.read_block, size - address)))
            status.cur = len(data)
            self.status_fn(status)
        self._mmap = memmap.MemoryMapBytes(bytes(data))
        self.process_mmap()

    def sync_out(self):
        self.pipe.timeout = 1.0
        firmware = uvk5._sayhello(self.pipe)
        self._check_upload_image(len(self.get_mmap()), firmware)
        status = chirp_common.Status()
        status.max, status.cur, status.msg = self.prog_size, 0, '写入配置'
        self.status_fn(status)
        for address in range(0, self.prog_size, self.write_block):
            data = self.get_mmap()[address:address + self.write_block]
            self._write_mem_block(self.pipe, data, address)
            status.cur = address + len(data)
            self.status_fn(status)
        uvk5._resetradio(self.pipe)

    def get_memory(self, number):
        memory = super().get_memory(number)
        if not memory.empty:
            # CHIRP's airband helper translates arbitrary stored frequencies
            # onto aviation channel designators. LOSEHU/K5Web use the actual
            # 10 Hz EEPROM value; never change RX merely by editing a name.
            memory.freq = int(self._memobj.channel[memory.number - 1].freq) * 10
        return memory

    def validate_memory(self, memory):
        messages = super().validate_memory(memory)
        # LOSEHU stores actual RF frequencies (K5Web: raw uint32 / 100000),
        # including values that are not ICAO 8.33 kHz channel designators.
        if chirp_common.is_airband(memory.freq):
            try:
                chirp_common.fix_rounded_step(memory.freq)
            except errors.InvalidDataError as error:
                designator_error = f'{chirp_common.format_freq(memory.freq)}: {error}'
                messages = [item for item in messages if str(item) != designator_error]
        if memory.freq % 10 or memory.offset % 10:
            messages.append(chirp_common.ValidationError('频率精度最多 10 Hz'))
        return messages

    def encode_channel_name(self, name):
        return encode_name(name, self.NAME_ENCODING)

    def _decode_name(self, raw):
        return decode_name(raw, self.NAME_ENCODING)

    def _store_name(self, number, name, original):
        # An unchanged name retains all 16 bytes, including unknown glyphs or
        # names longer than the firmware editor permits creating today.
        if self._decode_name(original) == name.rstrip():
            self._memobj.channelname[number].set_raw(original)
            return
        try:
            encoded = self.encode_channel_name(name)
        except UnicodeEncodeError as error:
            raise errors.InvalidValueError('信道名称含有该固件不支持的字符') from error
        if len(encoded) > self.NAME_BYTES:
            raise errors.InvalidValueError(f'信道名称最多 {self.NAME_BYTES} 字节')
        self._memobj.channelname[number].set_raw(encoded.ljust(16, b'\x00'))

    @property
    def basic_settings_supported(self):
        return bool(self.profile and self.profile.basic_settings)

    def get_settings(self):
        profile = self.require_profile()
        info = RadioSettingGroup('roinfo', '固件信息')
        root = RadioSettings(info)
        labels = {'ascii': '英文字符', 'gb2312': 'GB2312 中文', 'losehu117': '早期中文专用字库'}
        for key, label, text in (
                ('fw_ver', '固件版本', self.metadata.get('uvk5_firmware', '')),
                ('profile', '固件分支', '非扩容版' if profile.protocol == 'official' else '扩容版'),
                ('names', '名称格式', f'{labels[profile.encoding]} · {self.NAME_BYTES} 字节'),
                ('backup', '备份范围', f'{self.eeprom_size // 1024} KiB')):
            value = RadioSettingValueString(0, max(32, len(text)), text, False, charset=text)
            value.set_mutable(False)
            info.append(RadioSetting(key, label, value))
        if not self.basic_settings_supported:
            return root
        basic = RadioSettingGroup('losehu_basic', 'LOSEHU 基本设置')
        for key, title, addr, maximum, offset in [*FIELDS, BY_KEY['beep']]:
            raw = self.get_mmap()[addr][0]
            current = raw & 1 if key == 'beep' else raw
            # Unknown values are displayed read-only, never silently normalized.
            if current > maximum:
                value = RadioSettingValueInteger(0, 255, raw)
                value.set_mutable(False)
            elif key in OPTIONS:
                value = RadioSettingValueList(OPTIONS[key], current_index=current)
                title = title.replace('（固件编号）', '').replace('（0 A / 1 B）', '')
            elif maximum == 1 and offset == 0:
                value = RadioSettingValueBoolean(bool(current))
            else:
                value = RadioSettingValueInteger(offset, maximum + offset, current + offset)
            basic.append(RadioSetting('losehu_' + key, title, value))
        root.append(basic)
        return root

    def set_settings(self, settings):
        for item in settings:
            if not isinstance(item, RadioSetting):
                self.set_settings(item)
                continue
            name = item.get_name()
            if name.startswith('losehu_'):
                if not self.basic_settings_supported:
                    raise ValueError('该固件版本尚未映射基本设置')
                field = BY_KEY[name.removeprefix('losehu_')]
                key, unused, addr, maximum, offset = field
                val = int(item.value) - offset
                if not 0 <= val <= maximum:
                    raise ValueError('设置超出固件允许范围')
                if key == 'beep':
                    val = (self.get_mmap()[addr][0] & 0xFE) | val
                self.get_mmap()[addr] = bytes([val])
            else:
                super().set_settings([item])
