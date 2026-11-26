#!/bin/sh
# Builds the CODESYS package (tools/codesys-bundle.mjs) for an example project and checks it (tools/check_st.py).
#   tools/check-codesys.sh [project.vtd.json]
set -e
cd "$(dirname "$0")/.."
JSC=/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc
OUT=$(mktemp -d)
"$JSC" -m tools/codesys-bundle.mjs -- st ${1:+"$1"} > "$OUT/codesys.st"
"$JSC" -m tools/codesys-bundle.mjs -- xml ${1:+"$1"} > "$OUT/codesys.xml"
if grep -q '^FOUT: ' "$OUT/codesys.st"; then cat "$OUT/codesys.st"; exit 1; fi
python3 tools/check_st.py "$OUT/codesys.st" "$OUT/codesys.xml"
rm -rf "$OUT"
