import os
import numpy as np
import pydicom
import glob
import cv2
import matplotlib.pyplot as plt
from typing import Union, Tuple, List
from preprocessing import apply_clahe, apply_fiji_normalization, \
    apply_cr_normalization, convert_int_to_uint, interpolate_imgs2vol, \
    interpolate_dcm2vol, get_png
from PlotDCM import plot_comparisons, multi_slice_viewer
import multiprocessing as mp
from functools import partial
import tqdm
from itertools import  repeat

def _get_new_ds(ds: pydicom.dataset.Dataset, name: str):
    """
    Create a new dicom header. Creates a new dataset object and sets all existing
    fields in ds.
    :param ds: old dataset to base this new one off of
    :param name: name for this file
    :return: The new dicom dataset object with all header information. No pixel data.
    """
    file_meta = ds.file_meta

    new_ds = pydicom.dataset.FileDataset(name, {}, file_meta=file_meta,
                                         preamble=b"\0" * 128, is_implicit_VR=ds.is_implicit_VR,
                                         is_little_endian=ds.is_little_endian)

    a = [attr for attr in dir(ds) if not attr.startswith('__') and not callable(getattr(ds, attr))]

    for attr in a:
        if attr in ['_character_set', 'is_original_encoding', 'pixel_array',
                    'BitsAllocated', 'BitsStored', 'HighBit', 'ImagerPixelSpacing',
                    'PixelRepresentation', 'PixelData']:
            continue
        else:
            new_ds.__setattr__(attr, ds.__getattr__(attr))

    # fix bits
    new_ds.BitsAllocated = 8
    new_ds.BitsStored = 8
    new_ds.HighBit = 7
    new_ds.PixelRepresentation = 0

    return new_ds


