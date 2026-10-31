from DcmSequence import DcmSequence
from generator import generate_ply


def convertor(path, interp_factor, threshold_hu=-500, max_points=2_000_000):
    sequence = DcmSequence()
    sequence.load_dcm(path)
    sequence.sort_dcm()
    return generate_ply(sequence.volume(interp_factor), path, threshold_hu, max_points)
