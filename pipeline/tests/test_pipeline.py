import os
from pathlib import Path
import subprocess
import sys

import numpy as np
from pydicom.dataset import FileDataset, FileMetaDataset
from pydicom.uid import CTImageStorage, ExplicitVRLittleEndian, generate_uid


def test_ct_series_to_colored_ply(tmp_path):
    depth, height, width = 24, 64, 64
    row_spacing, column_spacing, slice_spacing = 0.7, 0.8, 2.5
    series_uid = generate_uid()
    study_uid = generate_uid()
    y, x = np.ogrid[:height, :width]
    pixels = np.full((height, width), -1000, dtype=np.int16)
    pixels[8:-8, 8:-8] = 0
    pixels[(x - width // 2) ** 2 + (y - height // 2) ** 2 <= 8 ** 2] = 1000

    for z in range(depth):
        filename = tmp_path / f"slice-{z:03d}.dcm"
        meta = FileMetaDataset()
        meta.TransferSyntaxUID = ExplicitVRLittleEndian
        meta.MediaStorageSOPClassUID = CTImageStorage
        meta.MediaStorageSOPInstanceUID = generate_uid()
        ds = FileDataset(str(filename), {}, file_meta=meta, preamble=b"\0" * 128)
        ds.is_little_endian = True
        ds.is_implicit_VR = False
        ds.SOPClassUID = meta.MediaStorageSOPClassUID
        ds.SOPInstanceUID = meta.MediaStorageSOPInstanceUID
        ds.StudyInstanceUID = study_uid
        ds.SeriesInstanceUID = series_uid
        ds.Modality = "CT"
        ds.PatientName = ""
        ds.PatientID = ""
        ds.Rows = height
        ds.Columns = width
        ds.SamplesPerPixel = 1
        ds.PhotometricInterpretation = "MONOCHROME2"
        ds.BitsAllocated = 16
        ds.BitsStored = 16
        ds.HighBit = 15
        ds.PixelRepresentation = 1
        ds.ImagePositionPatient = [0, 0, z * slice_spacing]
        ds.ImageOrientationPatient = [1, 0, 0, 0, 1, 0]
        ds.PixelSpacing = [row_spacing, column_spacing]
        ds.SliceThickness = slice_spacing
        ds.SliceLocation = z * slice_spacing
        ds.RescaleSlope = 1
        ds.RescaleIntercept = 0
        ds.PixelData = pixels.tobytes()
        ds.save_as(str(filename), write_like_original=False)

    tmp_path.chmod(0o750)
    result = subprocess.run(
        [sys.executable, str(Path(__file__).resolve().parents[1] / "main.py"),
         str(tmp_path), "0.1"],
        capture_output=True, text=True, timeout=120,
        env={**os.environ, "MPLBACKEND": "Agg"},
    )
    assert result.returncode == 0, result.stdout + result.stderr

    ply = tmp_path / "DCMPLY" / "generated.ply"
    with ply.open() as stream:
        header = []
        for line in stream:
            header.append(line.strip())
            if line.strip() == "end_header":
                break
        vertex_count = int(next(line.split()[2] for line in header
                                if line.startswith("element vertex ")))
        points = np.loadtxt(stream, ndmin=2)

    assert "format ascii 1.0" in header
    for axis in "xyz":
        assert f"property float32 {axis}" in header
    for channel in ("red", "green", "blue"):
        assert f"property uchar {channel}" in header
    assert vertex_count > 0
    assert points.shape == (vertex_count, 6)
    assert np.isfinite(points).all()
    assert (points[:, :2] >= 0).all()
    assert (points[:, 0] <= width * column_spacing).all()
    assert (points[:, 1] <= height * row_spacing).all()
    assert (points[:, 2] <= 0).all()
    assert (points[:, 2] >= -(depth - 1) * slice_spacing).all()
    assert ((points[:, 3:] >= 0) & (points[:, 3:] <= 255)).all()
    assert (points[:, 3:] == points[:, 3:].astype(np.uint8)).all()
    assert tmp_path.stat().st_mode & 0o777 == 0o750
