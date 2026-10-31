"""Export HU samples as packed, binary little-endian xyz/RGB PLY records."""
from pathlib import Path

import numpy as np

from volume import Volume


POINT_DTYPE = np.dtype([
    ("x", "<f4"), ("y", "<f4"), ("z", "<f4"),
    ("red", "u1"), ("green", "u1"), ("blue", "u1"),
])


def generate_ply(volume: Volume, path: str, threshold_hu: float = -500) -> int:
    indices = np.column_stack(np.nonzero(volume.hu >= threshold_hu))
    xyz = volume.patient_points(indices)
    gray = np.clip((volume.hu[tuple(indices.T)] + 1000) * (255 / 2000), 0, 255).astype(np.uint8)
    records = np.empty(len(indices), dtype=POINT_DTYPE)
    records["x"], records["y"], records["z"] = xyz.T
    records["red"] = records["green"] = records["blue"] = gray
    destination = Path(path) / "DCMPLY" / "generated.ply"
    destination.parent.mkdir(exist_ok=True)
    header = ["ply", "format binary_little_endian 1.0", f"element vertex {len(records)}"]
    header.extend(f"property float32 {axis}" for axis in "xyz")
    header.extend(f"property uchar {channel}" for channel in ("red", "green", "blue"))
    with destination.open("wb") as stream:
        stream.write(("\n".join(header) + "\nend_header\n").encode("ascii"))
        records.tofile(stream)
    return len(records)
