#!/bin/bash
# Sync project source files to the workspace dashboard directory
# Run after any frontend changes to ensure the served files match the repo

SRC="/root/projects/openclaw-project-webos"
DST="/root/.openclaw/workspace/dashboard"

# Ensure target directories exist
mkdir -p "$DST/src/shell/native-views"
mkdir -p "$DST/src/styles"

# Shell modules
rsync -av --delete "$SRC/src/shell/" "$DST/src/shell/" --exclude '*.test.*' 2>/dev/null

# Styles
rsync -av "$SRC/src/styles/" "$DST/src/styles/" 2>/dev/null

# Dashboard HTML
cp "$SRC/index.html" "$DST/index.html" 2>/dev/null

echo "Dashboard synced to workspace"
