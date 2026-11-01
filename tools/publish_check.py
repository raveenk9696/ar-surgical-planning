"""Fail if this repo is not safe to make public.

It reads every object in the local git store, reachable or not, so a file
deleted in a later commit still fails. It also checks commit emails, the
license, and draft markers at HEAD. Run it before the repo goes public, and in CI.

Usage: python tools/publish_check.py [--deploy] [repo]

--deploy skips only the commit-email history check.
"""
import argparse
import re
import shutil
import subprocess
import sys

MAX_BYTES = 5 * 1024 * 1024
IMAGE_SUFFIXES = (".dcm", ".ima", ".nii", ".nii.gz", ".nrrd", ".mha", ".mhd", ".ply", ".obj", ".stl",
                  ".glb", ".gltf", ".fbx", ".usdz", ".3mf", ".vrm")
BANNED_DIRS = ("node_modules/", "__pycache__/")
DICOM_FIRST_ELEMENTS = (b"\x02\x00\x00\x00", b"\x08\x00\x05\x00", b"\x08\x00\x08\x00", b"\x08\x00\x16\x00", b"\x08\x00\x18\x00")
OBJ_VERTEX = re.compile(rb"^v -?\d", re.MULTILINE)
LOCAL_PATH = re.compile(rb"/Users/[A-Za-z]|/home/[A-Za-z]|C:\\\\?Users\\\\?[A-Za-z]")


def git(repo, *args, check=True):
    return subprocess.run(["git", "-C", repo, *args], capture_output=True, check=check).stdout.decode()


def blobs(repo):
    named = {}
    for line in git(repo, "rev-list", "--objects", "--all").splitlines():
        sha, _, path = line.partition(" ")
        if path:
            named.setdefault(sha, path)
    listing = git(repo, "cat-file", "--batch-all-objects", "--batch-check=%(objectname) %(objecttype) %(objectsize)")
    reader = subprocess.Popen(["git", "-C", repo, "cat-file", "--batch"], stdin=subprocess.PIPE, stdout=subprocess.PIPE)
    for line in listing.splitlines():
        sha, kind, size = line.split()
        if kind != "blob":
            continue
        reader.stdin.write(f"{sha}\n".encode())
        reader.stdin.flush()
        reader.stdout.readline()
        content = reader.stdout.read(int(size) + 1)[:-1]
        yield named.get(sha, f"<object {sha[:12]} on no branch>"), content
    reader.stdin.close()
    reader.wait()


def looks_like_dicom(content):
    return content[128:132] == b"DICM" or content[:4] in DICOM_FIRST_ELEMENTS


def looks_like_model(content):
    return content.startswith((b"ply\n", b"ply\r\n", b"solid ", b"glTF")) or len(OBJ_VERTEX.findall(content[:65536])) >= 50


def blob_problems(repo):
    for path, content in blobs(repo):
        lower = path.lower()
        if lower.endswith(IMAGE_SUFFIXES):
            yield f"data: medical image or 3D model file: {path}"
        elif looks_like_dicom(content):
            yield f"data: DICOM content under another name: {path}"
        elif looks_like_model(content):
            yield f"data: 3D model content under another name: {path}"
        if any(f"/{d}" in f"/{lower}" for d in BANNED_DIRS) or lower.endswith((".ds_store", ".pyc")):
            yield f"data: build or OS artifact: {path}"
        if len(content) > MAX_BYTES:
            yield f"data: file over {MAX_BYTES // 1048576} MB ({len(content) / 1048576:.1f} MB): {path}"
        if LOCAL_PATH.search(content):
            yield f"privacy: local user path in {path}"


def history_problems(repo):
    emails = set(git(repo, "log", "--all", "--format=%ae%n%ce").split())
    emails |= set(re.findall(r"<([^>]+)>", git(repo, "log", "--all", "--format=%(trailers:valueonly)")))
    for email in sorted(emails):
        if email != "noreply@github.com" and not email.endswith("@users.noreply.github.com"):
            yield f"privacy: personal email in commit metadata: {email}"


def head_problems(repo):
    top_level = git(repo, "ls-tree", "--name-only", "HEAD").splitlines()
    if not any(re.match(r"(LICEN[CS]E|COPYING)", name, re.I) for name in top_level):
        yield "license: no LICENSE file at the repo root"
    for hit in git(repo, "grep", "-n", "-I", "-E", "TODO[(:]", "HEAD", "--", ":!tools/publish_check.py", check=False).splitlines():
        yield f"draft: {hit.split(':', 1)[1]}"


def secret_problems(repo):
    if shutil.which("gitleaks") is None:
        yield "secrets: gitleaks is not installed, so secrets were not checked"
    elif subprocess.run(["gitleaks", "git", repo, "--redact", "--verbose", "--no-banner", "--log-level", "error"]).returncode:
        yield "secrets: gitleaks found secrets in the history (output above)"


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("repo", nargs="?", default=".")
    parser.add_argument("--deploy", action="store_true", help="skip only the commit-email history check")
    args = parser.parse_args()
    repo = args.repo
    emails = () if args.deploy else history_problems(repo)
    found = sorted({*blob_problems(repo), *emails, *head_problems(repo), *secret_problems(repo)})
    for line in found:
        print(f"FAIL {line}")
    print(f"publish check: {len(found)} problem(s)")
    sys.exit(1 if found else 0)
