"""Private HTTP transport for the project-owned engine. Bind behind authenticated TLS."""
import base64,json,os,secrets
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
from engine import Engine,FaceError

secret=os.environ.get('GAES_FACE_SERVICE_KEY','')
if len(secret)<32:
    raise RuntimeError('GAES_FACE_SERVICE_KEY must contain at least 32 characters')
key=base64.b64decode(os.environ['GAES_FACE_ENCRYPTION_KEY'],validate=True)
state=Path(os.environ.get('GAES_FACE_DATA_DIR','./state'));state.mkdir(mode=0o700,parents=True,exist_ok=True)
os.umask(0o077)
engine=Engine(Path(__file__).parent/'models',str(state/'references.sqlite3'),key,float(os.environ.get('GAES_FACE_THRESHOLD','0.5')))

class Handler(BaseHTTPRequestHandler):
    def log_message(self,*_):
        pass # Do not log biometric requests, credentials or identity references.
    def respond(self,status,data):
        body=json.dumps(data).encode();self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Cache-Control','no-store');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
    def do_POST(self):
        if not secrets.compare_digest(self.headers.get('Authorization',''),'Bearer '+secret):
            self.respond(401,{'error':'UNAUTHORIZED'});return
        try:
            length=int(self.headers.get('Content-Length','0'))
            if not 0<length<4500000:
                self.respond(413,{'error':'PAYLOAD_TOO_LARGE'});return
            self.connection.settimeout(12)
            data=json.loads(self.rfile.read(length))
            if not isinstance(data,dict):raise FaceError('INVALID_INPUT')
            if self.path=='/health':result={'ready':True,'mode':'ONE_TO_ONE','livenessReady':False}
            elif self.path=='/detect':result=engine.detect(data.get('capture'))
            elif self.path=='/enroll':result=engine.enroll(data.get('subjectKey'),data.get('photos'))
            elif self.path=='/verify':result=engine.verify(data.get('subjectKey'),data.get('referenceId'),data.get('sessionId'),data.get('capture'))
            else:self.respond(404,{'error':'NOT_FOUND'});return
            self.respond(200,result)
        except FaceError as e:self.respond(422,{'error':str(e)})
        except Exception:self.respond(503,{'error':'ENGINE_UNAVAILABLE'})
    def do_GET(self):self.respond(405,{'error':'METHOD_NOT_ALLOWED'})

if __name__=='__main__':
    ThreadingHTTPServer((os.environ.get('GAES_FACE_BIND','127.0.0.1'),int(os.environ.get('GAES_FACE_PORT','8765'))),Handler).serve_forever()
