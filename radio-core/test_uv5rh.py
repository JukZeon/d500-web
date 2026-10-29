import os
import base64
from pathlib import Path
import unittest
import engine
from uv5rh import decode_name, encode_name
from chirp import memmap

FIXTURES=Path(os.environ.get('CHIRP_FIXTURES','.deploy/chirp-test-fixtures'))

def fixture():
    parent=engine.baofeng_uv17Pro.UV17Pro(str(FIXTURES/'Baofeng_UV-17Pro.img'))
    radio=engine.driver('uv5rh')(None)
    radio._mmap=memmap.MemoryMapBytes(engine.image_bytes(parent)[:radio.MEM_TOTAL])
    radio.process_mmap()
    memory=engine.cc.Memory();memory.number=1;memory.freq=439125000
    memory.duplex='-';memory.offset=5000000;memory.mode='NFM';memory.name='TEST'
    memory.power=radio.POWER_LEVELS[1];memory.extra=[];memory.empty=False
    radio.set_memory(memory)
    return radio


class FakePipe:
    timeout=1.5
    def __init__(self,radio,active=False):
        self.radio=radio;self.active=active;self.buffer=bytearray();self.writes=[]
        self.payload=bytearray(engine.image_bytes(radio));self.bad_header=False;self.reject_write=False
    def read(self,size):
        result=bytes(self.buffer[:size]);del self.buffer[:size];return result
    def write(self,data):
        from chirp.drivers.baofeng_uv17Pro import _crypt
        self.writes.append(data)
        if data==self.radio._idents[0]:
            self.buffer.extend(b'R'+bytes(85) if self.active else b'\x06');return len(data)
        for magic,size in self.radio._magics:
            if data==magic:self.buffer.extend(bytes([6])*size);self.active=True;return len(data)
        address=int.from_bytes(data[1:3],'big');size=data[3]
        offset=0
        for start,length in zip(self.radio.MEM_STARTS,self.radio.MEM_SIZES):
            if start<=address<start+length:
                offset+=address-start;break
            offset+=length
        if data[0]==ord('R'):
            header=b'R'+(address+(64 if self.bad_header else 0)).to_bytes(2,'big')+bytes([size])
            self.buffer.extend(header+_crypt(self.radio._encrsym,self.payload[offset:offset+size]))
        elif data[0]==ord('W'):
            self.payload[offset:offset+size]=_crypt(self.radio._encrsym,data[4:])
            self.buffer.extend(b'\x15' if self.reject_write else b'\x06')
        else:raise AssertionError('Unexpected frame')
        return len(data)


