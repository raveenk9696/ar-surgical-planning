"""
Code for visualizing ply model
"""
import numpy as np
import open3d as o3d
import argparse

def colorConvert(gray: float, color: str):
    grayTable = [0, 29, 42, 55, 69, 83, 98, 114, 130, 147, 164, 181, 199, 217, 236, 255]
    redTable = [0, 26, 45, 70, 98, 128, 160, 195, 223, 244, 254, 255, 253, 246, 246, 255]
    greenTable = [0, 16, 24, 29, 33, 37, 41, 48, 65, 93, 126, 159, 190, 218, 240, 255]
    blueTable = [0, 63, 84, 103, 119, 132, 140, 141, 136, 120, 104, 96, 104, 133, 188, 255]
    
    gray = gray * 255

    colorTable = [0] * 16
    if(color == ("red")):
        colorTable = redTable
    if(color == ("green")):
        colorTable = greenTable
    if(color == ("blue")):
        colorTable = blueTable

    for i in range(len(grayTable)):
        if(grayTable[i] > gray):
            slope = (colorTable[i] - colorTable[i - 1]) / (grayTable[i] - grayTable[i - 1])
            intercept = colorTable[i] - slope * grayTable[i]
            return (slope * gray + intercept) / 255
            

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description="Provide path of PLY file")
    parser.add_argument('path', metavar='p', type=str,
                        help='The directory or file path of the DICOM images')
    args = parser.parse_args()
    path = args.path

    print("***** VISUALIZNG PLY *****")
    # Visualizing Point Cloud
    pcd = o3d.io.read_point_cloud(path)

    colors = np.asarray(pcd.colors)
    vColorConvert = np.vectorize(colorConvert)
    colors[:, 0] = vColorConvert(colors[:, 0], "red")
    colors[:, 1] = vColorConvert(colors[:, 1], "green")
    colors[:, 2] = vColorConvert(colors[:, 2], "blue")
    pcd.colors = o3d.utility.Vector3dVector(colors)
    o3d.visualization.draw_geometries([pcd])
