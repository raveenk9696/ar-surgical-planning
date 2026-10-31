import os
from pathlib import Path
import subprocess
import sys

import numpy as np
import pytest
import pydicom
from pydicom.dataset import FileDataset, FileMetaDataset
from pydicom.uid import CTImageStorage, ExplicitVRLittleEndian, generate_uid


DEPTH, HEIGHT, WIDTH = 24, 64, 64
ROW_SPACING, COLUMN_SPACING, SLICE_SPACING = 0.7, 0.8, 2.5


def write_series(directory, names, slice_location=True, padded=False):
    depth, height, width = DEPTH, HEIGHT, WIDTH
    row_spacing, column_spacing, slice_spacing = ROW_SPACING, COLUMN_SPACING, SLICE_SPACING
    series_uid = generate_uid()
    study_uid = generate_uid()
    y, x = np.ogrid[:height, :width]
    distance = np.hypot(x - width // 2, y - height // 2)

    for z in range(depth):
        pixels = np.full((height, width), -1000, dtype=np.int16)
        pixels[8:-8, 8:-8] = 0
        pixels[distance <= 4 + 4 * z // depth] = 1000
        if padded:
            pixels[distance > 34.5] = -3024
        filename = directory / names[z]
        meta = FileMetaDataset()
        meta.TransferSyntaxUID = ExplicitVRLittleEndian
        meta.MediaStorageSOPClassUID = CTImageStorage
        meta.MediaStorageSOPInstanceUID = generate_uid()
        ds = FileDataset(str(filename), {}, file_meta=meta, preamble=b"\0" * 128)
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
        if slice_location:
            ds.SliceLocation = z * slice_spacing
        ds.RescaleSlope = 1
        ds.RescaleIntercept = 0
        ds.PixelData = pixels.tobytes()
        ds.save_as(str(filename), enforce_file_format=True)


def run_pipeline(directory, factor="0.1", *options):
    result = subprocess.run(
        [sys.executable, str(Path(__file__).resolve().parents[1] / "main.py"),
         str(directory), str(factor), *map(str, options)],
        capture_output=True, text=True, timeout=120,
        env={**os.environ, "MPLBACKEND": "Agg"},
    )
    assert result.returncode == 0, result.stdout + result.stderr
    raw = (directory / "DCMPLY" / "generated.ply").read_bytes()
    header, body = raw.split(b"end_header\n", 1)
    header = header.decode("ascii").splitlines()
    count = int(next(line.split()[2] for line in header if line.startswith("element vertex ")))
    dtype = np.dtype([(n, "<f4") for n in "xyz"] + [(n, "u1") for n in ("red", "green", "blue")])
    assert "format binary_little_endian 1.0" in header
    assert len(body) == count * dtype.itemsize
    records = np.frombuffer(body, dtype=dtype)
    return header, np.column_stack([records[n] for n in dtype.names])


@pytest.mark.parametrize("slice_location, padded", [(True, False), (False, False), (True, True)],
                         ids=["with-slice-location", "without-slice-location", "padded-outside-scan-circle"])
def test_ct_series_to_colored_ply(tmp_path, slice_location, padded):
    depth, height, width = DEPTH, HEIGHT, WIDTH
    row_spacing, column_spacing, slice_spacing = ROW_SPACING, COLUMN_SPACING, SLICE_SPACING
    write_series(tmp_path, [f"slice-{z:03d}.dcm" for z in range(depth)], slice_location, padded)
    tmp_path.chmod(0o750)
    header, points = run_pipeline(tmp_path)
    vertex_count = len(points)

    assert header[0] == "ply"
    assert "format binary_little_endian 1.0" in header
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
    assert (points[:, 2] >= 0).all()
    assert (points[:, 2] <= (depth - 1) * slice_spacing).all()
    assert ((points[:, 3:] >= 0) & (points[:, 3:] <= 255)).all()
    assert (points[:, 3:] == points[:, 3:].astype(np.uint8)).all()
    assert tmp_path.stat().st_mode & 0o777 == 0o750

    columns = points[:, 0] / column_spacing
    rows = points[:, 1] / row_spacing
    assert ((columns >= 7.5) & (columns <= width - 8.5)
            & (rows >= 7.5) & (rows <= height - 8.5)).all(), "air voxels were kept"
    radius = np.hypot(columns - width // 2, rows - height // 2)
    bone, skin = points[radius <= 3, 3], points[radius >= 10, 3]
    assert bone.size > 0, "bone is missing from the model"
    assert skin.size > 0, "skin is missing from the model"
    assert bone.min() > skin.max(), "bone is not brighter than skin"


def test_file_names_do_not_change_the_model(tmp_path):
    in_order, shuffled = tmp_path / "in-order", tmp_path / "shuffled"
    in_order.mkdir()
    shuffled.mkdir()
    write_series(in_order, [f"slice-{z:03d}.dcm" for z in range(DEPTH)])
    names = [f"slice-{z:03d}.dcm" for z in np.random.default_rng(0).permutation(DEPTH)]
    write_series(shuffled, names)
    np.testing.assert_array_equal(run_pipeline(shuffled)[1], run_pipeline(in_order)[1])


def test_z_ramp_is_uniform_across_old_chunk_boundaries(tmp_path):
    write_series(tmp_path, [f"{z}.dcm" for z in range(DEPTH)])
    for file in tmp_path.glob("*.dcm"):
        ds = pydicom.dcmread(file)
        z = float(ds.ImagePositionPatient[2])
        ds.PixelData = np.full((HEIGHT, WIDTH), round(z * 16), np.int16).tobytes()
        ds.save_as(file, enforce_file_format=True)
    points = run_pipeline(tmp_path, 1)[1]
    zs = np.unique(points[:, 2])
    assert len(zs) > DEPTH
    np.testing.assert_allclose(np.diff(zs), zs[-1] / (len(zs) - 1), atol=1e-5)
    gray = np.array([points[points[:, 2] == z, 3].mean() for z in zs])
    expected = np.floor((zs * 16 + 1000) * 255 / 2000)
    np.testing.assert_allclose(gray, expected, atol=1)
    assert np.all(np.diff(gray) > 0)
    assert np.ptp(np.diff(gray)) <= 1


def test_left_marker_has_larger_patient_x_with_oblique_orientation(tmp_path):
    write_series(tmp_path, [f"{z}.dcm" for z in range(DEPTH)])
    for z in range(DEPTH):
        file = tmp_path / f"{z}.dcm"
        ds = pydicom.dcmread(file)
        pixels = np.full((HEIGHT, WIDTH), -1000, np.int16)
        pixels[8:-8, 8:-8] = 0
        pixels[20:23, 30:33] = 500
        pixels[40:43, 30:33] = 900
        ds.PixelData = pixels.tobytes()
        ds.ImageOrientationPatient = [0, 1, 0, -1, 0, 0]
        ds.ImagePositionPatient = [100, 200, 300 + z * SLICE_SPACING]
        ds.save_as(file, enforce_file_format=True)
    points = run_pipeline(tmp_path)[1]
    left = points[points[:, 3] == 191]
    right = points[points[:, 3] == 242]
    assert left.size and right.size
    assert left[:, 0].min() > right[:, 0].max()
    np.testing.assert_allclose(left[:, 0].max(), 86, atol=1e-4)
    assert points[:, 2].min() == 300


def test_table_is_removed_and_body_is_kept(tmp_path):
    write_series(tmp_path, [f"{z}.dcm" for z in range(DEPTH)])
    for file in tmp_path.glob("*.dcm"):
        ds = pydicom.dcmread(file)
        pixels = ds.pixel_array.copy()
        pixels[59:61, :] = 100
        ds.PixelData = pixels.tobytes()
        ds.save_as(file, enforce_file_format=True)
    points = run_pipeline(tmp_path)[1]
    assert np.all(points[:, 1] < 58 * ROW_SPACING)
    assert np.any(points[:, 3] == 255)
    assert np.any(points[:, 3] == 127)


def test_point_budget_is_deterministic(tmp_path):
    write_series(tmp_path, [f"{z}.dcm" for z in range(DEPTH)])
    first = run_pipeline(tmp_path, 0.1, "--max-points", 1200)[1]
    assert 0 < len(first) <= 1200
    np.testing.assert_array_equal(first, run_pipeline(tmp_path, 0.1, "--max-points", 1200)[1])
    assert np.any(first[:, 3] == 255)