class UV5RHChineseTest(unittest.TestCase):
    def test_chinese_name_storage_and_decode(self):
        radio=fixture();entry=radio._get_raw_memory(1)
        entry.name.set_raw('中文名称测试'.encode('gbk'))
        self.assertEqual(radio.get_memory(1).name,'中文名称测试')
        self.assertEqual(engine.features(radio)['nameBytes'],12)
        self.assertEqual(engine.features(radio)['nameEncoding'],'gbk')
        self.assertEqual(decode_name(encode_name('AB中文名称')),'AB中文名称')

    def test_name_edit_changes_only_name_bytes_and_retains_unknown_fields(self):
        radio=fixture();entry=radio._get_raw_memory(1)
        raw=bytearray(entry.get_raw());raw[14]|=0xfc;raw[15]|=0xb3;raw[16:20]=bytes([0x52,0x91,0xa5,0xc3]);raw[8:10]=b'\xff\xff'
        entry.set_raw(bytes(raw));before=engine.image_bytes(radio)
        channel=engine.memory_dict(radio,radio.get_memory(1));channel['name']='中文名称测试'
        engine.apply_memory(radio,channel);after=engine.image_bytes(radio)
        self.assertEqual(after[:20],before[:20]);self.assertEqual(after[32:],before[32:])
        self.assertEqual(after[20:32],'中文名称测试'.encode('gbk'))
        self.assertEqual(radio.get_memory(1).name,'中文名称测试')

    def test_semantically_unchanged_channel_is_byte_identical(self):
        radio=fixture();entry=radio._get_raw_memory(1)
        raw=bytearray(entry.get_raw());raw[14]|=0xfc;raw[15]|=0xb3;raw[16:20]=bytes([0x52,0x91,0xa5,0xc3]);raw[8:10]=b'\xff\xff';raw[20:32]=encode_name('测试')
        entry.set_raw(bytes(raw));before=engine.image_bytes(radio)
        engine.apply_memory(radio,engine.memory_dict(radio,radio.get_memory(1)))
        self.assertEqual(engine.image_bytes(radio),before)

    def test_byte_budget_rejects_overflow_without_modification(self):
        radio=fixture();before=engine.image_bytes(radio)
        for name in ['一二三四五六七','A一二三四五六','中文😀']:
            channel=engine.memory_dict(radio,radio.get_memory(1));channel['name']=name
            with self.subTest(name=name),self.assertRaises((ValueError,engine.errors.InvalidValueError)):
                engine.apply_memory(radio,channel)
            self.assertEqual(engine.image_bytes(radio),before)
        for name in ['一二三四五六','ABCDEFGHIJKL','ABCD一二三四']:
            channel=engine.memory_dict(radio,radio.get_memory(1));channel['name']=name
            engine.apply_memory(radio,channel);self.assertEqual(radio.get_memory(1).name,name)

    def test_img_roundtrip_with_chinese_preserves_all_bytes(self):
        radio=fixture();radio._get_raw_memory(1).name.set_raw(encode_name('中文测试'))
        document=engine.document(radio,'uv5rh');restored=engine.load_image('uv5rh',document['image'])
        self.assertEqual(engine.image_bytes(restored),engine.image_bytes(radio))
        self.assertEqual(restored.get_memory(1).name,'中文测试')

    def test_name_and_frequency_change_keep_unexposed_flags(self):
        radio=fixture();entry=radio._get_raw_memory(1);raw=bytearray(entry.get_raw());raw[14]|=0xfc;raw[15]|=0xb3;raw[16:20]=bytes([1,2,3,4]);entry.set_raw(bytes(raw))
        channel=engine.memory_dict(radio,radio.get_memory(1));channel.update(name='中文测试',rx='439.125000',tx='',rxTone='D023R',txTone='88.5',mode='NFM',power='Low')
        engine.apply_memory(radio,channel);after=entry.get_raw()
        self.assertEqual(after[14]&0xfc,raw[14]&0xfc);self.assertEqual(after[15]&0xb3,raw[15]&0xb3);self.assertEqual(after[16:20],raw[16:20])
        result=engine.memory_dict(radio,radio.get_memory(1));self.assertEqual(result['rx'],'439.125000');self.assertEqual(result['tx'],'');self.assertEqual(result['rxTone'],'D023R')


class UV5RHSessionTest(unittest.TestCase):
    def test_fresh_read_then_warm_write_then_read(self):
        radio=fixture();expected=engine.image_bytes(radio);pipe=FakePipe(radio)
        radio.pipe=pipe;radio.status_fn=lambda status:None
        radio.sync_in();self.assertEqual(engine.image_bytes(radio),expected)
        radio.sync_out();self.assertEqual(bytes(pipe.payload),expected)
        radio.sync_in();self.assertEqual(engine.image_bytes(radio),expected)
        self.assertEqual(sum(frame[0]==ord('W') for frame in pipe.writes),526)
    def test_incorrect_block_header_is_not_decoded_as_channel_data(self):
        radio=fixture();pipe=FakePipe(radio);pipe.bad_header=True;radio.pipe=pipe;radio.status_fn=lambda status:None
        with self.assertRaisesRegex(engine.errors.RadioError,'地址或长度'):
            radio.sync_in()
    def test_missing_write_ack_stops_without_retransmission(self):
        radio=fixture();pipe=FakePipe(radio);pipe.reject_write=True;radio.pipe=pipe;radio.status_fn=lambda status:None
        with self.assertRaisesRegex(engine.errors.RadioError,'设备未确认'):
            radio.sync_out()
        self.assertEqual(sum(frame[0]==ord('W') for frame in pipe.writes),1)
