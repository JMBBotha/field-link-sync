import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.lovable.df34f666a26c422c892dea15ee719ae2',
  appName: 'field-link-sync',
  webDir: 'dist',
  server: {
    url: 'https://df34f666-a26c-422c-892d-ea15ee719ae2.lovableproject.com?forceHideBadge=true',
    cleartext: true
  },
  plugins: {
    Geolocation: {
      // iOS location usage descriptions are set in Info.plist
    }
  }
};

export default config;
