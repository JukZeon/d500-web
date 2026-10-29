"""Run: CHIRP_FIXTURES=/path/to/chirp/tests/images python -m unittest discover -s radio-core"""
import base64
import copy
import json
import logging
import os
from pathlib import Path
import tempfile
import threading
import unittest
import urllib.request
import urllib.error
import warnings
import engine

logging.disable(logging.CRITICAL)
warnings.filterwarnings('ignore', category=FutureWarning)
FIXTURES = Path(os.environ.get('CHIRP_FIXTURES', '.deploy/chirp-upstream/tests/images'))
FILES = {'uv5r':'Baofeng_UV-5R', 'uvk5-stock':'Quansheng_UV-K5', 'uvk5-losehu':'Quansheng_UV-K5_losehu', 'uvk5-egzumer':'Quansheng_UV-K5_egzumer'}


def fixture(model):
    return engine.driver(model)(str(FIXTURES / (FILES[model] + '.img')))


class EngineTest(unittest.TestCase):
    def test_untouched_image_roundtrip(self):
        for model in FILES:
            with self.subTest(model=model):
                radio = fixture(model)
                restored, notes = engine.prepare(model, engine.image_export(radio))
                self.assertEqual(engine.image_bytes(radio), engine.image_bytes(restored))
                self.assertEqual(notes, [])
                doc = engine.document(restored, model)
                json.dumps(doc, allow_nan=False)
                self.assertGreater(len(doc['channels']), 0)

    def test_tones_tx_rx_split(self):
        radio = fixture('uv5r')
        c = engine.memory_dict(radio, radio.get_memory(0))
        c.update(name='TEST', rx='439.125000', tx='434.125000', rxTone='D023R', txTone='88.5', mode='NFM', power='Low')
        engine.apply_memory(radio, c)
        got = engine.memory_dict(radio, radio.get_memory(0))
        for key in ('name','rx','tx','rxTone','txTone','mode','power'):
            self.assertEqual(c[key],got[key],key)

    def test_receive_only(self):
        radio = fixture('uv5r')
        c = engine.document(radio,'uv5r')['channels'][0]
        c.update(tx='')
        engine.apply_memory(radio,c)
        self.assertEqual(engine.memory_dict(radio,radio.get_memory(c['number']))['tx'],'')

    def test_model_mismatch_rejected(self):
        for target in ('uv5r','uv5rh','uvk5-stock','uvk5-egzumer'):
            with self.subTest(target=target), self.assertRaises(ValueError):
                engine.load_image(target,engine.image_export(fixture('uvk5-losehu')))

    def test_raw_image_rejected(self):
        with self.assertRaises(ValueError):
            engine.load_image('uv5r',base64.b64encode(engine.image_bytes(fixture('uv5r'))).decode())

    def test_channel_number_rejected(self):
        for number in (-1,128,True):
            with self.subTest(number=number),self.assertRaises(ValueError):
                engine.apply_memory(fixture('uv5r'),{'number':number})

    def test_duplicate_rejected(self):
        radio=fixture('uv5r');c=engine.document(radio,'uv5r')['channels'][0]
        with self.assertRaises(ValueError):
            engine.prepare('uv5r',engine.image_export(radio),[c,c])

    def test_chinese_rejected_on_uv5r(self):
        radio=fixture('uv5r');c=engine.document(radio,'uv5r')['channels'][0];c['name']='中文'
        with self.assertRaises(ValueError):engine.apply_memory(radio,c)

    def test_losehu_chinese_and_extended_preserved(self):
        radio=fixture('uvk5-losehu');before=engine.image_bytes(radio)
        c=engine.document(radio,'uvk5-losehu')['channels'][0];c['name']='新会中继'
        engine.apply_memory(radio,c)
        self.assertEqual(engine.memory_dict(radio,radio.get_memory(c['number']))['name'],'新会中继')
        self.assertEqual(before[0x1d00:],engine.image_bytes(radio)[0x1d00:])
        self.assertEqual(len(before),262144)

    def test_losehu_geometry_and_firmware(self):
        cls=engine.driver('uvk5-losehu')
        self.assertEqual(cls.prog_size,0x1d00)
        self.assertEqual(cls.write_block,0x40)
        self.assertTrue(cls.k5_approve_firmware('LOSEHU131HS'))
        self.assertFalse(cls.k5_approve_firmware('UNKNOWN'))

    def test_delete(self):
        r=fixture('uv5r');engine.apply_memory(r,{'number':0,'empty':True});self.assertTrue(r.get_memory(0).empty)

    def test_settings_only_change_requested(self):
        r=fixture('uv5r');tree=engine.settings_tree(r.get_settings())
        def leaves(nodes):
            for n in nodes:
                if 'children' in n:yield from leaves(n['children'])
                else:yield n
        node=next(n for n in leaves(tree) if len(n['values'])==1 and n['values'][0]['type']=='boolean' and n['values'][0]['mutable'])
        new=not node['values'][0]['value']
        engine.apply_settings(r,{node['key']:[new]})
        result=next(n for n in leaves(engine.settings_tree(r.get_settings())) if n['key']==node['key'])
        self.assertEqual(result['values'][0]['value'],new)

    def test_uv5rh_synthetic_layout(self):
        # No upstream UV-5RH hardware fixture: reuse its parent's layout, with
        # synthetic metadata/model trailer. This proves codec paths, not hardware.
        parent=engine.baofeng_uv17Pro.UV17Pro(str(FIXTURES/'Baofeng_UV-17Pro.img'))
        cls=engine.driver('uv5rh')
        blob=engine.image_bytes(parent)[:cls.MEM_TOTAL]+cls.MODEL.encode()
        from chirp import memmap
        r=cls(None);r._mmap=memmap.MemoryMapBytes(blob);r.process_mmap()
        doc=engine.document(r,'uv5rh')
        self.assertEqual(doc['features']['bounds'],[1,1000])
        rebuilt=engine.load_image('uv5rh',doc['image'])
        self.assertEqual(engine.image_bytes(r),engine.image_bytes(rebuilt))
        c=doc['channels'][0];c.update(name='RELAY',rx='439.125000',tx='434.125000',rxTone='88.5',txTone='88.5',mode='NFM',power='Medium')
        engine.apply_memory(rebuilt,c)
        got=engine.memory_dict(rebuilt,rebuilt.get_memory(c['number']))
        self.assertEqual(got['name'],'RELAY');self.assertEqual(got['tx'],'434.125000')


