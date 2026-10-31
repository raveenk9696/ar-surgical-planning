import subprocess
import sys
from pathlib import Path

import numpy as np
from pydicom.dataset import FileDataset, FileMetaDataset
from pydicom.uid import CTImageStorage, ExplicitVRLittleEndian, generate_uid


def test_prints_the_bounding_box_in_mm(tmp_path):
    rows, columns, slices, spacing = 40, 50, 12, (0.5, 0.8, 2.0)
    for z in range(slices):
        meta = FileMetaDataset()
        meta.TransferSyntaxUID = ExplicitVRLittleEndian
        meta.MediaStorageSOPClassUID = CTImageStorage
        meta.MediaStorageSOPInstanceUID = generate_uid()
        ds = FileDataset(str(tmp_path / f"{z:03d}.dcm"), {}, file_meta=meta, preamble=b"\0" * 128)
        ds.SOPClassUID = CTImageStorage
        ds.SOPInstanceUID = meta.MediaStorageSOPInstanceUID
        ds.Modality = "CT"
        ds.Rows, ds.Columns = rows, columns
        ds.SamplesPerPixel, ds.PhotometricInterpretation = 1, "MONOCHROME2"
        ds.BitsAllocated, ds.BitsStored, ds.HighBit, ds.PixelRepresentation = 16, 16, 15, 1
        ds.PixelSpacing = list(spacing[:2])
        ds.ImagePositionPatient = [0, 0, z * spacing[2]]
        ds.ImageOrientationPatient = [1, 0, 0, 0, 1, 0]
        ds.PixelData = np.zeros((rows, columns), dtype=np.int16).tobytes()
        ds.save_as(ds.filename, enforce_file_format=True)

    result = subprocess.run([sys.executable, str(Path(__file__).with_name("main.py")), str(tmp_path)],
                            capture_output=True, text=True, timeout=60)

    assert result.returncode == 0, result.stderr
    assert "Bounding box (mm): width 40.0, height 20.0, depth 22.0" in result.stdout
