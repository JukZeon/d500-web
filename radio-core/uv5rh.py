"""Ordinary UV-5RH codeplug adapter, checked against a physical Chinese radio.

The wire protocol and structure come from the pinned UV17Pro-family driver.
The 12-byte channel name field is GBK, not a Python single-byte string.
Channel edits retain bytes and flags outside the changed semantic fields.
"""
from chirp import chirp_common as cc, errors
from chirp.drivers.baofeng_uv17Pro import UV5RH


def gbk_characters():
    chars = [chr(value) for value in range(32, 127)]
    for lead in range(0x81, 0xff):
        for trail in range(0x40, 0xff):
            if trail == 0x7f:
                continue
            try:
                chars.append(bytes([lead, trail]).decode('gbk'))
            except UnicodeDecodeError:
                pass
    return ''.join(chars)


GBK_CHARACTERS = gbk_characters()


def decode_name(raw):
    return raw.split(b'\x00', 1)[0].split(b'\xff', 1)[0].decode('gbk', errors='replace').rstrip()


def encode_name(name):
    if any(char in name for char in '\x00\r\n\t'):
        raise errors.InvalidValueError('信道名称包含控制字符')
    try:
        encoded = name.encode('gbk')
    except UnicodeEncodeError as error:
        raise errors.InvalidValueError('信道名称含有 GBK 无法编码的字符') from error
    if len(encoded) > 12:
        raise errors.InvalidValueError(f'信道名称占 {len(encoded)} 字节，最多 12 字节（6 个汉字）')
    return encoded.ljust(12, b'\xff')


def tx_frequency(memory):
    if memory.duplex == 'off':
        return None
    if memory.duplex == 'split':
        return memory.offset
    return memory.freq + (memory.offset if memory.duplex == '+' else -memory.offset if memory.duplex == '-' else 0)


def extras(memory):
    return {setting.get_name(): str(setting.value) for setting in memory.extra}


class UV5RHRadio(UV5RH):
    NAME_BYTES = 12
    NAME_ENCODING = 'gbk'
    VALID_CHARS = GBK_CHARACTERS

    def get_features(self):
        features = super().get_features()
        # Stored memories use 10 Hz BCD units, independent of the VFO tuning step.
        features.has_nostep_tuning = True
        return features

    def get_memory(self, number):
        memory = super().get_memory(number)
        if not memory.empty:
            memory.name = decode_name(self._get_raw_memory(number).get_raw()[20:32])
        return memory

    def set_memory(self, memory):
        entry = self._get_raw_memory(memory.number)
        original = entry.get_raw()
        if memory.empty:
            entry.set_raw(b'\xff' * 32)
            return
        previous = self.get_memory(memory.number) if original[0] != 0xff else None
        name = original[20:32] if previous and previous.name == memory.name else encode_name(memory.name)
        if previous is None:
            entry.set_raw(b'\x00' * 16 + b'\xff' * 16)
        self.set_memory_common(memory, entry)
        updated = bytearray(entry.get_raw())
        if previous:
            if memory.freq == previous.freq:
                updated[0:4] = original[0:4]
            if tx_frequency(memory) == tx_frequency(previous):
                updated[4:8] = original[4:8]
            new_tones, old_tones = cc.split_tone_encode(memory), cc.split_tone_encode(previous)
            if new_tones[1] == old_tones[1]:
                updated[8:10] = original[8:10]
            if new_tones[0] == old_tones[0]:
                updated[10:12] = original[10:12]
            new_extra, old_extra = extras(memory), extras(previous)
            for key, offset in [('scode', 12), ('pttid', 13)]:
                if new_extra.get(key) == old_extra.get(key):
                    updated[offset] = original[offset]
            if memory.power == previous.power:
                updated[14] = (updated[14] & 0xfc) | (original[14] & 3)
            if memory.mode == previous.mode:
                updated[15] = (updated[15] & 0xbf) | (original[15] & 0x40)
        updated[20:32] = name
        entry.set_raw(bytes(updated))

    def validate_memory(self, memory):
        messages = super().validate_memory(memory)
        try:
            encode_name(memory.name)
        except errors.InvalidValueError as error:
            messages.append(cc.ValidationError(str(error)))
        if memory.freq % 10 or (tx_frequency(memory) or 0) % 10:
            messages.append(cc.ValidationError('UV-5RH 频率需为 10 Hz 的整数倍'))
        return messages


