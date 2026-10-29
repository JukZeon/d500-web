"""Browser-only entry point. Serial I/O is provided by a Web Serial worker RPC."""
import json
from radio_io import rpc, progress
import engine


class BrowserPipe:
    def __init__(self, baudrate):
        self.baudrate = baudrate
        self.timeout = 1.0
        self.parity = 'N'

    def read(self, size=1):
        result = json.loads(rpc(json.dumps({'op': 'read', 'size': size, 'timeout': self.timeout})))
        if 'error' in result:
            raise OSError(result['error'])
        return bytes(result['data'])

    def write(self, data):
        result = json.loads(rpc(json.dumps({'op': 'write', 'data': list(data)})))
        if 'error' in result:
            raise OSError(result['error'])
        return len(data)

    def log(self, message):
        pass

    def flush(self):
        pass

    def reset_input_buffer(self):
        result = json.loads(rpc(json.dumps({'op': 'purge'})))
        if 'error' in result:
            raise OSError(result['error'])


def perform(request_json):
    request = json.loads(request_json)
    action, model = request['action'], request['model']
    if action == 'image':
        return json.dumps(engine.document(engine.load_image(model, request['image']), model))
    if action == 'prepare':
        radio, notes = engine.prepare(model, request['image'], request.get('channels'), request.get('settings'))
        return json.dumps({'document': engine.document(radio, model), 'warnings': notes})
    cls = engine.driver(model)
    if action == 'read':
        radio = cls(None)
    elif action == 'write':
        radio, unused = engine.prepare(model, request['image'], request.get('channels'), request.get('settings'))
    else:
        raise ValueError('未知电台操作')
    radio.pipe = BrowserPipe(radio.BAUD_RATE)
    radio.status_fn = lambda status: progress(status.cur, max(1, status.max))
    if action == 'read':
        radio.sync_in()
    else:
        radio.sync_out()
    return json.dumps(engine.document(radio, model))
