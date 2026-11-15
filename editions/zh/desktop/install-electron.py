"""Download the pinned Electron runtime from its official release and verify SHA-256."""
from pathlib import Path
import hashlib
import json
import os
import tempfile
import urllib.request
import zipfile

root = Path(__file__).resolve().parents[1]
package = root / "node_modules" / "electron"
version = json.loads((package / "package.json").read_text(encoding="utf-8"))["version"]
name = f"electron-v{version}-win32-x64.zip"
expected = json.loads((package / "checksums.json").read_text(encoding="utf-8"))[name]
cache = root / "build" / "downloads"
cache.mkdir(parents=True, exist_ok=True)
archive = cache / name
if not archive.exists() or hashlib.sha256(archive.read_bytes()).hexdigest() != expected:
    partial = archive.with_suffix(".download")
    urllib.request.urlretrieve(f"https://github.com/electron/electron/releases/download/v{version}/{name}", partial)
    if hashlib.sha256(partial.read_bytes()).hexdigest() != expected:
        raise RuntimeError("Official Electron download did not match its pinned checksum.")
    os.replace(partial, archive)
destination = package / "dist"
with zipfile.ZipFile(archive) as bundle:
    for entry in bundle.infolist():
        target = (destination / entry.filename).resolve()
        if not target.is_relative_to(destination.resolve()):
            raise RuntimeError("Unsafe archive entry")
    bundle.extractall(destination)
(package / "path.txt").write_text("electron.exe", encoding="ascii")
print(f"Electron {version}: verified official Windows x64 runtime")

