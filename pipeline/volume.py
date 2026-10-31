"""CT samples and their voxel-index (z, row, column) to LPS-mm affine."""
from dataclasses import dataclass

import numpy as np


@dataclass
class Volume:
    hu: np.ndarray
    affine: np.ndarray
    series_uid: str
    source_dataset: str = "unspecified"

    @property
    def spacing(self):
        return np.linalg.norm(self.affine[:3, :3], axis=0)

    def patient_points(self, indices):
        return (indices @ self.affine[:3, :3].T + self.affine[:3, 3]).astype(np.float32)


def from_datasets(datasets, interp_factor=0):
    if not datasets:
        raise ValueError("No DICOM slices found")
    if not np.isfinite(interp_factor) or interp_factor < 0:
        raise ValueError("interp_factor must be finite and nonnegative")
    first = datasets[0]
    axes = np.asarray(first.ImageOrientationPatient, float).reshape(2, 3)
    normal = np.cross(*axes)
    if not np.allclose(axes @ axes.T, np.eye(2), atol=1e-5):
        raise ValueError("DICOM orientation must contain orthonormal axes")
    positions = np.array([ds.ImagePositionPatient for ds in datasets], float)
    order = np.argsort(positions @ normal)
    positions = positions[order]
    datasets = [datasets[i] for i in order]
    distances = positions @ normal
    if not np.isfinite(positions).all() or np.any(np.diff(distances) <= 0):
        raise ValueError("Slice positions must be finite and distinct")
    pixels = np.asarray(first.PixelSpacing, float)
    if not np.isfinite(pixels).all() or np.any(pixels <= 0):
        raise ValueError("Pixel spacing must be finite and positive")
    hu = np.empty((len(datasets), int(first.Rows), int(first.Columns)), np.float32)
    uid = str(first.SeriesInstanceUID)
    for i, ds in enumerate(datasets):
        if (str(ds.SeriesInstanceUID) != uid or ds.Modality != "CT"
                or not np.allclose(ds.ImageOrientationPatient, axes.ravel(), atol=1e-5)
                or not np.allclose(ds.PixelSpacing, pixels)):
            raise ValueError("Expected one CT series with consistent orientation and spacing")
        raw = ds.pixel_array
        hu[i] = raw.astype(np.float32) * float(getattr(ds, "RescaleSlope", 1)) + float(getattr(ds, "RescaleIntercept", 0))
        if hasattr(ds, "PixelPaddingValue"):
            lower, upper = sorted([float(ds.PixelPaddingValue), float(getattr(ds, "PixelPaddingRangeLimit", ds.PixelPaddingValue))])
            hu[i][(raw >= lower) & (raw <= upper)] = -3024
    affine = np.eye(4)
    affine[:3, 1] = axes[1] * pixels[0]
    affine[:3, 2] = axes[0] * pixels[1]
    affine[:3, 3] = positions[0]
    if len(datasets) == 1:
        affine[:3, 0] = normal * float(first.SliceThickness)
    else:
        span = distances[-1] - distances[0]
        fractions = (distances - distances[0]) / span
        expected = positions[0] + fractions[:, None] * (positions[-1] - positions[0])
        if not np.allclose(positions, expected, atol=1e-3):
            raise ValueError("Slice origins do not form a straight stack")
        count = len(datasets) + int(np.ceil(span * interp_factor))
        target = np.linspace(distances[0], distances[-1], count)
        if count != len(datasets) or not np.allclose(distances, target, atol=1e-5):
            result = np.empty((count, *hu.shape[1:]), np.float32)
            for i, distance in enumerate(target):
                right = min(max(int(np.searchsorted(distances, distance)), 1), len(datasets) - 1)
                weight = (distance - distances[right - 1]) / (distances[right] - distances[right - 1])
                result[i] = hu[right - 1] * (1 - weight) + hu[right] * weight
            hu = result
        affine[:3, 0] = (positions[-1] - positions[0]) / (count - 1)
    if not np.isfinite(hu).all():
        raise ValueError("CT HU values must be finite")
    return Volume(hu, affine, uid)
