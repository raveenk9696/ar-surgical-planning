# Verify CT to PLY conversion

From the repository root, install `pipeline/requirements-dev.txt` in a Python 3.12 environment.
Run `python -m pytest -q pipeline/tests`.
The tests create synthetic CT data and inspect packed binary PLY records.
Run `python pipeline/main.py <dicom-dir> 0.1 --threshold-hu -500` to export a scan.
The output is `<dicom-dir>/DCMPLY/generated.ply`.
Keep scan data and generated models outside Git.
