# SCRIPT
# Standard Packages
import numpy as np
import open3d as o3d
import argparse

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description="Provide path of PLY file and reduction factor")
    parser.add_argument('path', metavar='p', type=str,
                        help='The directory or file path of the DICOM images')
    parser.add_argument('ratio', metavar='d', type=float,
                        help='The sampling ratio for random downsampling between [0, 1]')
    args = parser.parse_args()
    path = args.path
    ratio = args.ratio

    print("***** BEGINNING DOWNSAMPLE *****")
    pcd = o3d.io.read_point_cloud(path)
    print("Original point cloud has " + str(len(np.asarray(pcd.points))) + " points.")

    downsampled_pcd = pcd.random_down_sample(ratio)

    print("New point cloud has " + str(len(np.asarray(downsampled_pcd.points))) + " points.")
    o3d.visualization.draw_geometries([downsampled_pcd])

    print("Saving new point cloud as downsampled")

    o3d.io.write_point_cloud("downsampled.ply", downsampled_pcd, write_ascii=True)