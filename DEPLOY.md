# Field Link Sync HVAC — Mobile Deploy Guide

## Prerequisites

- **Node.js** ≥ 18 & npm
- **Xcode** ≥ 15 (macOS only, for iOS)
- **Android Studio** ≥ Hedgehog (for Android)
- Apple Developer account (for TestFlight)
- Google Play Console account (for internal testing)

## 1. Clone & Install

```bash
git clone <YOUR_GIT_URL>
cd field-link-sync
npm install
```

## 2. Add Native Platforms

```bash
npx cap add ios
npx cap add android
```

## 3. Build & Sync

```bash
npm run build
npx cap sync
```

Run `npx cap sync` after every `git pull` or code change.

## 4. Configure Native Permissions

### iOS — `ios/App/App/Info.plist`

Add these keys inside the top-level `<dict>`:

```xml
<key>NSLocationWhenInUseUsageDescription</key>
<string>We need your location to match you with nearby jobs.</string>
<key>NSLocationAlwaysAndWhenInUseUsageDescription</key>
<string>Background location keeps your position updated for dispatch.</string>
<key>NSCameraUsageDescription</key>
<string>Camera access is needed to photograph job sites.</string>
<key>NSPhotoLibraryUsageDescription</key>
<string>Photo library access lets you attach existing photos to jobs.</string>
```

### Android — `android/app/src/main/AndroidManifest.xml`

Add these permissions before `<application>`:

```xml
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_BACKGROUND_LOCATION" />
<uses-permission android:name="android.permission.CAMERA" />
<uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" />
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
<uses-permission android:name="android.permission.INTERNET" />
```

## 5. Generate App Icons & Splash Screens

```bash
npm install -g @capacitor/assets
npx capacitor-assets generate
```

Place source images in `assets/` folder:
- `icon-only.png` — 1024×1024 icon
- `icon-foreground.png` — 1024×1024 adaptive foreground
- `icon-background.png` — 1024×1024 adaptive background
- `splash.png` — 2732×2732 splash
- `splash-dark.png` — 2732×2732 dark mode splash

## 6. Run on Simulators

```bash
# iOS (requires Mac + Xcode)
npx cap run ios

# Android (requires Android Studio)
npx cap run android
```

## 7. Test Checklist

| Feature | Steps |
|---------|-------|
| **Offline job flow** | Enable airplane mode → accept lead → start timer → add photos → reconnect → verify sync |
| **WhatsApp triggers** | Complete a job → verify notification toast + WhatsApp message sent |
| **Photo uploads** | Take photo offline → reconnect → verify uploaded to storage |
| **Geolocation** | Grant permission → verify location pin on admin map |
| **Push notifications** | Create new lead in admin → verify push on agent device |
| **Sync conflicts** | Edit job on admin while agent offline → reconnect → verify conflict dialog |

## 8. Deploy to TestFlight (iOS)

1. Open `ios/App/App.xcworkspace` in Xcode
2. Set your Team in Signing & Capabilities
3. Set version/build number in General tab
4. Product → Archive
5. Distribute App → App Store Connect → Upload
6. In App Store Connect → TestFlight → add testers

## 9. Deploy to Google Play Internal Testing

1. Open `android/` folder in Android Studio
2. Build → Generate Signed Bundle (AAB)
3. Create a keystore if you don't have one
4. Upload AAB to Google Play Console → Internal testing track
5. Add tester email addresses → Start rollout

## 10. Production Build (Hot-Reload Disabled)

The `capacitor.config.ts` is already configured for production (no `server.url`). The app loads from the bundled `dist/` folder. For development with hot-reload, temporarily add:

```typescript
server: {
  url: 'https://df34f666-a26c-422c-892d-ea15ee719ae2.lovableproject.com?forceHideBadge=true',
  cleartext: true
},
```

Remove before releasing to stores.

## Recommended Build Scripts

Add to `package.json` scripts manually:

```json
{
  "build:mobile": "npm run build && npx cap sync",
  "build:ios": "npm run build && npx cap sync ios",
  "build:android": "npm run build && npx cap sync android",
  "run:ios": "npx cap run ios",
  "run:android": "npx cap run android"
}
```
