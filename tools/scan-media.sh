#!/bin/sh
# Regenerates public/media/manifest.json from whatever is in public/media/.
# Run it after adding or removing source files.
set -eu
cd "$(dirname "$0")/../public/media"

ls | grep -iE '\.(mp4|mov|webm|m4v|jpg|jpeg|png|webp)$' \
  | python3 -c 'import json,sys; print(json.dumps([l.rstrip("\n") for l in sys.stdin], ensure_ascii=False, indent=1))' \
  > manifest.json
cat manifest.json
