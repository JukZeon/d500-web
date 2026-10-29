"""Audited LOSEHU basic settings extension; unrelated bytes remain untouched.

Source: losehu/uv-k5-firmware-custom settings.c, revision
49222a9f431a006dfaaaa665b839e4953b1a1882, SETTINGS_InitEEPROM / save.
The bundled legacy CHIRP script uses obsolete side-key addresses; those keys
are deliberately NOT exposed here. No calibration, passwords, locks or boot
code are editable. Byte offsets must not be inferred from OEM settings.
"""
import re
from chirp.drivers.uvk5_cn import UVK5LoseHuRadio, NAME_BYTES as LOSEHU_NAME_BYTES
from chirp.settings import (RadioSetting, RadioSettingGroup,
                            RadioSettingValueInteger, RadioSettingValueBoolean, RadioSettingValueList)

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
    NAME_BYTES = LOSEHU_NAME_BYTES
    NAME_ENCODING = 'gb2312'
    @property
    def basic_settings_supported(self):
        # Reference capture 131HS and 132 family use the audited layout.
        return bool(re.fullmatch(r'LOSEHU(?:131HS|132(?:EK|HS|H|K|E)?)',
                                 self.metadata.get('uvk5_firmware', '')))

    def get_settings(self):
        root = super().get_settings()
        # Geometry is determined by the image; avoid presenting controls which
        # affect the host driver's runtime rather than EEPROM settings.
        for item in root[0]:
            for value in item:
                value.set_mutable(False)
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
