#!/usr/bin/env bash
# CI: generate Capacitor iOS project even if ios/ contains only docs
set -euo pipefail

WORKSPACE="ios/App/App.xcworkspace/contents.xcworkspacedata"

if [ ! -f "$WORKSPACE" ]; then
  echo "→ Xcode project missing — generating with Capacitor..."
  BACKUP=$(mktemp -d)
  [ -f ios/ExportOptions.plist ] && cp ios/ExportOptions.plist "$BACKUP/"
  [ -f ios/README.md ] && cp ios/README.md "$BACKUP/"
  rm -rf ios
  npx cap add ios
  mkdir -p ios
  [ -f "$BACKUP/ExportOptions.plist" ] && cp "$BACKUP/ExportOptions.plist" ios/
  [ -f "$BACKUP/README.md" ] && cp "$BACKUP/README.md" ios/
  rm -rf "$BACKUP"
fi

echo "→ Syncing Capacitor..."
npx cap sync ios

echo "→ Installing CocoaPods..."
(cd ios/App && pod install)

echo "→ Applying iOS permissions..."
INFO_PLIST="ios/App/App/Info.plist"
if [ -f "$INFO_PLIST" ]; then
  /usr/libexec/PlistBuddy -c "Add :NSCameraUsageDescription string 'Take photos of products for AI analysis.'" "$INFO_PLIST" 2>/dev/null || \
  /usr/libexec/PlistBuddy -c "Set :NSCameraUsageDescription 'Take photos of products for AI analysis.'" "$INFO_PLIST"
  /usr/libexec/PlistBuddy -c "Add :NSPhotoLibraryUsageDescription string 'Select product photos from your library.'" "$INFO_PLIST" 2>/dev/null || \
  /usr/libexec/PlistBuddy -c "Set :NSPhotoLibraryUsageDescription 'Select product photos from your library.'" "$INFO_PLIST"
  /usr/libexec/PlistBuddy -c "Add :NSPhotoLibraryAddUsageDescription string 'Save scanned product images.'" "$INFO_PLIST" 2>/dev/null || \
  /usr/libexec/PlistBuddy -c "Set :NSPhotoLibraryAddUsageDescription 'Save scanned product images.'" "$INFO_PLIST"
  /usr/libexec/PlistBuddy -c "Add :NSMicrophoneUsageDescription string 'Live Translate needs microphone for real-time speech translation.'" "$INFO_PLIST" 2>/dev/null || \
  /usr/libexec/PlistBuddy -c "Set :NSMicrophoneUsageDescription 'Live Translate needs microphone for real-time speech translation.'" "$INFO_PLIST"
fi

if [ ! -f "$WORKSPACE" ]; then
  echo "::error::Failed to generate iOS Xcode workspace at $WORKSPACE"
  exit 1
fi

echo "✓ iOS project ready"
