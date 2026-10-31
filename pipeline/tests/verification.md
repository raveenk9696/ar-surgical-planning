# Verify CT to PLY conversion

Run these commands from the repository root.

```sh
pipeline_test_dir=$(mktemp -d /tmp/pipeline-test.XXXXXX)
uv venv --python 3.12 "$pipeline_test_dir/venv"
uv pip install --python "$pipeline_test_dir/venv/bin/python" -r pipeline/requirements-dev.txt
"$pipeline_test_dir/venv/bin/python" -m pytest -q -p no:cacheprovider pipeline/tests/test_pipeline.py
```

The test creates an anonymous synthetic CT in pytest's temporary directory.
It runs the CLI and reads the ASCII PLY to check its schema, vertex count,
physical bounds, RGB values, and preservation of the input directory's permissions.

The normalized slice stack is a `(Z, H, W)` `uint8` array.
DICOM pixel spacing and slice separation supply the voxel spacing in mm.
The PLY declares `N` points with `float32` xyz and `uint8` rgb.
Coordinates use a local origin and negative Z, as in the original pipeline.
The original chunk interpolation, normalization, threshold, and grayscale colors remain.

Python 3.12 execution was checked on macOS arm64.
Binary wheel resolution was checked for Linux x86_64 with glibc 2.35 or newer.
Linux execution was not checked.

For a local scan, run `python pipeline/main.py /tmp/<temporary-series>/ 0.1`
with the same environment. The output is `DCMPLY/generated.ply` under that copy.
Validate the PLY rows, then delete the temporary series and output.
Keep scans, generated output, and patient headers out of commits and logs.
