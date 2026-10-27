"""Check the distributable without installing models or native Python dependencies."""
import json
from pathlib import Path
import re
import zipfile

root = Path(__file__).resolve().parents[1]
manifest = json.loads((root / "package.json").read_text(encoding="utf-8"))
asset = root / "dist" / f"{manifest['name']}-{manifest['version']}.vsix"
required = {
    "extension/package.json",
    "extension/package.nls.json",
    "extension/package.nls.es.json",
    "extension/readme.md",
    "extension/changelog.md",
    "extension/LICENSE.txt",
    "extension/dist/extension.js",
    "extension/dist/webview.js",
    "extension/dist/webview.css",
    "extension/media/dev-transcription.svg",
    "extension/python/transcribe.py",
    "extension/python/speakers.py",
    "extension/python/languages.py",
    "extension/python/requirements.txt",
    "extension.vsixmanifest",
    "[Content_Types].xml",
}

with zipfile.ZipFile(asset) as bundle:
    files = {entry.filename for entry in bundle.infolist() if not entry.is_dir()}
    missing = required - files
    unexpected = files - required
    if missing or unexpected:
        raise SystemExit(f"Invalid VSIX contents. Missing: {sorted(missing)}; unexpected: {sorted(unexpected)}")
    for name in required:
        if not bundle.getinfo(name).file_size:
            raise SystemExit(f"Empty VSIX entry: {name}")
    packaged = json.loads(bundle.read("extension/package.json"))
    for field in ("name", "version", "publisher", "repository", "main"):
        if packaged.get(field) != manifest[field]:
            raise SystemExit(f"Packaged {field} does not match package.json")
    catalogs = []
    for name in ("package.nls.json", "package.nls.es.json"):
        if bundle.read(f"extension/{name}") != (root / name).read_bytes():
            raise SystemExit(f"Packaged translation catalog is out of date: {name}")
        catalogs.append(json.loads(bundle.read(f"extension/{name}")))
    references = set(re.findall(r"%([\w.]+)%", json.dumps(packaged)))
    if set(catalogs[0]) != set(catalogs[1]) or any(not catalog.get(key) for catalog in catalogs for key in references):
        raise SystemExit("Manifest translation catalogs must cover the same keys and every manifest reference")
    for name in ("transcribe.py", "speakers.py", "languages.py", "requirements.txt"):
        if bundle.read(f"extension/python/{name}") != (root / "python" / name).read_bytes():
            raise SystemExit(f"Packaged Python worker is out of date: {name}")

print(f"Verified {asset.name}: metadata, bundled UI and Python worker; no development or local data files.")
