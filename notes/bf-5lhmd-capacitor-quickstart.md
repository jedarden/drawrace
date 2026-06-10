# Capacitor Quick Start for DrawRace

**Bead ID:** bf-5lhmd  
**Purpose:** Step-by-step implementation guide when ready to proceed

---

## Prerequisites

```bash
# Verify you have the required tools
node --version  # Should be v18+ 
npm --version   # Should be v9+
java -version   # Required for Android builds
# Install Android Studio if not present
# Install Xcode on Mac if building for iOS
```

---

## 15-Minute Setup Process

### Step 1: Install Dependencies (2 minutes)

```bash
cd /home/coding/drawrace/apps/web
npm install --save-dev @capacitor/core @capacitor/cli @capacitor/android @capacitor/ios
```

### Step 2: Initialize Capacitor (1 minute)

```bash
npx cap init DrawRace "com.drawrace.app" --web-dir=dist
```

This creates `capacitor.config.ts`:
```typescript
import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.drawrace.app',
  appName: 'DrawRace',
  webDir: 'dist',
  server: {
    cleartext: true,
    androidScheme: 'https'
  },
  ios: {
    contentInset: 'manual'
  },
  android: {
    captureInput: true
  }
};

export default config;
```

### Step 3: Build the PWA (3 minutes)

```bash
cd /home/coding/drawrace/apps/web
npm run build
```

This produces the `dist/` directory that Capacitor will wrap.

### Step 4: Add Platforms (1 minute)

```bash
npx cap add android
npx cap add ios
```

This creates `android/` and `ios/` native project directories.

### Step 5: Sync Content (1 minute)

```bash
npx cap sync
```

This copies your `dist/` files into the native projects.

### Step 6: Test in Emulator (5 minutes)

```bash
# Android
npx cap open android
# In Android Studio: Run → Run 'app' on emulator

# iOS (Mac only)
npx cap open ios  
# In Xcode: Product → Run on simulator
```

### Step 7: Build Production APK/IPA (2 minutes)

```bash
# Sync latest changes
npm run build
npx cap sync

# Android: Build APK in Android Studio
# Build → Generate Signed Bundle / APK → APK

# iOS: Archive in Xcode  
# Product → Archive → Distribute App
```

---

## Configuration Files Created

### `capacitor.config.ts`
Main Capacitor configuration

### `android/`
Android Studio project with Gradle build system

### `ios/`
Xcode project with native iOS configuration

---

## Testing Commands

```bash
# Run PWA tests (should still pass)
npm run test

# Sync and test on Android
npm run build && npx cap sync
npx cap run android

# Open for debugging
npx cap open android  # Open Android Studio
npx cap open ios      # Open Xcode
```

---

## Troubleshooting

### "dist/ directory not found"
```bash
# Build the PWA first
npm run build
```

### "Android SDK not found"
```bash
# Install Android Studio and set ANDROID_HOME
export ANDROID_HOME=$HOME/Android/Sdk
```

### "Xcode not found" (iOS builds require Mac)
```bash
# iOS builds can only be done on macOS with Xcode installed
# For Linux-only development, focus on Android first
```

---

## Next Steps After Setup

1. Test on real devices
2. Verify physics determinism
3. Configure app icons and splash screens
4. Set up app store accounts
5. Submit for review

---

## Useful Commands

```bash
npx cap --help              # Show all Capacitor commands
npx cap copy                # Just copy web files (faster than sync)
npx cap check               # Check for common issues
npx cap version             # Show installed versions
```

---

**Time to working native build:** ~15 minutes
**Time to app store submission:** ~3-4 weeks (including testing)
