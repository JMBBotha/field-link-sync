import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.fieldlinksync.hvac',
  appName: 'Field Link Sync HVAC',
  webDir: 'dist',
  plugins: {
    Geolocation: {
      // iOS: NSLocationWhenInUseUsageDescription & NSLocationAlwaysUsageDescription in Info.plist
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
