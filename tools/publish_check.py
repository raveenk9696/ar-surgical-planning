"""Fail if any commit in this repo's history holds medical image data, large files, or secrets.

Run it before the repo goes public, and in CI. It reads every blob reachable from any ref,
so a file deleted in a later commit still fails the check.

Usage: python tools/publish_check.py [repo]
"""
import shutil
import subprocess
import sys

MAX_BYTES = 5 * 1024 * 1024
IMAGE_SUFFIXES = (".dcm", ".ima", ".nii", ".nii.gz", ".nrrd", ".mha", ".mhd", ".ply", ".obj", ".stl")
BANNED_DIRS = ("node_modules/", "__pycache__/")


def git(repo, *args):
    return subprocess.run(["git", "-C", repo, *args], capture_output=True, check=True).stdout


def blobs(repo):
    paths = {}
    for line in git(repo, "rev-list", "--objects", "--all").decode().splitlines():
        sha, _, path = line.partition(" ")
        if path:
            paths.setdefault(sha, path)
    batch = subprocess.run(["git", "-C", repo, "cat-file", "--batch-check=%(objectname) %(objecttype) %(objectsize)"],
                           input="\n".join(paths).encode(), capture_output=True, check=True).stdout
    for line in batch.decode().splitlines():
        sha, kind, size = line.split()
        if kind == "blob":
            yield sha, paths[sha], int(size)


def problems(repo):
    reader = subprocess.Popen(["git", "-C", repo, "cat-file", "--batch"], stdin=subprocess.PIPE, stdout=subprocess.PIPE)
    for sha, path, size in list(blobs(repo)):
        lower = path.lower()
        if lower.endswith(IMAGE_SUFFIXES):
            yield f"medical image or 3D model file: {path}"
        if any(f"/{d}" in f"/{lower}" for d in BANNED_DIRS) or lower.endswith(".ds_store"):
            yield f"build or OS artifact: {path}"
        if size > MAX_BYTES:
            yield f"file over {MAX_BYTES // 1048576} MB ({size / 1048576:.1f} MB): {path}"
        reader.stdin.write(f"{sha}\n".encode())
        reader.stdin.flush()
        reader.stdout.readline()
        content = reader.stdout.read(size + 1)
        if content[128:132] == b"DICM" and not lower.endswith(IMAGE_SUFFIXES):
            yield f"DICOM data (DICM marker) under another name: {path}"
    reader.stdin.close()
    reader.wait()
    if shutil.which("gitleaks") is None:
        yield "gitleaks is not installed, so secrets were not checked"
    elif subprocess.run(["gitleaks", "git", repo, "--redact", "--no-banner", "--log-level", "error"]).returncode:
        yield "gitleaks found secrets in the history (output above)"


if __name__ == "__main__":
    repo = sys.argv[1] if len(sys.argv) > 1 else "."
    found = sorted(set(problems(repo)))
    for line in found:
        print(f"FAIL {line}")
    print(f"publish check: {len(found)} problem(s)")
    sys.exit(1 if found else 0)
