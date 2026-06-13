#!/usr/bin/env bash
set -euo pipefail

echo "→ Syncing Capacitor iOS project..."
npx cap sync ios

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

echo "✓ iOS project ready. Open with: npx cap open ios"
