# SCRIPT
# Standard Packages
import argparse
import time

# Custom Packages
from convertor import convertor

# Main Function
if __name__ == '__main__':
    # execute only if run as a script
    parser = argparse.ArgumentParser(description="Provide path of DICOM images and interpolation factor")
    parser.add_argument('path', metavar='p', type=str,
                        help='The directory or file path of the DICOM images')
    parser.add_argument('interp_factor', metavar='f', type=float,
                        help='Determines number of slices when using method 0')
    args = parser.parse_args()
    path = args.path
    interp_factor = args.interp_factor

    if interp_factor < 0 or interp_factor > 1:
        RuntimeWarning(f"Interp_factor received: {interp_factor}, but interp_factor must be between 0 and 1. "
                       f"Changed to 0.1")
        interp_factor = 0.1
# Timer Start
    startTime = time.time()

# Conversion Function
    convertor(path, interp_factor)

# Timer End
    executionTime = (time.time() - startTime)
    print('Execution time in seconds: ' + str(executionTime))

# Append to Excel Sheet - TO DO