import open3d as o3d
import argparse

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description="Provide path of PLY file")
    parser.add_argument('path', metavar='p', type=str,
                        help='The directory or file path of the DICOM images')
    args = parser.parse_args()
    path = args.path

    print("***** VISUALIZNG PLY *****")
    # Visualizing Point Cloud
    pcd = o3d.io.read_point_cloud(path)
    # voxel_down_pcd = pcd.voxel_down_sample(voxel_size=0.1)  # downsample

    # drawing both results
    # o3d.visualization.draw_geometries([pcd])
    o3d.visualization.draw_geometries([pcd])