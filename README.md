# AI Product Scanner

Identify products from photos using **Google Gemini Vision API**.

Available as:
- **iOS app** (iPhone 12 → 17 Pro Max) — Capacitor
- **Desktop app** (Windows) — Electron

## iOS (primary)

### UI

- Mobile-first layout with safe areas (notch, Dynamic Island, home indicator)
- Bottom tab bar (Scan / History / Settings)
- Fluid typography scaled for 390px–440px screens
- Native camera & photo picker on iOS

### Local setup (macOS required)

```bash
npm install
npm run ios:setup    # build + cap add ios + sync
npx cap open ios     # open Xcode
```

### GitHub Actions → IPA

Workflow: `.github/workflows/ios.yml`

**Required GitHub Secrets:**

| Secret | Description |
|--------|-------------|
| `APPLE_TEAM_ID` | Apple Developer Team ID |
| `BUILD_CERTIFICATE_BASE64` | Distribution .p12 (base64) |
| `P12_PASSWORD` | Certificate password |
| `KEYCHAIN_PASSWORD` | Temp keychain password |
| `PROVISIONING_PROFILE_BASE64` | App Store profile (base64) |
| `PROVISIONING_PROFILE_SPECIFIER` | Profile name |
| `CODE_SIGN_IDENTITY` | e.g. `Apple Distribution` |

Push to `main` or run workflow manually. IPA artifact: `AIProductScanner-ipa`.

Update `ios/ExportOptions.plist` with your Team ID and profile name.

### Bundle ID

`com.aiproductscanner.app` — change in `capacitor.config.json` if needed.

## Desktop (Windows)

```bash
npm install
npm start
```

## Web dev server

```bash
npm run dev
```

## Build web only

```bash
npm run build
```

Output: `dist/`

## Project structure

```
src/
  index.html       — iPhone-optimized UI
  styles.css       — safe areas, fluid type, bottom tabs
  app.js           — app logic
  main.js          — entry point
  lib/
    gemini.js      — Gemini API client
    storage.js     — local storage (Preferences on iOS)
    platform-api.js — Capacitor / Electron bridge
capacitor.config.json
ios/ExportOptions.plist
scripts/setup-ios.sh
scripts/build-ios.sh
.github/workflows/ios.yml
fastlane/Fastfile
electron/          — Windows desktop (optional)
```

## License

MIT
