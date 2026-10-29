"""Embedded browser CHIRP adapter. No firmware flashing and no arbitrary driver loading."""
import base64
import builtins
import copy
import json
from pathlib import Path
import sys
import tempfile

# Drivers normally receive gettext from the desktop application.
if not hasattr(builtins, '_'):
    builtins._ = lambda text: text
sys.path.insert(0, str(Path(__file__).parent / 'vendor' / 'chirp.zip'))
from chirp import chirp_common as cc, errors
from chirp import settings as cs
from chirp.drivers import uv5r, uvk5, uvk5_egzumer, uvk5_cn, baofeng_uv17Pro

from losehu import LosehuRadio

DRIVERS = {
    'uv5r': uv5r.BaofengUV5R,
    'uv5rh': baofeng_uv17Pro.UV5RH,
    'uvk5-stock': uvk5.UVK5Radio,
    'uvk5-losehu': LosehuRadio,
    'uvk5-egzumer': uvk5_egzumer.UVK5RadioEgzumer,
}
REVISION = '0b4076d9b19a2a133d11f31546cff8153b39eb89'


def driver(model):
    if model not in DRIVERS:
        raise ValueError('不支持的型号／固件')
    return DRIVERS[model]


def features(radio):
    f = radio.get_features()
    return dict(bounds=list(f.memory_bounds), nameLength=f.valid_name_length,
                characters=f.valid_characters, modes=f.valid_modes,
                bands=f.valid_bands, powers=[str(p) for p in f.valid_power_levels],
                steps=f.valid_tuning_steps, skips=f.valid_skips,
                tones=list(cc.TONES), dtcs=list(f.valid_dtcs_codes),
                hasSettings=f.has_settings, hasStep=f.has_tuning_step)


def field_value(value):
    result = {'mutable': value.get_mutable()}
    if isinstance(value, cs.RadioSettingValueList):
        result.update(type='list', value=str(value), options=value.get_options())
    elif isinstance(value, cs.RadioSettingValueBoolean):
        result.update(type='boolean', value=bool(value))
    elif isinstance(value, (cs.RadioSettingValueInteger, cs.RadioSettingValueFloat)):
        result.update(type='number', value=value.get_value(), min=value.get_min(), max=value.get_max(),
                      step=value.get_step() if hasattr(value, 'get_step') else 0.01)
    elif isinstance(value, cs.RadioSettingValueString):
        result.update(type='string', value=str(value), min=value.minlength, max=value.maxlength)
    else:
        result.update(type='string', value=str(value), mutable=False)
    return result


def settings_tree(group, path=''):
    if group is None:
        raise ValueError('驱动无法解析此镜像的设置')
    result = []
    for item in group:
        key = path + '/' + item.get_name()
        node = dict(key=key, label=item.get_shortname())
        if isinstance(item, cs.RadioSetting):
            node['values'] = [field_value(v) for v in item]
            node['doc'] = item.__doc__ or ''
        else:
            node['children'] = settings_tree(item, key)
        result.append(node)
    return result


def apply_settings(radio, edits):
    if not edits:
        return
    root = radio.get_settings()
    found = set()
    changed = []
    def walk(group, path=''):
        for item in group:
            key = path + '/' + item.get_name()
            if not isinstance(item, cs.RadioSetting):
                walk(item, key)
            elif key in edits:
                values = list(item)
                if len(values) != len(edits[key]):
                    raise ValueError('设置值数量错误')
                for v, next_value in zip(values, edits[key]):
                    spec = field_value(v)
                    if next_value == spec['value']:
                        continue
                    if not v.get_mutable():
                        raise ValueError('该设置不可修改')
                    if spec['type'] == 'boolean' and not isinstance(next_value, bool):
                        raise ValueError('开关值错误')
                    if spec['type'] == 'number' and (isinstance(next_value, bool) or not isinstance(next_value, (int, float))):
                        raise ValueError('数值格式错误')
                    v.set_value(next_value)
                found.add(key)
                if item.changed():
                    changed.append(item)
    walk(root)
    if found != set(edits):
        raise ValueError('未知设置字段')
    radio.set_settings(changed)


def tone_text(mode, value, polarity):
    if not mode:
        return ''
    if mode == 'DTCS':
        return f'D{value:03d}{polarity}'
    return f'{value:.1f}'


def parse_tone(text):
    import re
    if not text:
        return ('', None, None)
    match = re.fullmatch(r'D(\d{3})([NR])', text.upper())
    if match:
        return ('DTCS', int(match[1]), match[2])
    value = float(text)
    if value <= 0:
        raise ValueError('哑音无效')
    return ('Tone', value, None)


def memory_dict(radio, mem):
    mem = radio.get_memory_extra(mem)
    tx, rx = cc.split_tone_encode(mem)
    tx_freq = mem.freq + mem.offset if mem.duplex == '+' else mem.freq - mem.offset if mem.duplex == '-' else mem.offset if mem.duplex == 'split' else mem.freq
    return dict(number=mem.number, name=mem.name, rx=f'{mem.freq / 1e6:.6f}',
                tx='' if mem.duplex == 'off' else f'{tx_freq / 1e6:.6f}',
                rxTone=tone_text(*rx), txTone=tone_text(*tx), mode=mem.mode,
                power=str(mem.power) if mem.power else '', skip=mem.skip,
                step=mem.tuning_step, comment=mem.comment,
                extra=settings_tree(mem.extra) if mem.extra else [])


