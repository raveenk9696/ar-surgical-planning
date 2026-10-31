"""Convert a CT DICOM series to a colored point cloud."""
import argparse
import time

from convertor import convertor


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path", help="Directory containing one CT DICOM series")
    parser.add_argument("interp_factor", type=float, help="Additional slices per mm of stack depth")
    parser.add_argument("--threshold-hu", type=float, default=-500,
                        help="Keep samples at or above this HU value (default -500, drops air and keeps skin)")
    parser.add_argument("--max-points", type=int, default=2_000_000,
                        help="Maximum exported points with fixed-seed sampling (default 2000000)")
    args = parser.parse_args()
    start = time.perf_counter()
    count = convertor(args.path, args.interp_factor, args.threshold_hu, args.max_points)
    print(f"Wrote {count} points in {time.perf_counter() - start:.2f} s")