def _read_exact(radio, size, stage):
    data = radio.pipe.read(size)
    if len(data) != size:
        raise errors.RadioError(f'{stage}：收到 {len(data)}/{size} 字节')
    return data


def _read_block(radio, address):
    radio.pipe.write(radio._make_read_frame(address, radio.BLOCK_SIZE))
    reply = _read_exact(radio, radio.BLOCK_SIZE + 4, f'读取 0x{address:04X}')
    expected = b'R' + address.to_bytes(2, 'big') + bytes([radio.BLOCK_SIZE])
    if reply[:4] != expected:
        raise errors.RadioError(f'读取 0x{address:04X}：数据帧地址或长度不匹配')
    return reply[4:]


def identify(radio):
    """A recently closed clone session can still be active on the radio.

    Physical captures show PROGRAM... then returns R instead of a fresh ACK.
    Drain that response and confirm the existing session with an addressed read.
    No writes are retried and no complete pre-write download is performed.
    """
    saved_timeout = radio.pipe.timeout
    try:
        radio.pipe.timeout = .05
        for _ in range(4):
            if not radio.pipe.read(256):
                break
        radio.pipe.timeout = 1.5
        radio.pipe.write(radio._idents[0])
        ack = _read_exact(radio, 1, '识别电台')
        if ack == b'R':
            radio.pipe.timeout = .05
            for _ in range(4):
                if not radio.pipe.read(256):
                    break
            radio.pipe.timeout = 1.5
            _read_block(radio, 0)
            return
        if ack != b'\x06':
            raise errors.RadioError(f'识别电台：非预期响应 {ack.hex().upper()}')
        for magic, size in radio._magics:
            radio.pipe.write(magic)
            _read_exact(radio, size, '进入写频模式')
    finally:
        radio.pipe.timeout = saved_timeout


def download(radio):
    from chirp.drivers.baofeng_uv17Pro import _crypt
    identify(radio)
    radio.pipe.timeout = 1.5
    status = cc.Status(); status.max = radio.MEM_TOTAL // radio.BLOCK_SIZE; status.cur = 0
    data = bytearray()
    for start, size in zip(radio.MEM_STARTS, radio.MEM_SIZES):
        for address in range(start, start + size, radio.BLOCK_SIZE):
            data.extend(_crypt(radio._encrsym, _read_block(radio, address)))
            status.cur = len(data) // radio.BLOCK_SIZE
            radio.status_fn(status)
    return bytes(data)


def upload(radio):
    from chirp.drivers.baofeng_uv17Pro import _crypt
    payload = radio.get_mmap().get_byte_compatible().get_packed()
    if len(payload) < radio.MEM_TOTAL:
        raise errors.RadioError('配置镜像长度不足')
    identify(radio)
    radio.pipe.timeout = 1.5
    status = cc.Status(); status.max = radio.MEM_TOTAL // radio.BLOCK_SIZE; status.cur = 0
    offset = 0
    for start, size in zip(radio.MEM_STARTS, radio.MEM_SIZES):
        for address in range(start, start + size, radio.BLOCK_SIZE):
            data = payload[offset:offset + radio.BLOCK_SIZE]
            radio.pipe.write(radio._make_frame(b'W', address, radio.BLOCK_SIZE, _crypt(radio._encrsym, data)))
            ack = _read_exact(radio, 1, f'写入 0x{address:04X}')
            if ack != b'\x06':
                raise errors.RadioError(f'写入 0x{address:04X}：设备未确认，已停止')
            offset += radio.BLOCK_SIZE; status.cur = offset // radio.BLOCK_SIZE
            radio.status_fn(status)


UV5RHRadio.download_function = download
UV5RHRadio.upload_function = upload