class DcmSequence:
    def __init__(self):
        self._dcm_files = []
        self._collection = []
        self._mask_files = []
        self._masks = []

    def __str__(self):
        s = "-----------------------------------------\n DICOMS\n"
        for i in range(len(self._dcm_files)):
            img_shape = self._collection[i].pixel_array.shape
            img_dtype = self._collection[i].pixel_array.dtype
            name = self._dcm_files[i]
            s += f"{i}) DCM of shape {img_shape}, dtype {img_dtype}\n"
            s += f"\t Filepath: {name}\n \n"
        s += "-----------------------------------------\n MASKS\n"
        for i in range(len(self._mask_files)):
            img_shape = self._masks[i].shape
            img_dtype = self._masks[i].dtype
            name = self._mask_files[i]
            s += f"{i}) Image of shape {img_shape}, dtype {img_dtype}\n"
            s += f"\t Filepath: {name}\n \n"
        return s

    def __repr__(self):
        return f"DcmSequence of {len(self._collection)} DICOMS, {len(self._masks)} Masks"

    def load_dcm(self, src: str) -> None:
        """
        Add a dicom to the collection
        :param src: Source directory to read the dicoms in from.
        :return: None
        """
        files = glob.glob(os.path.normpath(src + "/*.dcm"))
        if len(files) == 0:
            RuntimeWarning("No DICOM files found in this directory")
        else:
            for file in files:
                if file not in self._dcm_files:
                    ds = pydicom.dcmread(file)
                    if ds.file_meta.TransferSyntaxUID.is_compressed:
                        ds.decompress()
                    self._collection.append(ds)
                    self._dcm_files.append(file)

    def stack_size(self):
        length = len(self._dcm_files)
        return length

    def voxel_spacing(self) -> Tuple[float, float, float]:
        first = self._collection[0]
        if len(self._collection) > 1 and hasattr(first, "ImagePositionPatient"):
            separation = np.linalg.norm(np.asarray(self._collection[1].ImagePositionPatient, dtype=float)
                                        - np.asarray(first.ImagePositionPatient, dtype=float))
        else:
            separation = abs(float(getattr(first, "SpacingBetweenSlices", first.SliceThickness)))
        return float(first.PixelSpacing[0]), float(first.PixelSpacing[1]), float(separation)

    def save_dcm(self, dest: str) -> None:
        """
        Save the dicom to the destination folder.
        :param dest: destination folder
        :return: None
        """
        dest = os.path.normpath(dest + '/')
        if not os.path.exists(dest):
            os.mkdir(dest)
        for i, path in enumerate(self._dcm_files):
            filename = os.path.basename(path)
            self._collection[i].save_as(os.path.join(dest, filename))


    def load_mask(self, src: str) -> None:
        """
        Add a mask to the masks
        :param src: Source directory to read the masks in from.
        :return: None
        """
        files = glob.glob(os.path.normpath(src + "/*"))
        if len(files) == 0:
            RuntimeWarning("No DICOM files found in this directory")
        else:
            for file in files:
                if file not in self._mask_files:
                    img = cv2.imread(file, flags=0)
                    self._masks.append(img)
                self._mask_files.append(file)


    def save_mask(self, dest: str) -> None:
        """
        Save the masks to the destination folder.
        :param dest: destination folder
        :return: None
        """
        dest = os.path.normpath(dest + '/')
        if not os.path.exists(dest):
            os.mkdir(dest)
        for i, path in enumerate(self._mask_files):
            filename = os.path.basename(path)
            cv2.imwrite(os.path.join(dest, filename), self._masks[i])

    def is_empty(self):
        return len(self._collection) == 0 and len(self._masks) == 0

    def sort_dcm(self, reverse: bool = False) -> None:
        """
        Sort the dicoms by their position along the slice normal. File names
        do not give the slice order, so they only break ties.
        :param reverse: whether to sort in ascending or descending order.
                        False is ascending. True is descending.
        :return: None
        """
        def position(item):
            name, ds = item
            if hasattr(ds, "ImagePositionPatient") and hasattr(ds, "ImageOrientationPatient"):
                row, column = np.asarray(ds.ImageOrientationPatient, dtype=float).reshape(2, 3)
                normal = np.cross(row, column)
                return 0, float(normal @ np.asarray(ds.ImagePositionPatient, dtype=float)), name
            return 1, float(getattr(ds, "InstanceNumber", None) or 0), name

        x = sorted(zip(self._dcm_files, self._collection), key=position, reverse=reverse)
        self._dcm_files = [d for d, c in x]
        self._collection = [c for d, c in x]


    def sort_mask(self, reverse: bool = False) -> None:
        """
        Sort the masks based on their names in mask_files.
        :param reverse: whether to sort in ascending or descending order.
                        False is ascending. True is descending.
        :return: None
        """
        zipped = zip(self._mask_files, self._masks)
        x = sorted(zipped, reverse=reverse)
        self._mask_files = [d for d, c in x]
        self._masks = [c for d, c in x]


    def remove_dcm(self, **kwargs) -> None:
        """
        Remove a dicom and path from the collection.
        :param kwargs: Expecting to receive name or idx of file to remove
        :return: None
        """
        if 'name' not in kwargs.keys() and 'idx' not in kwargs.keys():
            raise KeyError('Expected either filename or index to delete')
        elif 'name' in kwargs.keys():
            name = kwargs['name']
            if name not in self._dcm_files:
                raise ValueError(name + ' is not in files')
            else:
                idx = self._dcm_files.index(name)
                self._dcm_files.remove(name)
                self._collection.remove(self._collection[idx])
        elif 'idx' in kwargs.keys():
            idx = kwargs['idx']
            if idx >= len(self._dcm_files):
                raise ValueError('Index out of bounds')
            else:
                self._dcm_files.remove(self._dcm_files[idx])
                self._collection.remove(self._collection[idx])


    def remove_mask(self, **kwargs) -> None:
        """
        Remove a mask and path from the collection.
        :param kwargs: Expecting to receive name or idx of file to remove
        :return: None
        """
        if 'name' not in kwargs.keys() and 'idx' not in kwargs.keys():
            raise KeyError('Expected either filename or index to delete')
        elif 'name' in kwargs.keys():
            name = kwargs['name']
            if name not in self._mask_files:
                raise ValueError(name + ' is not in files')
            else:
                idx = self._mask_files.index(name)
                self._mask_files.remove(name)
                self._masks.remove(self._masks[idx])
        elif 'idx' in kwargs.keys():
            idx = kwargs['idx']
            if idx >= len(self._mask_files):
                raise ValueError('Index out of bounds')
            else:
                self._mask_files.remove(self._mask_files[idx])
                self._masks.remove(self._masks[idx])


    def resize(self, dim: Tuple[int, int]) -> None:
        """
        Resize all dicoms and masks to the same dimension.
        :param dim: desired dimension of images (rows, columns)
        :return: None
        """
        for i in range(len(self._dcm_files)):
            ds = self._collection[i]
            image = ds.pixel_array
            if image.shape[0] != dim[0] and image.shape[1] != dim[1]:
                downsampled = cv2.resize(image, dim)
                ds.PixelData = downsampled.tobytes()
                ds.Rows, ds.Columns = downsampled.shape

                self._collection[i] = ds

        for i in range(len(self._mask_files)):
            img = self._masks[i]
            if img.shape[0] != dim[0] and img.shape[1] != dim[1]:
                img = cv2.resize(img, dim)
                img[img < 128] = 0
                img[img >= 128] = 255
                self._masks[i] = img


    def plot_norms(self, start: int = 0, end: Union[int, None] = None) -> None:
        """
        View the comparisons of preprocessing algorithms of dicom images in the collection
        from start to end indices. Press q to view next image.
        :param start: Which index to start at in the collection.
        :param end: Which index to stop at in the collection (exclusive). Value of None will plot
        every image.
        :return: None
        """

        if end is None:
            clip_lim = 40
            tile_grid_size = (8, 8)

            for i in range(len(self._collection)):
                img = self._collection[i].pixel_array
                img_cr = apply_cr_normalization(img)
                img_clahe = apply_clahe(img, clip_lim=clip_lim, tile_grid_size=tile_grid_size)
                img_fiji = apply_fiji_normalization(img)

                plot_comparisons(img, cr=img_cr, fiji=img_fiji, clahe=img_clahe)
                print('Press q to close this plot and view next image')
                plt.waitforbuttonpress()

        elif isinstance(end, int):
            clip_lim = 40
            tile_grid_size = (8, 8)

            for i in range(start, end):
                img = self._collection[i].pixel_array
                img_cr = apply_cr_normalization(img)
                img_clahe = apply_clahe(img, clip_lim=clip_lim, tile_grid_size=tile_grid_size)
                img_fiji = apply_fiji_normalization(img)

                plot_comparisons(img, cr=img_cr, fiji=img_fiji, clahe=img_clahe)
                print('Press q to close this plot and view next image')
                plt.waitforbuttonpress()


    def volshow(self, start: int = 0, end: Union[int, None] = None) -> None:
        """
        View the dicom images in the collection from start to end indices. Press left and
        right arrow keys to scroll through.
        :param start: Which index to start at in the collection.
        :param end: Which index to stop at in the collection (exclusive). Value of None
        will plot every image.
        :return: None
        """

        if end is None:
            vol = get_png(self._collection[start:])
            multi_slice_viewer(np.array(vol))

        elif isinstance(end, int):
            vol = get_png(self._collection[start:end])
            multi_slice_viewer(np.array(vol))


    def mask_show(self, start: int = 0, end: Union[int, None] = None) -> None:
        """
        View the mask images in the collection from start to end indices. Press left and
        right arrow keys to scroll through.
        :param start: Which index to start at in the collection.
        :param end: Which index to stop at in the collection (exclusive). Value of None
        will plot every image.
        :return: None
        """

        if end is None:
            multi_slice_viewer(np.array(self._masks))

        elif isinstance(end, int):
            multi_slice_viewer(np.array(self._masks[start:end]))


    def interpolate(self, interp_factor: float, clahe: bool = False, norm_alg: int = 1) -> np.ndarray:
        """
        Create an interpolated volume from the image stack. This will interpolate slices of
        images between every consecutive pair of slices. The num_slices determines how
        many interpolated slices are between the original slices and the separation between them.
        :param interp_factor: interpolation factor
        :param clahe: whether or not to perform clahe on the images
        :param norm_alg: which normalization algorithm to use to get the image between 0-255.
        If using clahe, recommended to set norm_alg = 0. norm_alg = 1 is for the fiji
        normalization. norm_alg = 2 is for CR normalization.
        :return: the entire interpolated volume
        """

        ### Setting up pool
        print("Initializing Multicore Pooling")
        p = mp.Pool()
        interpolate_dcm2volPartial = partial(interpolate_dcm2vol,interp_factor=interp_factor)
        splitStack = np.array_split(self._collection, np.floor(len(self._collection)/3))
        test = interpolate_dcm2vol(splitStack[0], interp_factor=interp_factor)
        stack = list(tqdm.tqdm(p.imap(interpolate_dcm2volPartial, splitStack), total = len(splitStack)))
        p.close()
        p.join()
        return stack


    def interpolate_mask_volume(self, num_slices: int = 4, binarize: bool = False, split_val: int = 128) -> np.ndarray:
        """
        Create an interpolated volume from the image stack. This will interpolate slices of
        images between every consecutive pair of slices. The num_slices determines how
        many interpolated slices are between the original slices and the separation between them.
        :param num_slices: Number of interpolated slices between the original slices
        :param binarize: whether to binarize the interpolated volume or not
        :param split_val: int value to split the binarization
        :return: the entire interpolated volume
        """
        images = np.array(self._masks)
        stack = interpolate_imgs2vol(images, num_slices=num_slices)
        if binarize:
            stack[stack < split_val] = 0
            stack[stack >= split_val] = 255
        return stack


    def get_png(self, clahe: bool = False, norm_alg: int = 1) -> (List[str], List[np.ndarray]):
        """
        Get list of png images and list of file names by converting the current dicoms in the
        collection to 8-bit using the preferred norm-alg.
        :param clahe: whether or not to perform clahe on the images
        :param norm_alg: which normalization algorithm to use to get the image between 0-255.
        If using clahe, recommended to set norm_alg = 0. norm_alg = 1 is for the fiji
        normalization. norm_alg = 2 is for CR normalization.
        :return: List of file names (not the path), list of png images
        """
        # use if statements for the 3 dif algorithms for normalization
        png_names = []
        for path in self._dcm_files:
            png_names.append(os.path.splitext(os.path.basename(path))[0] + '.png')

        images = get_png(self._collection, clahe=clahe, norm_alg=norm_alg)
        return png_names, images

    def binarize_masks(self, threshold: int) -> None:
        """
        Turn current masks into binarized masks, limited to 0 or 255 intensity.
        :threshold: value to threshold the images at.
        :return: None
        """
        for i in range(len(self._masks)):
            m = self._masks[i]
            m[m < threshold] = 0
            m[m >= threshold] = 255
            self._masks[i] = m

    def convert_to_8bit(self, clahe: bool = False, norm_alg: int = 1) -> None:
        """
        Convert 16-bit dicoms to 8-bit dicoms.
        :clahe: whether or not to use the CLAHE algorithm on the image beforehand
        :norm_alg: which normalization algorithm to use to get the image between 0-255.
        If using clahe, recommended to set norm_alg = 0. norm_alg = 1 is for the fiji
        normalization. norm_alg = 2 is for CR normalization.
        :return: None
        """
        for i, path in enumerate(self._dcm_files):
            ds = self._collection[i]

            if ds.pixel_array.dtype == np.uint16 or ds.pixel_array.dtype == np.int16:
                name = os.path.basename(path)
                new_ds = _get_new_ds(ds, name)
                image = ds.pixel_array
                image = convert_int_to_uint(image)
                if clahe:
                    clip_lim = 40
                    tile_grid_size = (8, 8)
                    image = apply_clahe(image, clip_lim, tile_grid_size)

                if norm_alg == 0:
                    image = np.uint8((image / np.max(image)) * 255)
                elif norm_alg == 1:
                    image = apply_fiji_normalization(image)
                elif norm_alg == 2:
                    image = apply_cr_normalization(image)

                new_ds.PixelData = image.tobytes()

                self._collection[i] = new_ds
