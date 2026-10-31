# Public scan validation

The 2026-10-31 run used Python 3.12.11 on macOS arm64.
Each timing is one CLI wall-clock run, including interpreter startup and file writing.
These are completion measurements, not a speed comparison.
Every GLB was reloaded and checked for names, triangle limits, source metadata, and skin crop bounds.

| Scan | Points | PLY bytes | Bone triangles | Skin triangles | GLB bytes | Point seconds | Surface seconds | Skin z minimum, LPS mm |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| abdomen | 2000000 | 30000187 | 300000 | 299999 | 11982896 | 6.08 | 11.09 | -350 |
| legs | 2000000 | 30000187 | 299999 | 214004 | 10333980 | 7.80 | 11.74 | 900 |

Both runs used an interpolation factor of 0.1 and the default point and triangle limits.
The source directories stayed read-only. The abdomen run used the verified download.
The legs run used temporary hard links to the public source files.

Offscreen renders were opened and inspected at `/tmp/ar-pipeline-evidence/abdomen-sanity.png`
and `/tmp/ar-pipeline-evidence/legs-sanity.png`.
The abdomen shows ribs, lumbar vertebrae, pelvis, and a cropped torso surface.
The legs show femurs, knees, tibias, fibulas, ankles, and feet.
Both have superior up and no visible table or scan-circle cylinder.
Neither skin surface shows genitals.
The legs crop leaves only a short skin section above the groin. The leg bones remain complete.
The crop leaves an open boundary at its plane.

The GLBs for the web app are `/tmp/ar-web-models/abdomen.glb` and `/tmp/ar-web-models/legs.glb`.
These paths are temporary deliverables, not committed assets.
GLB coordinates deliberately retain LPS mm. A viewer must apply any display rotation or unit conversion.

A fresh TCIA abdomen download passed all 189 per-file SHA256 checks.
`pipeline/samples.json` records the 189 abdomen and 267 legs file hashes, licenses, and dataset citations.
Abdomen attribution is Saltz et al. (2021), doi:10.7937/TCIA.BBAG-2923, CC BY 4.0.
Legs attribution is Vallières et al. (2015), doi:10.7937/K9/TCIA.2015.7GO2GSKS, CC BY 3.0.

A fresh uv environment with Python 3.12.11 installed `pipeline/requirements-dev.txt`.
All 12 synthetic tests passed in 13.23 seconds with external pytest plugins disabled.
Both real default point clouds were regenerated with the final code and were byte-identical
to the inspected outputs. The explicit bone-only HU threshold also has a red-to-green regression test.
