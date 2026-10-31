import hashlib
import importlib
from pathlib import Path

import pytest


def test_manifest_accepts_complete_scan_and_rejects_changes(tmp_path, monkeypatch):
    monkeypatch.syspath_prepend(str(Path(__file__).resolve().parents[1]))
    verify = importlib.import_module("fetch_sample").verify_manifest
    content = b"synthetic sample bytes"
    sample = {"file_count": 1, "files": {"one.dcm": hashlib.sha256(content).hexdigest()}}
    file = tmp_path / "one.dcm"
    file.write_bytes(content)
    assert verify(tmp_path, sample) == 1
    file.write_bytes(content + b"changed")
    with pytest.raises(ValueError, match="SHA256"):
        verify(tmp_path, sample)
    file.unlink()
    with pytest.raises(ValueError, match="file set"):
        verify(tmp_path, sample)
    file.write_bytes(content)
    (tmp_path / "unexpected.dcm").write_bytes(content)
    with pytest.raises(ValueError, match="file set"):
        verify(tmp_path, sample)
