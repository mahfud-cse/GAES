"""GAES single-reference face verification. No identity search endpoint exists."""
import base64, hashlib, json, os, secrets, sqlite3, threading, time
from pathlib import Path
import cv2
import numpy as np
from prepare_models import prepare_models
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

class FaceError(ValueError):
    pass

class Engine:
    def __init__(self, models, database, encryption_key, threshold=0.5):
        if len(encryption_key) != 32:
            raise ValueError('A 32-byte encryption key is required')
        if not 0 < threshold < 1:
            raise ValueError('Invalid threshold')
        prepare_models(models)
        manifest=json.loads((Path(models)/'MODEL_MANIFEST.json').read_text())
        for filename in ['yunet.onnx','sface.onnx']:
            expected=next(x['sha256'] for x in manifest['files'] if x['file']==filename)
            if not secrets.compare_digest(hashlib.sha256((Path(models)/filename).read_bytes()).hexdigest(),expected):
                raise ValueError('MODEL_INTEGRITY_FAILED')
        self.threshold = threshold
        self.lock = threading.RLock()
        self.detector = cv2.FaceDetectorYN.create(str(Path(models)/'yunet.onnx'), '', (320,320), 0.9, 0.3, 5000)
        self.recognizer = cv2.FaceRecognizerSF.create(str(Path(models)/'sface.onnx'), '')
        self.cipher = AESGCM(encryption_key)
        self.db = sqlite3.connect(database, check_same_thread=False)
        self.db.execute('CREATE TABLE IF NOT EXISTS references_v1 (id TEXT PRIMARY KEY, subject_hash TEXT NOT NULL, nonce BLOB NOT NULL, ciphertext BLOB NOT NULL, created_at REAL NOT NULL)')
        self.db.commit()
    def decode(self, data):
        if not isinstance(data,str) or len(data)>1500000 or not data.startswith(('data:image/jpeg;base64,','data:image/png;base64,','data:image/webp;base64,')):
            raise FaceError('INVALID_PHOTO')
        try:
            raw=base64.b64decode(data.split(',',1)[1], validate=True)
        except Exception:
            raise FaceError('INVALID_PHOTO') from None
        if len(raw)>1000000:
            raise FaceError('PHOTO_TOO_LARGE')
        # Parse image dimensions before decoding to reject decompression bombs.
        from PIL import Image
        import io
        try:
            with Image.open(io.BytesIO(raw)) as meta:
                if meta.width*meta.height>12000000 or min(meta.width,meta.height)<80:
                    raise FaceError('INVALID_PHOTO')
        except FaceError:
            raise
        except Exception:
            raise FaceError('INVALID_PHOTO') from None
        image=cv2.imdecode(np.frombuffer(raw,dtype=np.uint8),cv2.IMREAD_COLOR)
        if image is None:
            raise FaceError('INVALID_PHOTO')
        h,w=image.shape[:2]
        if max(h,w)>1280:
            image=cv2.resize(image,(int(w*1280/max(h,w)),int(h*1280/max(h,w))))
        return image
    def faces(self,image):
        h,w=image.shape[:2]
        self.detector.setInputSize((w,h))
        _,faces=self.detector.detect(image)
        return [] if faces is None else faces
    def detect(self,data):
        with self.lock:
            return {'faceCount':len(self.faces(self.decode(data)))}
    def feature(self,data):
        image=self.decode(data)
        faces=self.faces(image)
        if len(faces)!=1:
            raise FaceError('EXACTLY_ONE_FACE_REQUIRED')
        face=faces[0]
        if min(face[2],face[3])<65:
            raise FaceError('FACE_TOO_SMALL')
        aligned=self.recognizer.alignCrop(image,face)
        if float(cv2.Laplacian(cv2.cvtColor(aligned,cv2.COLOR_BGR2GRAY),cv2.CV_64F).var())<25:
            raise FaceError('PHOTO_BLURRED')
        embedding=self.recognizer.feature(aligned).flatten().astype(np.float32)
        norm=np.linalg.norm(embedding)
        if not np.isfinite(norm) or norm<1e-8:
            raise FaceError('INVALID_PHOTO')
        return embedding/norm
    def enroll(self,subject,photos):
        if not isinstance(subject,str) or not 1<=len(subject)<=160 or not isinstance(photos,list) or not 1<=len(photos)<=3:
            raise FaceError('INVALID_INPUT')
        with self.lock:
            features=[self.feature(photo) for photo in photos]
            if any(float(np.dot(features[0],f))<self.threshold for f in features[1:]):
                raise FaceError('INCONSISTENT_ENROLLMENT')
            feature=np.mean(features,axis=0); feature=feature/np.linalg.norm(feature)
            reference=secrets.token_hex(24)
            subject_hash=hashlib.sha256(subject.encode()).hexdigest()
            nonce=secrets.token_bytes(12)
            encoded=json.dumps({'embedding':feature.tolist(),'subject':subject_hash,'model':'SFace-2021dec'}).encode()
            ciphertext=self.cipher.encrypt(nonce,encoded,reference.encode())
            self.db.execute('INSERT INTO references_v1 VALUES (?,?,?,?,?)',(reference,subject_hash,nonce,ciphertext,time.time()))
            self.db.commit()
            return {'verified':True,'referenceId':reference,'livenessReady':False}
    def verify(self,subject,reference,session,capture):
        if not all(isinstance(v,str) and 1<=len(v)<=160 for v in (subject,reference,session)):
            raise FaceError('INVALID_INPUT')
        with self.lock:
            # One indexed lookup only. No gallery enumeration or 1:N search.
            row=self.db.execute('SELECT subject_hash, nonce, ciphertext FROM references_v1 WHERE id=?',(reference,)).fetchone()
            if not row or not secrets.compare_digest(row[0],hashlib.sha256(subject.encode()).hexdigest()):
                raise FaceError('REFERENCE_UNAVAILABLE')
            stored=json.loads(self.cipher.decrypt(row[1],row[2],reference.encode()))
            current=self.feature(capture)
            score=float(np.dot(current,np.asarray(stored['embedding'],dtype=np.float32)))
            return {'matched':score>=self.threshold,'score':round(score,5),'threshold':self.threshold,'sessionId':session,'referenceId':reference,'livenessPassed':False,'livenessStatus':'NOT_EVALUATED'}
