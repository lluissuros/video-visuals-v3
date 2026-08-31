#!/bin/sh
# One-time setup for the performer-tracking prototype. Copies the MediaPipe
# wasm runtime out of node_modules and downloads the selfie segmenter model,
# so the app runs fully offline afterwards.
set -eu
cd "$(dirname "$0")/.."

mkdir -p public/models/wasm
cp node_modules/@mediapipe/tasks-vision/wasm/* public/models/wasm/

MODEL_URL="https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite"
curl -fL -o public/models/selfie_segmenter.tflite "$MODEL_URL"

echo "ok: public/models/"
ls -lh public/models public/models/wasm