class LosehuSettingsTest(unittest.TestCase):
    def test_squelch_changes_one_byte(self):
        r=fixture('uvk5-losehu');before=engine.image_bytes(r)
        engine.apply_settings(r,{'/losehu_basic/losehu_squelch':[3]})
        after=engine.image_bytes(r)
        self.assertEqual([i for i,(a,b) in enumerate(zip(before,after)) if a!=b],[0xe71])
        self.assertEqual(after[0xe71],3)
    def test_packed_beep_preserves_other_bits(self):
        r=fixture('uvk5-losehu');r.get_mmap()[0xe90]=bytes([0xa5])
        engine.apply_settings(r,{'/losehu_basic/losehu_beep':[False]})
        self.assertEqual(engine.image_bytes(r)[0xe90],0xa4)
    def test_unknown_firmware_no_basic_controls(self):
        r=fixture('uvk5-losehu');r.metadata={'uvk5_firmware':'LOSEHU120K'}
        self.assertFalse(r.basic_settings_supported)
        self.assertEqual(len(engine.settings_tree(r.get_settings())),1)
    def test_write_ranges_never_reach_calibration(self):
        from unittest.mock import patch
        r=fixture('uvk5-losehu')
        class Pipe:
            timeout=0
        r.pipe=Pipe();r.status_fn=lambda status:None;writes=[]
        r._write_mem_block=lambda pipe,data,addr:writes.append((addr,len(data)))
        with patch.object(engine.uvk5,'_sayhello',return_value='LOSEHU131HS'),patch.object(engine.uvk5,'_resetradio'):
            r.sync_out()
        self.assertEqual(writes[0],(0,64));self.assertEqual(writes[-1],(0x1cc0,64))
        self.assertEqual(sum(n for a,n in writes),0x1d00)

if __name__=='__main__':unittest.main()
