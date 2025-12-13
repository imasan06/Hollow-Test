import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.hollow.watch',
  appName: 'Hollow 0W',
  webDir: 'dist',
  // Remove server.url for production - the app will use the bundled dist folder
  // Uncomment during development for hot reload:
  // server: {
  //   url: 'https://942eacd4-4982-4b3c-9275-f06e79963b08.lovableproject.com?forceHideBadge=true',
  //   cleartext: true
  // },
  plugins: {
    BluetoothLe: {
      displayStrings: {
        scanning: 'Scanning for Hollow watch...',
        cancel: 'Cancel',
        availableDevices: 'Available Devices',
        noDeviceFound: 'No watch found'
      }
    }
  }
};

export default config;
