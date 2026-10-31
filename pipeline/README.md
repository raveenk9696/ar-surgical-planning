# Pipeline

Run these commands from the repository root.

```sh
uv venv --python 3.12 /tmp/ar-pipeline-test
uv pip install --python /tmp/ar-pipeline-test/bin/python -r pipeline/requirements-dev.txt
PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 /tmp/ar-pipeline-test/bin/python -m pytest -q pipeline/tests
```

The tests create synthetic CT data and inspect binary PLY records and reloaded GLB meshes.
They check HU colors, air and table removal, point limits, DICOM LPS geometry,
whole-stack interpolation, triangle limits, skin cropping, and manifest integrity.

Use the environment above for these commands.

```sh
python pipeline/fetch_sample.py abdomen --data-dir /tmp/ar-samples
python pipeline/main.py /tmp/ar-samples/abdomen 0.1 --threshold-hu -500 --max-points 2000000
python pipeline/surfaces.py /tmp/ar-samples/abdomen /tmp/abdomen.glb --crop-z-min -350
```

The point cloud is `/tmp/ar-samples/abdomen/DCMPLY/generated.ply`.
`fetch_sample.py legs` selects the second public sample.
For this legs series, a skin crop at LPS z 900 mm removes the groin and leaves a short upper skin section.
Bone is not cropped. Review crops for each new series.

The volume is `(Z, H, W)` float32 HU with a voxel-index to DICOM LPS-mm affine.
The affine maps `(slice, row, column)` to `(left, posterior, superior)` patient coordinates.
Slice origins, orientation, pixel spacing, and sorted slice positions determine it.
Interpolation adds `ceil(stack_depth_mm * interp_factor)` slices across the complete stack,
including all old chunk boundaries, and preserves the physical extent.
Points have float32 xyz and uint8 RGB. Binary PLY records have 15 bytes per vertex.
GLBs contain named `bone` and `skin` meshes in LPS mm and provenance in scene extras.

Keep scans, models, renders, and patient headers outside Git.
See `pipeline/validation.md` for the public-scan results.
