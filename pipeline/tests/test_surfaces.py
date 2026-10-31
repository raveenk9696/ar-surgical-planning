from pathlib import Path
import subprocess
import sys

import numpy as np
import pytest
import trimesh

from test_pipeline import DEPTH, SLICE_SPACING, write_series


@pytest.mark.parametrize("crop", [None, 20])
def test_bone_and_skin_glb(tmp_path, crop):
    write_series(tmp_path, [f"{z}.dcm" for z in range(DEPTH)])
    output = tmp_path / "model.glb"
    command = [sys.executable, str(Path(__file__).resolve().parents[1] / "surfaces.py"),
               str(tmp_path), str(output), "--max-triangles", "1000"]
    if crop is not None:
        command += ["--crop-z-min", str(crop)]
    result = subprocess.run(command, text=True, capture_output=True, timeout=120)
    assert result.returncode == 0, result.stdout + result.stderr
    scene = trimesh.load(output, force="scene", process=False)
    assert set(scene.geometry) == {"bone", "skin"}
    bone, skin = scene.geometry["bone"], scene.geometry["skin"]
    for mesh in (bone, skin):
        assert 0 < len(mesh.faces) <= 1000
        assert np.isfinite(mesh.vertices).all()
    if crop is None:
        assert np.all(bone.bounds[0] >= skin.bounds[0] - 1e-4)
        assert np.all(bone.bounds[1] <= skin.bounds[1] + 1e-4)
    else:
        assert skin.bounds[0, 2] >= crop - 1e-4
        assert bone.bounds[0, 2] < crop
    assert scene.metadata["series_uid"]
    np.testing.assert_allclose(scene.metadata["spacing"], [SLICE_SPACING, 0.7, 0.8])
    assert "source_dataset" in scene.metadata
    assert scene.metadata["coordinate_system"] == "LPS"
    assert scene.metadata["units"] == "mm"
