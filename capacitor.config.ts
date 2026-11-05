import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.fieldlinksync.hvac',
  appName: 'Field Lynk',
  webDir: 'dist',
  plugins: {
    Geolocation: {
      // Android background sharing is @capgo/background-geolocation (foreground service).
      // iOS Always permission is Phase B and is not wired here.
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
    Camera: {
      // iOS: NSCameraUsageDescription & NSPhotoLibraryUsageDescription in Info.plist
    },
  },
};

export default config;
