"""Model packaging integrity and failure behavior, independent of inference."""
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from prepare_models import prepare_models


class ModelAssemblyTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.content = b'first-model-part\0second-model-part'
        self.parts = [self.content[:17], self.content[17:]]
        def record(name, data):
            return {'file': name, 'size': len(data), 'sha256': hashlib.sha256(data).hexdigest()}
        self.model = record('model.onnx', self.content)
        self.model['parts'] = [record(f'model.part{i}', data) for i, data in enumerate(self.parts)]
        for part, data in zip(self.model['parts'], self.parts):
            (self.root / part['file']).write_bytes(data)
        self.write_manifest()

    def write_manifest(self):
        (self.root / 'MODEL_MANIFEST.json').write_text(json.dumps({'files': [self.model]}))

    def test_reassembles_exact_bytes_and_reuses_valid_output(self):
        prepare_models(self.root)
        target = self.root / 'model.onnx'
        self.assertEqual(target.read_bytes(), self.content)
        modified = target.stat().st_mtime_ns
        prepare_models(self.root)
        self.assertEqual(target.stat().st_mtime_ns, modified)

    def test_missing_part_leaves_no_output_or_temporary_file(self):
        (self.root / 'model.part1').unlink()
        with self.assertRaises(FileNotFoundError):
            prepare_models(self.root)
        self.assertFalse((self.root / 'model.onnx').exists())
        self.assertEqual(list(self.root.glob('.model-*')), [])

    def test_corrupt_part_is_rejected(self):
        (self.root / 'model.part1').write_bytes(b'bad')
        with self.assertRaisesRegex(ValueError, 'MODEL_INTEGRITY_FAILED'):
            prepare_models(self.root)
        self.assertFalse((self.root / 'model.onnx').exists())

    def test_reordered_parts_fail_final_checksum(self):
        self.model['parts'].reverse()
        self.write_manifest()
        with self.assertRaisesRegex(ValueError, 'MODEL_INTEGRITY_FAILED'):
            prepare_models(self.root)
        self.assertEqual(list(self.root.glob('.model-*')), [])

    def test_corrupt_existing_output_is_rejected(self):
        (self.root / 'model.onnx').write_bytes(b'bad')
        with self.assertRaisesRegex(ValueError, 'MODEL_INTEGRITY_FAILED'):
            prepare_models(self.root)

    def test_path_escape_is_rejected(self):
        self.model['parts'][0]['file'] = '../outside'
        self.write_manifest()
        with self.assertRaisesRegex(ValueError, 'INVALID_MODEL_FILENAME'):
            prepare_models(self.root)

    def test_symlink_part_is_rejected(self):
        part = self.root / 'model.part0'
        part.unlink()
        part.symlink_to(self.root / 'model.part1')
        with self.assertRaisesRegex(ValueError, 'MODEL_SYMLINK_NOT_ALLOWED'):
            prepare_models(self.root)


if __name__ == '__main__':
    unittest.main()
