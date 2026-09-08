#!/bin/sh
# One-time setup for performer tracking. Copies the MediaPipe wasm runtime out
# of node_modules and downloads the pose model, so the app runs fully offline
# afterwards.
#
# pose_landmarker detects PEOPLE first and segments second, so chairs, coats
# and projected shapes never become silhouettes. `full` is the balance that
# holds 30 fps next to the WebGL render; `lite` is the fallback on a slow
# machine (?posemodel=lite), `heavy` is too slow to render alongside.
set -eu
cd "$(dirname "$0")/.."

mkdir -p public/models/wasm
cp node_modules/@mediapipe/tasks-vision/wasm/* public/models/wasm/

base=https://storage.googleapis.com/mediapipe-models/pose_landmarker
for v in full lite; do
  curl -fL -o "public/models/pose_landmarker_$v.task" \
    "$base/pose_landmarker_$v/float16/latest/pose_landmarker_$v.task"
done

echo "ok: public/models/"
ls -lh public/models public/models/wasm
