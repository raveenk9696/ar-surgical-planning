# AR surgical planning

This project turns a CT scan into a 3D model of bone and skin that you can view on a Microsoft HoloLens or in a web browser.

Surgeons often plan operations from 2D scan slices. In 2018, a 3D model of a CT scan took hours of image work by hand. This pipeline makes the model from the DICOM files without manual segmentation.

## My role

I started this project. In June 2018 I wrote a grant proposal for a HoloLens. I learned Python and Linux scripting to build the app in Dr Chamith Rajapakse's lab at the Hospital of the University of Pennsylvania. By 2019 my scripts turned CT scans into 3D models of bone and skin, and I checked them on a HoloLens. I then led a lab team that grew it into a web app where several people can view and annotate a scan's 3D model together in AR. I presented the work as first author at SPIE Medical Imaging 2020 and 2022, and it became my master's thesis.

TODO(Raveen): say which parts of this repository you wrote yourself.

## What is in this repository

- `pipeline/` is the 2022 Python pipeline. `main.py` reads a CT DICOM series, sorts the slices, scales them to 8-bit, interpolates new slices between them, drops pixels under an intensity threshold, and writes a colored PLY point cloud. `downsample.py` thins the cloud, `outlierRemoval.py` removes points by Mahalanobis distance, and `color_visualize.py` maps gray values to a color table.
- `pipeline-lite/` reads a DICOM series and computes the size of the model's bounding box in millimeters from the DICOM headers.
- `viewer/` is a React and three.js page that loads a PLY file and lets you rotate it.
- `tools/publish_check.py` fails if any commit in the history holds medical images, 3D models, files over 5 MB, or secrets.

The 2018 and 2019 scripts are not in git. The HoloLens client is a separate Unity project, [albert239825/HololensUnityProject](https://github.com/albert239825/HololensUnityProject).

## Status

This is lab code from 2021 and 2022. At this commit `pipeline/main.py` stops at the PLY step: `convertor.py` passes chunks of slices where `generator.py` expects single slices.

TODO: fix the pipeline, run it on a public sample scan, add tests, and add a screenshot of the result.

## Credits

The git history keeps each commit's original author and date.

| Git author | Work |
|---|---|
| raveenk9696 (Raveen Kariyawasam) | Committed the pipeline (May 2022), `viewer/`, and `pipeline-lite/` (October 2022). |
| solimaga | `downsample.py`, `outlierRemoval.py`, and `color_visualize.py` (June to August 2022). |
| albid852 | `DcmSequence.py`, `preprocessing.py`, `PlotDCM.py`, and the img2ply port in `generator.py`. These files first appear in albid852's DicomSequence repository (2021). |
| albert239825 | The HoloLens Unity app, in its own repository. |

TODO(Raveen): confirm each person's real name and that they agree to be named.

## Patient data

This repository holds no patient data. The old private repositories held a CT scan from the lab. It is not part of this history.
