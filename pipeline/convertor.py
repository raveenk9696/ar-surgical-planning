from DcmSequence import DcmSequence
from generator import generate_ply


def convertor(path, interp_factor, threshold_hu=-500):
    sequence = DcmSequence()
    sequence.load_dcm(path)
    sequence.sort_dcm()
    return generate_ply(sequence.volume(), path, threshold_hu)
