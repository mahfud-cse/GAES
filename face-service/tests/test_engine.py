"""Real-model smoke/security tests. Input fixture is supplied locally, never shipped as staff data."""
import base64,json,os,tempfile,unittest
from pathlib import Path
import cv2,numpy as np
from engine import Engine,FaceError

class EngineTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.engine=Engine(Path(__file__).parents[1]/'models',self.temp.name+'/refs.sqlite3',b'k'*32)
        self.raw=Path(os.environ['GAES_FACE_TEST_IMAGE']).read_bytes()
        self.photo='data:image/jpeg;base64,'+base64.b64encode(self.raw).decode()
    def tearDown(self):
        self.engine.db.close();self.temp.cleanup()
    def encode(self,image):
        return 'data:image/jpeg;base64,'+base64.b64encode(cv2.imencode('.jpg',image)[1]).decode()
    def test_real_detection_and_single_reference_comparison(self):
        self.assertEqual(self.engine.detect(self.photo)['faceCount'],1)
        enrolled=self.engine.enroll('staff-test',[self.photo]);self.assertTrue(enrolled['verified'])
        match=self.engine.verify('staff-test',enrolled['referenceId'],'session-1',self.photo)
        self.assertTrue(match['matched']);self.assertGreater(match['score'],0.99)
        self.assertFalse(match['livenessPassed'])
    def test_transformed_reference_still_matches(self):
        enrolled=self.engine.enroll('staff-test',[self.photo])
        img=cv2.imdecode(np.frombuffer(self.raw,np.uint8),cv2.IMREAD_COLOR)
        adjusted=cv2.convertScaleAbs(img,alpha=0.92,beta=8)
        self.assertTrue(self.engine.verify('staff-test',enrolled['referenceId'],'session-2',self.encode(adjusted))['matched'])
    def test_no_face_rejected(self):
        blank=self.encode(np.zeros((512,512,3),np.uint8))
        self.assertEqual(self.engine.detect(blank)['faceCount'],0)
        with self.assertRaises(FaceError):self.engine.enroll('staff-test',[blank])
    def test_multiple_faces_rejected(self):
        img=cv2.imdecode(np.frombuffer(self.raw,np.uint8),cv2.IMREAD_COLOR)
        with self.assertRaises(FaceError):self.engine.enroll('staff-test',[self.encode(np.concatenate([img,img],axis=1))])
    def test_reference_cannot_be_used_for_another_subject(self):
        enrolled=self.engine.enroll('staff-a',[self.photo])
        with self.assertRaises(FaceError):self.engine.verify('staff-b',enrolled['referenceId'],'session-1',self.photo)
    def test_embedding_is_encrypted_and_tamper_detected(self):
        enrolled=self.engine.enroll('staff-a',[self.photo])
        row=self.engine.db.execute('SELECT ciphertext FROM references_v1 WHERE id=?',(enrolled['referenceId'],)).fetchone()
        self.assertNotIn(b'embedding',row[0]);self.assertNotIn(b'staff-a',row[0])
        self.engine.db.execute('UPDATE references_v1 SET ciphertext=? WHERE id=?',(b'corrupted',enrolled['referenceId']));self.engine.db.commit()
        with self.assertRaises(Exception):self.engine.verify('staff-a',enrolled['referenceId'],'session-1',self.photo)
    def test_untrusted_inputs_rejected(self):
        for photo in ['',None,'data:image/svg+xml;base64,PHN2Zz4=','data:image/jpeg;base64,garbage']:
            with self.assertRaises(FaceError):self.engine.enroll('staff-a',[photo])
    def test_threshold_and_key_validation(self):
        with self.assertRaises(ValueError):Engine(Path(__file__).parents[1]/'models',':memory:',b'bad')
        with self.assertRaises(ValueError):Engine(Path(__file__).parents[1]/'models',':memory:',b'k'*32,threshold=2)

if __name__=='__main__':unittest.main(verbosity=2)
