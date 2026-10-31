"""Separate the body from thin CT supports using physical in-plane morphology."""
import numpy as np
from scipy import ndimage as ndi

from volume import Volume


def main_parts(mask, fraction=0.1):
    labels, _ = ndi.label(mask)
    sizes = np.bincount(labels.ravel())
    sizes[0] = 0
    selected = sizes >= sizes.max() * fraction
    selected[0] = False
    return selected[labels]


def body_mask(volume: Volume, threshold_hu=-500):
    tissue = volume.hu >= threshold_hu
    opened = np.empty_like(tissue)
    spacing = volume.spacing[1:]
    for z, plane in enumerate(tissue):
        padded = np.pad(plane, 1)
        core = ndi.distance_transform_edt(padded, sampling=spacing) > 10
        if core.any():
            opened[z] = (ndi.distance_transform_edt(~core, sampling=spacing) <= 10)[1:-1, 1:-1]
        else:
            opened[z] = False
    opened = main_parts(opened)
    for z in range(len(opened)):
        opened[z] = ndi.binary_dilation(opened[z], iterations=2)
    return tissue & opened
