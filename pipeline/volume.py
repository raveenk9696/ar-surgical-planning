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