def apply_memory(radio, data):
    number = data.get('number')
    lo, hi = radio.get_features().memory_bounds
    if isinstance(number, bool) or not isinstance(number, int) or not lo <= number <= hi:
        raise ValueError('信道编号越界')
    mem = radio.get_memory(number)
    if data.get('empty') is True:
        mem.empty = True
        mem.comment = ''
        radio.set_memory_extra(mem)
        radio.set_memory(mem)
        return []
    f = radio.get_features()
    before = memory_dict(radio, mem) if not mem.empty else None
    mem.empty = False
    name = data['name']
    # Preserve pre-existing long GB2312 names unless the name itself is edited.
    if before is None or name != before['name']:
        if len(name) > f.valid_name_length or any(c not in f.valid_characters for c in name):
            raise ValueError('信道名称超出该型号的长度或字符范围')
    mem.name = name
    mem.freq = cc.parse_freq(data['rx'])
    tx = data['tx']
    if tx == '':
        mem.duplex, mem.offset = 'off', 0
    else:
        freq = cc.parse_freq(tx)
        delta = freq - mem.freq
        if delta == 0:
            mem.duplex, mem.offset = '', 0
        elif 'split' in f.valid_duplexes:
            mem.duplex, mem.offset = 'split', freq
        else:
            mem.duplex, mem.offset = ('+' if delta > 0 else '-'), abs(delta)
    cc.split_tone_decode(mem, parse_tone(data['txTone']), parse_tone(data['rxTone']))
    mem.mode = data['mode']
    powers = {str(p): p for p in f.valid_power_levels}
    if data.get('power'):
        if data['power'] not in powers:
            raise ValueError('功率选项不适用于此型号')
        mem.power = powers[data['power']]
    mem.skip = data.get('skip', '')
    if f.has_tuning_step:
        mem.tuning_step = float(data.get('step', mem.tuning_step))
    mem.comment = str(data.get('comment', ''))[:256]
    if data.get('extraEdits'):
        # Per-channel advanced fields use the same typed tree contract.
        class Extra:
            def get_settings(self): return mem.extra
            def set_settings(self, unused): pass
        apply_settings(Extra(), data['extraEdits'])
    issues = radio.validate_memory(mem)
    bad = [str(i) for i in issues if isinstance(i, cc.ValidationError)]
    if bad:
        raise ValueError(f'信道 {number}: ' + '; '.join(bad))
    radio.set_memory(mem)
    radio.set_memory_extra(mem)
    return [str(i) for i in issues]


def image_bytes(radio):
    return radio.get_mmap().get_byte_compatible().get_packed()


def image_export(radio):
    return base64.b64encode(image_bytes(radio) + radio.MAGIC + radio._make_metadata()).decode('ascii')


def load_image(model, encoded):
    cls = driver(model)
    blob = base64.b64decode(encoded, validate=True)
    if len(blob) > 600_000:
        raise ValueError('镜像过大')
    raw, meta = cls._strip_metadata(blob)
    if not meta or meta.get('model') != cls.MODEL or meta.get('vendor') != cls.VENDOR or meta.get('variant', '') != cls.VARIANT:
        raise ValueError('镜像型号／固件不匹配，需要带型号信息的 CHIRP IMG')
    expected = (0x1808, 0x1948) if model == 'uv5r' else (cls.MEM_TOTAL + len(cls.MODEL), cls.MEM_TOTAL) if model == 'uv5rh' else (0x2000,) if model != 'uvk5-losehu' else (0x2000, 0x4000, 0x8000, 0x10000, 0x20000, 0x40000)
    if len(raw) not in expected:
        raise ValueError('镜像长度不符合所选驱动')
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / 'radio.img'
        path.write_bytes(blob)
        return cls(str(path))


def document(radio, model):
    lo, hi = radio.get_features().memory_bounds
    channels = []
    for n in range(lo, hi + 1):
        mem = radio.get_memory(n)
        if not mem.empty:
            channels.append(memory_dict(radio, mem))
    return dict(schema='radio-workbench-chirp-v1', model=model, driverRevision=REVISION,
                features=features(radio), channels=channels,
                settings=settings_tree(radio.get_settings()) if radio.get_features().has_settings else [],
                image=image_export(radio), firmware=radio.metadata.get('uvk5_firmware', ''),
                settingsLimited=model == 'uvk5-losehu',
                settingsCoverage=('basic' if radio.basic_settings_supported else 'channels') if model == 'uvk5-losehu' else 'driver')


def prepare(model, image, channels=None, settings=None):
    radio = load_image(model, image)
    warnings = []
    seen = set()
    for channel in channels or []:
        if channel['number'] in seen:
            raise ValueError('重复的信道编号')
        seen.add(channel['number'])
        warnings += apply_memory(radio, channel)
    apply_settings(radio, settings or {})
    return radio, warnings
