import argparse
import glob
import os

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description="Provide path of folder with files")
    parser.add_argument('path', metavar='p', type=str,
                        help='The directory or file path of the images')
    args = parser.parse_args()
    path = args.path

    files = glob.glob(os.path.normpath(path + "/*"))
    if len(files) == 0:
        RuntimeWarning("No files found in this directory")
    else:
        for file in files:
            name, ext = os.path.splitext(file)
            os.rename(file, name + ".dcm")