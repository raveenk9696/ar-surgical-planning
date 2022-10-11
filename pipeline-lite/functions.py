#%% Importing Libraries
import os
import pydicom
import tqdm
import numpy as np


#%% Functions
# Importing DICOM files
def readDICOM(inputdir):
# INPUT: STRING - FILE DIRECTORY TO DICOM FILES
    test_list = []
    for file in os.listdir(inputdir):
        if file.endswith(".dcm"):
            test_list.append(pydicom.read_file(os.path.join(inputdir, file)))
    return test_list

#%%
# Sorting DICOM files into order
def sortDICOM_SliceLocatiom(dcmList):
# INPUT: LIST - DICOM LIST
    slices = []
    skipcount = 0
    for f in tqdm.tqdm(dcmList, total=len(dcmList)):
        if hasattr(f, 'SliceLocation'):
            slices.append(f)
        else:
            skipcount = skipcount + 1

    print("Slices with no SliceLocation: {}".format(skipcount))
    if skipcount != len(dcmList):
        dcmList = sorted(slices, key=lambda s: s.SliceLocation)
    return dcmList
    # Sort in descending order of image position

#%%
def sortDICOM_Position(dcmList):
# INPUT: LIST - DICOM LIST
    slices = []
    skipcount = 0
    for f in tqdm.tqdm(dcmList, total=len(dcmList)):
        if hasattr(f, 'ImagePositionPatient'):
            slices.append(f)
        else:
            skipcount = skipcount + 1

    print("Slices with no Image Position (Patient): {}".format(skipcount))

    ImagePosition_List = np.asarray([i.ImagePositionPatient for i in slices])
    # Finding the changing axis
    ChangingImagePosition = ImagePosition_List[:, ~np.all(ImagePosition_List[1:] == ImagePosition_List[:-1], axis=0)]
    dcmList = sorted(slices, key=lambda s: s.ImagePositionPatient[2])
    return dcmList

#%%
# Bounding Box Calculator
def boundingBoxCalc(dcmList):
# INPUT: LIST - DICOM LIST

# Use the Pixel Spacing property to identify the height and width of the bounding box
# Refer image in http://dicom.nema.org/medical/dicom/current/output/html/figures/PS3.3_10.7.1.3-1.svg

    width = dcmList[0].PixelSpacing[1] * dcmList[0].Columns
    height = dcmList[0].PixelSpacing[0] * dcmList[0].Rows

# Use Image Position of Patient to determine the Z axis of the bounding box
    Image_PositionList = []
    for slice in dcmList:
        Image_PositionList.append(slice.ImagePositionPatient[2])

    depth = np.abs(np.max(np.asarray(Image_PositionList)) - np.min(np.asarray(Image_PositionList)))
    return width, height, depth

#%%
# Using Hounds Field Range (Window + Level to adjust detail
def viewBrainDetail(dcmList):
# INPUT: LIST - DICOM LIST

    level = 184
    window = 433
    max = level + window / 2
    min = level - window / 2

    output = []
    for slice in dcmList:
        image = slice.pixel_array
        output.append(image.clip(min, max))
    return output
