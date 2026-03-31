import type { CapacitorConfig } from '@capacitor/cli';

/** Set CAP_DEV=1 to enable live reload from local Vite server. */
const devServer =
  process.env.CAP_DEV === '1'
    ? {
        url: 'http://192.168.1.101:5173',
        cleartext: true,
      }
    : undefined;

const config: CapacitorConfig = {
  appId: 'com.kai.kit',
  appName: 'Kit',
  webDir: 'dist',
  ...(devServer && { server: devServer }),
};

export default config;
