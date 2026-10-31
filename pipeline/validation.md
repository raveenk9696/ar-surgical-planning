# Public scan validation

The 2026-10-31 run used Python 3.12.11 on macOS arm64.
Each timing is elapsed wall-clock time around one complete CLI subprocess.
The measurement includes interpreter startup and file writing.
The CLI prints a separate in-process time that starts after imports.
These are completion measurements, not a speed comparison.
Every GLB was reloaded and checked for names, triangle limits, source metadata, and skin crop bounds.

| Scan | Points | PLY bytes | Bone triangles | Skin triangles | GLB bytes | Point seconds | Surface seconds | Skin z minimum, LPS mm |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| abdomen | 2000000 | 30000187 | 300000 | 299999 | 11982896 | 6.08 | 11.09 | -350 |
| legs | 2000000 | 30000187 | 299999 | 214004 | 10333980 | 7.80 | 11.74 | 900 |

Both runs used an interpolation factor of 0.1 and the default point and triangle limits.
The source directories stayed read-only. The abdomen run used the verified download.
The legs run used temporary hard links to the public source files.

The original visual inspection found the following anatomy.
The abdomen shows ribs, lumbar vertebrae, pelvis, and a cropped torso surface.
The legs show femurs, knees, tibias, fibulas, ankles, and feet.
Both have superior up and no visible table or scan-circle cylinder.
The legs skin crop at LPS z 900 mm still leaves groin tissue.
Share only the legs bone mesh, not its skin, combined GLB, or uncropped point cloud.
Bone is not cropped. The legs scan starts mid-thigh, so it does not contain complete femurs.
The crop leaves an open boundary at its plane.

Only `abdomen.glb` feeds the web app. Legs is a pipeline test sample.
GLB coordinates deliberately retain LPS mm. A viewer must apply any display rotation or unit conversion.

A fresh TCIA abdomen download passed all 189 per-file SHA256 checks.
`pipeline/samples.json` records the 189 abdomen and 267 legs file hashes, licenses, and dataset citations.
Abdomen attribution is Saltz et al. (2021), doi:10.7937/TCIA.BBAG-2923, CC BY 4.0.
Legs attribution is Vallières et al. (2015), doi:10.7937/K9/TCIA.2015.7GO2GSKS, CC BY 3.0.

A fresh uv environment with Python 3.12.11 installed `pipeline/requirements-dev.txt`.
All 12 synthetic tests passed in 13.23 seconds with external pytest plugins disabled.
Both real default point clouds were regenerated with the final code and were byte-identical
to the inspected outputs. The explicit bone-only HU threshold also has a red-to-green regression test.

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
