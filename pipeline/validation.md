# Public scan validation

The table records one run on one macOS arm64 machine with Python 3.12.11 on 2026-10-31.
Times depend on the machine and its load.
Each timing is elapsed wall-clock time around one complete CLI subprocess.
The measurement includes interpreter startup and file writing.
The CLI prints a separate in-process time that starts after imports.
These are completion measurements, not a speed comparison.

| Scan | Points | PLY bytes | Bone triangles | Skin triangles | GLB bytes | Point seconds | Surface seconds | Skin z minimum, LPS mm |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| abdomen | 2000000 | 30000187 | 300000 | 299999 | 11982896 | 6.08 | 11.09 | -350 |
| legs | 2000000 | 30000187 | 299999 | 214004 | 10333980 | 7.80 | 11.74 | 900 |

Both runs used an interpolation factor of 0.1 and the default point and triangle limits.
The legs skin crop at LPS z 900 mm still leaves groin tissue.
Share only the legs bone mesh, not its skin, combined GLB, or uncropped point cloud.
Bone is not cropped. The legs scan starts mid-thigh, so it does not contain complete femurs.
The crop leaves an open boundary at its plane.

Only `abdomen.glb` feeds the web app. Legs is a pipeline test sample.
GLB coordinates deliberately retain LPS mm. A viewer must apply any display rotation or unit conversion.

`fetch_sample.py` checks each source file against its SHA-256 in the manifest.
`pipeline/samples.json` records the 189 abdomen and 267 legs file hashes, licenses, and dataset citations.
Abdomen attribution is Saltz et al. (2021), doi:10.7937/TCIA.BBAG-2923, CC BY 4.0.
Legs attribution is Vallières et al. (2015), doi:10.7937/K9/TCIA.2015.7GO2GSKS, CC BY 3.0.

One run on one machine completed the 12 synthetic tests in 13.23 seconds with external pytest plugins disabled.
That test time depends on the machine and its load.
Rerun the tests with `PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 .venv/bin/python -m pytest -q pipeline/tests`.

## Output hashes

The commands below produce these SHA-256 values.
The abdomen and legs outputs matched them when regenerated on Python 3.12.11.

| Output | SHA-256 |
| --- | --- |
| abdomen PLY | `db05464a170d2dd1237fed86545903f542ceff8dc31112a6e6abad79d1927602` |
| abdomen GLB | `a2ef7a0cb84f5529d3a3ade975d145249a6fe28c55ebbd23522ab12862287dee` |
| legs PLY | `a2322d3b9c927c3e1a7b5431828f5eb0f13c5b1a55e6782cef75b8e455048c2e` |
| legs GLB | `deb49a2c78ad5f0f5bfc7a23f3c249b1dd4ed8721fdb79214ac82ed4c687c06b` |

## Regenerate the outputs

Run these commands from the repository root. The `real` value from `/usr/bin/time -p`
measures the whole command, matching the timing scope above.

```sh
uv venv --python 3.12 .venv
uv pip install --python .venv/bin/python -r pipeline/requirements-dev.txt
mkdir -p build
.venv/bin/python pipeline/fetch_sample.py abdomen --data-dir data
.venv/bin/python pipeline/fetch_sample.py legs --data-dir data
MPLBACKEND=Agg /usr/bin/time -p .venv/bin/python pipeline/main.py data/abdomen 0.1
MPLBACKEND=Agg /usr/bin/time -p .venv/bin/python pipeline/surfaces.py data/abdomen build/abdomen.glb --crop-z-min=-350
MPLBACKEND=Agg /usr/bin/time -p .venv/bin/python pipeline/main.py data/legs 0.1
MPLBACKEND=Agg /usr/bin/time -p .venv/bin/python pipeline/surfaces.py data/legs build/legs.glb --crop-z-min=900
```

The point clouds are `data/abdomen/DCMPLY/generated.ply` and `data/legs/DCMPLY/generated.ply`.
The GLBs are `build/abdomen.glb` and `build/legs.glb`.
These commands regenerate local validation outputs. They do not publish them.
Keep the legs skin, combined GLB, and point cloud private.

Compare the generated files with the hashes above.

```sh
shasum -a 256 data/abdomen/DCMPLY/generated.ply build/abdomen.glb
shasum -a 256 data/legs/DCMPLY/generated.ply build/legs.glb
```

Reload the GLBs to check mesh names, triangle counts, LPS bounds, and source metadata.
The skin z minimum matches the crop plane in each file.
The skin meshes are not watertight at the crop.

```sh
.venv/bin/python - <<'PYTHON'
import trimesh

for name in ("abdomen", "legs"):
    scene = trimesh.load(f"build/{name}.glb", force="scene")
    print(name)
    for key in ("coordinate_system", "units", "crop_z_min", "source_dataset"):
        print(key, scene.metadata[key])
    for mesh_name, mesh in scene.geometry.items():
        print(mesh_name, len(mesh.faces), mesh.bounds.tolist(), mesh.is_watertight)
PYTHON
```
