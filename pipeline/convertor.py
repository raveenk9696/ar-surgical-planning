# FUNCTION
# Standard Packages
import multiprocessing as mp
import numpy as np

# Custom Packages
from DcmSequence import DcmSequence
from  generator import generate_ply

def convertor(path,interp_factor):
    print("***** LOADING DICOMS *****")
    dcms = DcmSequence()
    dcms.load_dcm(path)
    dcms.sort_dcm()
    depth = dcms.stack_size()
    print(f"Utilizing {mp.cpu_count()} cores")
    images_temp = dcms.interpolate(interp_factor)

    images = np.concatenate(images_temp, axis=0)

    print(f"Done - Obtained {len(images)} images")
    pcd = generate_ply(images=images, depth=depth, path=path, spacing=dcms.voxel_spacing())
    print(pcd)