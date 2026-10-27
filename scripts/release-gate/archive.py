"""Bounded archive extraction; never execute downloaded artifact contents."""
from pathlib import Path, PurePosixPath
import json, os, stat, sys, tarfile, zipfile

def extract(kind, source, destination):
    dest = Path(destination)
    if dest.exists():
        raise ValueError('Destination must be new')
    dest.mkdir(parents=True)
    seen, total = set(), 0
    def target(name, size):
        nonlocal total
        rel = PurePosixPath(name)
        if rel.is_absolute() or '..' in rel.parts or '\\' in name or '\x00' in name:
            raise ValueError('Unsafe archive path')
        normalized = str(rel)
        if normalized in seen:
            raise ValueError('Duplicate archive member')
        seen.add(normalized)
        total += size
        if len(seen) > 40000 or size > 512 * 1024**2 or total > 1024**3:
            raise ValueError('Archive bounds exceeded')
        return dest.joinpath(*rel.parts)
    if kind == 'zip':
        with zipfile.ZipFile(source) as archive:
            for item in archive.infolist():
                mode = item.external_attr >> 16
                if stat.S_ISLNK(mode) or (stat.S_IFMT(mode) not in (0, stat.S_IFREG, stat.S_IFDIR)):
                    raise ValueError('Unsupported zip member')
                file = target(item.filename, item.file_size)
                if item.is_dir():
                    file.mkdir(parents=True, exist_ok=True)
                else:
                    file.parent.mkdir(parents=True, exist_ok=True)
                    with file.open('xb') as output:
                        output.write(archive.read(item))
    elif kind == 'tar':
        with tarfile.open(source, 'r:gz') as archive:
            for item in archive:
                if not (item.isfile() or item.isdir()) or item.mode & 0o7000:
                    raise ValueError('Unsupported tar member or mode')
                file = target(item.name, item.size)
                if item.isdir():
                    file.mkdir(parents=True, exist_ok=True)
                else:
                    file.parent.mkdir(parents=True, exist_ok=True)
                    with archive.extractfile(item) as stream, file.open('xb') as output:
                        while chunk := stream.read(1024 * 1024):
                            output.write(chunk)
                    os.chmod(file, item.mode & 0o777)
    else:
        raise ValueError('Unknown archive type')
    return {'members': len(seen), 'bytes': total}

if __name__ == '__main__':
    print(json.dumps(extract(*sys.argv[1:])))
