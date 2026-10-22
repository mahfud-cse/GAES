"""Reassemble repository model parts locally; never download model bytes."""
import hashlib
import json
import os
from pathlib import Path
import tempfile


def checked_path(directory, name):
    if not isinstance(name, str) or Path(name).name != name or name in ('', '.', '..'):
        raise ValueError('INVALID_MODEL_FILENAME')
    path = directory / name
    if path.is_symlink():
        raise ValueError('MODEL_SYMLINK_NOT_ALLOWED')
    return path


def verify(path, expected):
    digest = hashlib.sha256()
    size = 0
    with path.open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(chunk)
            size += len(chunk)
    if size != expected['size'] or digest.hexdigest() != expected['sha256']:
        raise ValueError('MODEL_INTEGRITY_FAILED: ' + path.name)


def prepare_models(directory):
    directory = Path(directory)
    manifest = json.loads((directory / 'MODEL_MANIFEST.json').read_text())
    for model in manifest['files']:
        target = checked_path(directory, model['file'])
        if target.exists():
            verify(target, model)
            continue
        parts = model.get('parts', [])
        if not parts:
            raise FileNotFoundError('MODEL_MISSING: ' + target.name)
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(dir=directory, prefix='.model-', delete=False) as output:
                temporary = Path(output.name)
                for part in parts:
                    source = checked_path(directory, part['file'])
                    verify(source, part)
                    with source.open('rb') as handle:
                        for chunk in iter(lambda: handle.read(1024 * 1024), b''):
                            output.write(chunk)
                output.flush()
                os.fsync(output.fileno())
            verify(temporary, model)
            temporary.chmod(0o644)
            os.replace(temporary, target)
        finally:
            if temporary is not None and temporary.exists():
                temporary.unlink()


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--models-dir', type=Path, default=Path(__file__).parent / 'models')
    prepare_models(parser.parse_args().models_dir)
    print('Models assembled and SHA-256 verified.')
