"""
To-Do:
    optimize this entire thing to use numpy instead
    Also allow a file loading functionality afterwards (if i don't mix with dcmsequence)

The package can also be used as a library
::
    import img2ply
    img2ply.convert(
        input,
        ply,
        bb,
        direction="z",
        inverse=False,
        ignoreAlpha=True,
        wSamples=0,
        hSamples=0,
        maintainAspectRatio=True
    )

"""

import time
import fileinput
from PIL import Image
import numpy as np
import os
import multiprocessing as mp
import tqdm
import open3d as o3d

# ----------------------------------------------------------------------------

SUPPORTED_FILE_EXTENSION = ["png", "jpg"]
PLY_HEADER = """ply
format ascii 1.0
element vertex <VERTEXCOUNT>
property float32 x
property float32 y
property float32 z
property uchar red
property uchar green
property uchar blue
end_header
"""


# ----------------------------------------------------------------------------

def boolType(v):
    """
    This function can be parsed into the type of an argparse add argument.
    It's a hack but needed to add boolean attributes in a more intuitive way.

    :param v:
    :return: True/False
    :rtype: bool
    """
    return v.lower() in ["yes", "true", "t", "1"]


# ----------------------------------------------------------------------------

def getPositionMapper(direction):
    """
    Based on the depth direction the indices of the world position are ordered
    to match the users input.

    :param str direction: Acceptable arguments are 'x', 'y' and 'z'
    :return: List of indices
    :rtype: list
    """
    # variables
    order = []

    # build order
    if direction == "x":
        order = [2, 1, 0]
    elif direction == "y":
        order = [0, 2, 1]
    elif direction == "z":
        order = [0, 1, 2]

    # build mapper
    return order


def getImageData(img, threshold=50, ignore_alpha=True, w_samples=0,
                 h_samples=0, maintain_aspect_ratio=True):
    """
    Read the image and resize it based on the sample arguments, if the sample
    arguments are not set every pixel will be processed. When maintaining the
    aspect ratio the width will have priority over the height.

    :param img: numpy array of the image to transform
    :param bool ignore_alpha: Skip pixel is alpha is < 25
    :param int w_samples: Number of width sample points
    :param int h_samples: Number of height sample points
    :param maintain_aspect_ratio:
    :return: Normalized 2D point and colour information
    :rtype: list(tuple(position, colour))
    """

    # Rewriting image to have an Alpha Value
    img_gray = Image.fromarray(img, mode='L')
    imgRGB = img_gray.convert('RGB')
    imgRGB.putalpha(img_gray)
    image = imgRGB.convert('RGBA')

    data = []

    # get aspect ratio
    width, height = image.size
    aspect_ratio = float(height) / float(width)

    # get samples with aspect ratio
    if w_samples and maintain_aspect_ratio:
        h_samples = int(w_samples * aspect_ratio)
    elif h_samples and maintain_aspect_ratio:
        w_samples = int(h_samples * (1 / aspect_ratio))

    # get sample from with and height
    if not w_samples:
        w_samples = width
    if not h_samples:
        h_samples = height

    # resize image
    image.thumbnail((w_samples, h_samples), Image.ANTIALIAS)

    # loop pixels
    for x in range(image.size[0]):
        for y in range(image.size[0]):
            r, g, b, a = image.getpixel((x, y))

            if a < threshold and ignore_alpha:
                continue

            data.append(([x / float(w_samples), y / float(h_samples)], [r, g, b]))

    return data


# ----------------------------------------------------------------------------
def ImageDataHandler(images):
    print(images.shape)
    temp = getImageData(images)
    return temp

def divider():
    print("-" * 50)

def dataProcesser(data,wB,hB,dB,wI,hI,dI,length,multiplier):
    vertices = []
    for pos, colour in data:
        # map position in 3 dimensions
        position = [0, 0, 0]
        position[wI] = wB * pos[0]
        position[hI] = hB * pos[1]
        position[dI] = (dB / length) * i * multiplier

        vertex = position
        vertex.extend(colour)
        vertices.append(vertex)

    return vertices


