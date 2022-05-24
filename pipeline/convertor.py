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

    # Combining into one big list
    # images = []
    # for i in images_temp:
    #     images.extend(i)

    print(f"Done - Obtained {len(images_temp)} images")
    pcd = generate_ply(images=np.asarray(images_temp),depth=depth,path=path)
    print(pcd)