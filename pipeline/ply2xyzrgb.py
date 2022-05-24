import open3d as o3d
import argparse

# pcd = o3d.io.read_point_cloud(ply)
# o3d.io.write_point_cloud("generated.ply", pcd)

if __name__ == '__main__':
    # execute only if run as a script
    parser = argparse.ArgumentParser(description="Provide path of DICOM images and interpolation factor")
    parser.add_argument('path', metavar='p', type=str,
                        help='The directory or file path of the DICOM images')

    args = parser.parse_args()
    path = args.path

    pcd = o3d.io.read_point_cloud(path)
    o3d.io.write_point_cloud("generated.xyzrgb", pcd)
