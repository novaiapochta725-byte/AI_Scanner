#!/usr/bin/env bash
set -euo pipefail

SCHEME="${SCHEME:-App}"
WORKSPACE="${WORKSPACE:-ios/App/App.xcworkspace}"
ARCHIVE_PATH="${ARCHIVE_PATH:-build/App.xcarchive}"
EXPORT_PATH="${EXPORT_PATH:-build/ipa}"

if [ ! -f "$WORKSPACE/contents.xcworkspacedata" ]; then
  echo "Error: Xcode workspace not found at $WORKSPACE"
  exit 1
fi

echo "→ Syncing Capacitor..."
npx cap sync ios

echo "→ Archiving..."
xcodebuild archive \
  -workspace "$WORKSPACE" \
  -scheme "$SCHEME" \
  -configuration Release \
  -archivePath "$ARCHIVE_PATH" \
  -destination "generic/platform=iOS" \
  CODE_SIGN_STYLE=Manual \
  DEVELOPMENT_TEAM="${APPLE_TEAM_ID}" \
  PROVISIONING_PROFILE_SPECIFIER="${PROVISIONING_PROFILE_SPECIFIER}" \
  CODE_SIGN_IDENTITY="${CODE_SIGN_IDENTITY:-Apple Distribution}"

echo "→ Exporting IPA..."
xcodebuild -exportArchive \
  -archivePath "$ARCHIVE_PATH" \
  -exportPath "$EXPORT_PATH" \
  -exportOptionsPlist ios/ExportOptions.plist

echo "✓ IPA exported to $EXPORT_PATH"
