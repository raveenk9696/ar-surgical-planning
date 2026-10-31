"""Bone and skin surface export, added in 2026.

Meshes retain DICOM LPS coordinates in mm. Use --crop-z-min to remove skin
below a reviewed superior-inferior limit before sharing a groin scan.
"""
import argparse
import json
from pathlib import Path
import time

import fast_simplification
import numpy as np
from scipy import ndimage as ndi
from skimage.measure import marching_cubes
import trimesh

from body import body_mask, main_parts
from DcmSequence import DcmSequence
from volume import Volume


def mesh_from_field(volume: Volume, field, level, max_triangles, crop_z_min=None):
    if not np.any(field > level):
        raise ValueError(f"No tissue above {level} HU")
    padded = np.pad(field, 1, constant_values=min(-3024, level - 1))
    vertices, faces, _, _ = marching_cubes(padded, level, allow_degenerate=False)
    mesh = trimesh.Trimesh(volume.patient_points(vertices - 1), faces, process=False)
    if crop_z_min is not None:
        vertices, faces, _ = trimesh.intersections.slice_faces_plane(
            mesh.vertices, mesh.faces, [0, 0, 1], [0, 0, crop_z_min])
        mesh = trimesh.Trimesh(vertices, faces, process=False)
    if not len(mesh.faces):
        raise ValueError("The crop removes the entire skin mesh")
    if len(mesh.faces) > max_triangles:
        vertices, faces = fast_simplification.simplify(mesh.vertices, mesh.faces, target_count=max_triangles)
        mesh = trimesh.Trimesh(vertices, faces, process=False)
    if len(mesh.faces) > max_triangles:
        raise ValueError("Decimation did not meet the triangle limit")
    mesh.fix_normals(multibody=True)
    return mesh


def export_surfaces(volume: Volume, output, skin_hu=-300, bone_hu=200,
                    max_triangles=300_000, crop_z_min=None):
    if (max_triangles < 4 or not np.isfinite([skin_hu, bone_hu]).all()
            or (crop_z_min is not None and not np.isfinite(crop_z_min))):
        raise ValueError("Use finite thresholds and crop, and at least four triangles")
    body = body_mask(volume)
    filled = np.stack([ndi.binary_fill_holes(plane) for plane in body])
    skin_region = main_parts((volume.hu >= skin_hu) & filled)
    skin_filled = np.stack([ndi.binary_fill_holes(plane) for plane in skin_region])
    skin_field = np.where(skin_filled, np.maximum(volume.hu, skin_hu + 1), -3024).astype(np.float32)
    bone_region = main_parts((volume.hu >= bone_hu) & filled, fraction=0.005)
    bone_field = np.where(bone_region, volume.hu, min(-3024, bone_hu - 1)).astype(np.float32)
    scene = trimesh.Scene()
    for name, field, level, crop, color in (
        ("bone", bone_field, bone_hu, None, [240, 230, 207, 255]),
        ("skin", skin_field, skin_hu, crop_z_min, [225, 176, 153, 255]),
    ):
        mesh = mesh_from_field(volume, field, level, max_triangles, crop)
        mesh.visual.vertex_colors = color
        scene.add_geometry(mesh, geom_name=name, node_name=name)
    source = volume.source_dataset
    manifest = Path(__file__).with_name("samples.json")
    if manifest.exists():
        for name, sample in json.loads(manifest.read_text()).items():
            if sample["series_uid"] == volume.series_uid:
                source = {"name": name, **{key: sample[key] for key in ("dataset", "license", "citation")}}
    scene.metadata.update(spacing=volume.spacing.tolist(), series_uid=volume.series_uid,
                          source_dataset=source, coordinate_system="LPS", units="mm",
                          crop_z_min=crop_z_min, skin_hu=skin_hu, bone_hu=bone_hu)
    Path(output).write_bytes(scene.export(file_type="glb"))
    return {name: len(mesh.faces) for name, mesh in scene.geometry.items()}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("dicom_dir")
    parser.add_argument("output")
    parser.add_argument("--skin-hu", type=float, default=-300)
    parser.add_argument("--bone-hu", type=float, default=200)
    parser.add_argument("--max-triangles", type=int, default=300_000, help="Maximum faces per mesh")
    parser.add_argument("--crop-z-min", type=float, help="Keep skin at or above this DICOM LPS z in mm")
    args = parser.parse_args()
    start = time.perf_counter()
    sequence = DcmSequence()
    sequence.load_dcm(args.dicom_dir)
    counts = export_surfaces(sequence.volume(), args.output, args.skin_hu, args.bone_hu,
                             args.max_triangles, args.crop_z_min)
    print(f"Wrote {counts} in {time.perf_counter() - start:.2f} s")
