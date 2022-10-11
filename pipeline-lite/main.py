# SCRIPT
# Standard Packages
import argparse
import time
import multiprocessing as mp
import numpy as np

# Custom Packages
from functions import *

# Main Function
if __name__ == '__main__':
    # execute only if run as a script
    parser = argparse.ArgumentParser(description="Provide path of DICOM images")
    parser.add_argument('path', metavar='p', type=str,
                        help='The directory or file path of the DICOM images')
    args = parser.parse_args()
    path = args.path.toString()

# Timer Start
    startTime = time.time()

# Conversion Function
    dcmList = readDICOM(path)
    sortedDCMList_Position = sortDICOM_Position(dcmList)
    width, height, depth = boundingBoxCalc(dcmList)
# Timer End
    executionTime = (time.time() - startTime)
    print('Execution time in seconds: ' + str(executionTime))
