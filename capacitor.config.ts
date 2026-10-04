import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.tumeni.app',
  appName: 'Tumeni',
  webDir: 'dist',
  bundledWebRuntime: false,
  server: {
    url: 'https://tumeni.vercel.app',
    androidScheme: 'https',
  },
};

export default config;
