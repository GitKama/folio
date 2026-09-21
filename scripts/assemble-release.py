"""Assemble public releases from a clean, tagged source tree and verified binaries."""
from pathlib import Path
import hashlib
import json
import shutil
import subprocess
import urllib.request
import zipfile

root = Path(__file__).resolve().parents[1]
package = json.loads((root / "package.json").read_text(encoding="utf-8"))
version = package["version"]
tag = "v" + version
destination = root / "release-assets" / tag
destination.mkdir(parents=True, exist_ok=True)

def git(*args):
    return subprocess.check_output(["git", *args], cwd=root, text=True).strip()

if git("status", "--porcelain"):
    raise RuntimeError("Commit the exact release source before assembling.")
if git("rev-parse", tag + "^{commit}") != git("rev-parse", "HEAD"):
    raise RuntimeError("The version tag must point to HEAD.")
reports = ["packaged/desktop-report.json", "portable/portable-report.json"]
if "test:editor" in package["scripts"]:
    reports.append("editor-packaged/editor-report.json")
for report in reports:
    data = json.loads((root / "test-results" / report).read_text(encoding="utf-8"))
    if not data["passed"]:
        raise RuntimeError("Failed verification: " + report)

for name in [f"Folio-{version}-win-x64.exe", f"Folio-{version}-Setup-x64.exe"]:
    source = root / "release" / name
    if source.stat().st_size < 10_000_000:
        raise RuntimeError("Missing or truncated build: " + name)
    shutil.copy2(source, destination / name)

source_zip = destination / f"Folio-{version}-source.zip"
subprocess.run(["git", "archive", "--format=zip", "--prefix=Folio/", "--output", str(source_zip), tag], cwd=root, check=True)

cache = root / "test-results" / "upstream"
cache.mkdir(parents=True, exist_ok=True)
sources = json.loads((root / "licenses/upstream-sources.json").read_text(encoding="utf-8"))
with zipfile.ZipFile(destination / "Folio-third-party-sources.zip", "w", compression=zipfile.ZIP_DEFLATED) as archive:
    for item in sources:
        file = cache / item["name"]
        if not file.exists():
            request = urllib.request.Request(item["source"], headers={"User-Agent": "Folio-release"})
            with urllib.request.urlopen(request, timeout=120) as response:
                file.write_bytes(response.read())
        if hashlib.sha256(file.read_bytes()).hexdigest() != item["sha256"]:
            raise RuntimeError("Upstream source checksum mismatch: " + item["name"])
        archive.write(file, "sources/" + file.name)
    archive.write(root / "licenses/upstream-sources.json", "sources.json")
    archive.write(root / "docs/licensing.md", "README.md")
    for file in sorted((root / "licenses").glob("*.txt")):
        archive.write(file, "licenses/" + file.name)

shutil.copy2(root / "LICENSE", destination / "LICENSE.txt")
shutil.copy2(root / "THIRD_PARTY_NOTICES.txt", destination / "THIRD_PARTY_NOTICES.txt")
shutil.copy2(root / "docs/releases" / (tag + ".md"), destination / "VERIFICATION.md")
for archive in destination.glob("*.zip"):
    with zipfile.ZipFile(archive) as z:
        if z.testzip() is not None:
            raise RuntimeError("Invalid archive: " + archive.name)
manifest = []
for file in sorted(destination.iterdir()):
    if file.is_file() and file.name not in ("SHA256SUMS.txt", "release-manifest.json"):
        digest = hashlib.sha256(file.read_bytes()).hexdigest()
        manifest.append({"name": file.name, "bytes": file.stat().st_size, "sha256": digest})
(destination / "SHA256SUMS.txt").write_text("".join(f"{item['sha256']}  {item['name']}\n" for item in manifest), encoding="utf-8")
(destination / "release-manifest.json").write_text(json.dumps({"version": version, "tag": tag, "commit": git("rev-parse", "HEAD"), "assets": manifest}, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"version": version, "assets": len(manifest) + 2, "directory": str(destination)}, indent=2))
