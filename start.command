#!/bin/sh
# Starts VT Designer on http://localhost:8766 and opens the browser.
cd "$(dirname "$0")"
(sleep 1; open "http://localhost:8766") &
python3 serve.py 8766
