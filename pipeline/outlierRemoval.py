# SCRIPT
# Standard Packages
import numpy as np
import open3d as o3d
import argparse

def split(arr, cond):
    return [arr[cond], arr[~cond]]

def outlier_removal(points, threshold):
	distance = pcd.compute_mahalanobis_distance()
	return split(np.hstack((np.asarray(pcd.points), np.asarray(pcd.colors))), np.asarray(distance) < threshold)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description="Provide path of PLY file and reduction factor")
    parser.add_argument('path', metavar='p', type=str,
                        help='The directory or file path of the DICOM images')
    parser.add_argument('threshold', metavar='t', type=float,
                        help='The max number of standard deviations a point can be from the mean without becoming an outlier')
    args = parser.parse_args()
    path = args.path
    threshold = args.threshold

    print("***** BEGINNING OUTLIER REMOVAL *****")
    pcd = o3d.io.read_point_cloud(path)

    inlierMap, outlierMap = outlier_removal(pcd, threshold)
    inlierPoints = inlierMap[:, :3]
    inlierColors = inlierMap[:, 3:]
    outlierPoints = outlierMap[:, :3]
    outlierColors = outlierMap[:, 3:]

    print(str(len(outlierPoints)) + " points were removed")
    print("New point cloud has " + str(len(inlierPoints)) + " points.")

    inliers = o3d.geometry.PointCloud()
    outliers = o3d.geometry.PointCloud()
    inliers.points = o3d.utility.Vector3dVector(inlierPoints)
    outliers.points = o3d.utility.Vector3dVector(outlierPoints)
    inliers.paint_uniform_color((0, 1, 0))
    outliers.paint_uniform_color((1, 0, 0))
    o3d.visualization.draw_geometries([inliers, outliers])

    inliers.colors = o3d.utility.Vector3dVector(inlierColors)
    o3d.visualization.draw_geometries([inliers])

    print("Saving new point cloud as processed.ply")
    o3d.io.write_point_cloud("processed.ply", inliers, write_ascii=True)