#!/usr/bin/env bash
# Build unsigned .ipa for Sideloadly / AltStore (no Apple secrets needed)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

WORKSPACE="ios/App/App.xcworkspace"
OUTPUT="build/AIProductScanner.ipa"

if [ ! -f "$WORKSPACE/contents.xcworkspacedata" ]; then
  echo "Error: Xcode workspace not found. Run setup-ios-ci.sh first."
  exit 1
fi

mkdir -p build

echo "→ Building for iOS device (unsigned)..."
(
  cd ios/App
  xcodebuild \
    -workspace App.xcworkspace \
    -scheme App \
    -configuration Release \
    -sdk iphoneos \
    -destination 'generic/platform=iOS' \
    -derivedDataPath build \
    CODE_SIGNING_ALLOWED=NO \
    CODE_SIGNING_REQUIRED=NO \
    CODE_SIGNING_IDENTITY="-" \
    ONLY_ACTIVE_ARCH=NO \
    build
)

echo "→ Packaging IPA..."
(
  cd ios/App
  APP_PATH=$(find build -name "*.app" -type d | head -1)
  if [ -z "$APP_PATH" ]; then
    echo "Error: .app not found"
    find build -maxdepth 8 -type d 2>/dev/null || true
    exit 1
  fi
  echo "Found: $APP_PATH"
  rm -rf Payload
  mkdir -p Payload
  cp -R "$APP_PATH" Payload/
  zip -qr "../../build/AIProductScanner.ipa" Payload
  rm -rf Payload
)

ls -lh "$OUTPUT"
echo "✓ IPA ready: $OUTPUT"
