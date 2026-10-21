#!/bin/sh
cd "$(dirname "$0")"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
python3 textschnitt.py "$@"