def convertMP(
images: np.ndarray,
            ply: str,
            bb: list,
            direction: str = "z",
            inverse: bool = False,
            threshold: int = 25,
            ignore_alpha: bool = True,
            w_samples: int = 0,
            h_samples: int = 0,
            as_df: bool = True,
            maintain_aspect_ratio: bool = True):
    """
    Read the input directory and find all of the images of the supported file
    extensions. This list is sorted and will then have its pixels processed
    and stored in a PLY file format. All of the pixels will be mapped onto a
    bounding box that is provided by the user. This bounding box is a list in
    the following axis; x, y and z. The direction determines what depth
    direction is, the depth direction is the direction travelled between each
    images. This direction can be reversed if needed. The amount of samples
    can be adjusted to lower the resolution of the point cloud, in case the
    images are very high resolution the point cloud size can be adjusted by
    changing the amount of samples. If no samples are specified the images
    resolution will be used.

    :param images: list of numpy array images
    :param str ply: Output filepath
    :param list bb: Bounding box; x, y, z
    :param str direction: Depth direction
    :param bool inverse: Inverse depth direction
    :param int threshold: Remove all pixels with intensity below this value
    :param bool ignore_alpha: Skip pixel is alpha is < 25
    :param int w_samples: Number of width sample points
    :param int h_samples: Number of height sample points
    :param bool as_df: True to return a dataframe of xyzrgb, False to save the file to ply
    :param maintain_aspect_ratio:
    """
    # variables
    t = time.time()
    total_points = 0

    # get conversion dict
    mapper = getPositionMapper(direction)
    if not mapper:
        raise RuntimeError(
            "Invalid depth direction! Valid arguments: 'x', 'y' or 'z'"
        )

    # get direction multiplier
    multiplier = -1 if inverse else 1

    # get images
    length = len(images)
    if length == 0:
        print("No images found. Stopping PLY generation...")
        return

    # get mapper data
    wI, hI, dI = mapper
    wB, hB, dB = bb[wI], bb[hI], bb[dI]

    divider()

    divider()

    vertices = []
    print("Initializing Multicore Pooling - Getting Image Data")
    p = mp.Pool()
    divider()
    print("Extracting Image Data")
    # get image data
    # splitStack = np.array_split(images, mp.cpu_count())
    data = list(tqdm.tqdm(p.map(getImageData,images), total=len(images)))
    p.close()
    p.join()

    divider()
    print("Writing Point Cloud")
    divider()

    with open(ply, "w") as f:
        # write header
        f.write(PLY_HEADER)

        # get image data
        i = 0
        for dataSlice in data:
            # process data
            for pos, colour in dataSlice:
                # map position in 3 dimensions
                position = [0, 0, 0]
                position[wI] = wB * pos[0]
                position[hI] = hB * pos[1]
                position[dI] = (dB / max(length - 1, 1)) * i * multiplier

                # get strings
                # rounding positions to 3 decimals
                pos_string = [str(round(p, 3)) for p in position]
                colour_string = [str(c) for c in colour]

                # write data
                f.write("{0}\n".format(" ".join(pos_string + colour_string)))
                total_points += 1

            count_string = "< {0} / {1} >".format(i + 1, length).ljust(20)
            point_string = "Points Written: {0}".format(total_points).ljust(20)
            print(count_string, point_string)
            i += 1


    # update header
    divider()
    print("Updating header with vertex count: {0}".format(total_points))
    f = fileinput.FileInput(ply, inplace=True)
    for line in tqdm.tqdm(f, total=total_points):
        print(line.replace("<VERTEXCOUNT>", str(total_points)))
    f.close()
    # pcd = o3d.io.read_point_cloud(ply)
    # o3d.io.write_point_cloud("generated.ply", pcd)
    return total_points


# ----------------------------------------------------------------------------
def generate_ply(images: np.ndarray, path: str, depth: int, spacing: tuple) -> int:
    '''
    Generate an ASCII PLY from a (Z, H, W) uint8 stack. Return the vertex count.
    :param images: 3D numpy array of images
    :param path: path to save PLY file
    :param depth: number of original slices
    :param spacing: original voxel spacing in mm as (row, column, slice)
    :return: number of vertices
    '''
    print("***** BEGINNING PLY CONVERSION *****")

    ply_dir = os.path.join(path, "DCMPLY")
    if not os.path.exists(ply_dir):
        os.mkdir(ply_dir)
    ply_path = os.path.join(ply_dir, "generated.ply")

    # get dimensions of PLY (assuming all the same height and width)
    height, width = images.shape[1:]
    print(f"Dimensions (h, w, d) of Bounding Box: "
          f"({height}, {width}, {depth})")

    # convert
    # THE BOUNDING BOX has to be [Width, Height, Number of Slices]
    vertexCount = convertMP(
        images,
        ply_path,
        [width * spacing[1], height * spacing[0], (depth - 1) * spacing[2]],
        # [width, height, SliceNumber],
        direction="z",
        inverse=True,
        threshold=25,
        ignore_alpha=True,
        w_samples=200,
        h_samples=200,
        as_df=True,
        maintain_aspect_ratio=True
    )
    return vertexCount
    # return ply_path
