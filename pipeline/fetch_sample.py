"""Download a public TCIA CT series and verify every DICOM against samples.json."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import tempfile
from urllib.parse import urlencode
from urllib.request import urlopen
import zipfile


MANIFEST = Path(__file__).with_name("samples.json")
API = "https://services.cancerimagingarchive.net/nbia-api/services/v1/getImage"


def verify_manifest(directory, sample):
    files = {p.name: p for p in Path(directory).glob("*.dcm")}
    if len(files) != sample["file_count"] or files.keys() != sample["files"].keys():
        raise ValueError("DICOM file set does not match the manifest")
    for name, file in files.items():
        with file.open("rb") as stream:
            digest = hashlib.file_digest(stream, "sha256").hexdigest()
        if digest != sample["files"][name]:
            raise ValueError(f"SHA256 mismatch for {name}")
    return len(files)


def fetch_sample(name="abdomen", data_dir="data"):
    sample = json.loads(MANIFEST.read_text())[name]
    destination = Path(data_dir) / name
    if destination.exists():
        verify_manifest(destination, sample)
        return destination
    destination.parent.mkdir(parents=True, exist_ok=True)
    url = API + "?" + urlencode({"SeriesInstanceUID": sample["series_uid"]})
    with tempfile.TemporaryDirectory(prefix="tcia-", dir=destination.parent) as temporary:
        temporary = Path(temporary)
        archive = temporary / "series.zip"
        with urlopen(url, timeout=120) as response, archive.open("wb") as stream:
            shutil.copyfileobj(response, stream)
        extracted = temporary / "series"
        extracted.mkdir()
        with zipfile.ZipFile(archive) as zipped:
            for entry in zipped.infolist():
                if entry.is_dir() or not entry.filename.lower().endswith(".dcm"):
                    continue
                name = Path(entry.filename).name
                if name not in sample["files"]:
                    raise ValueError(f"Unexpected DICOM in archive: {name}")
                with zipped.open(entry) as source, (extracted / name).open("xb") as target:
                    shutil.copyfileobj(source, target)
        verify_manifest(extracted, sample)
        extracted.rename(destination)
    return destination


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("name", nargs="?", default="abdomen", choices=("abdomen", "legs"))
    parser.add_argument("--data-dir", default="data", help="Parent directory for data/<name> (default data)")
    args = parser.parse_args()
    result = fetch_sample(args.name, args.data_dir)
    print(f"Verified {args.name} at {result}")
