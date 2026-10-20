import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Set CAP_DEV_URL to opt into live reload, for example:
 * CAP_DEV_URL=http://192.168.1.42:5173 npm run sync:ios
 */
function getDevServer(): CapacitorConfig['server'] | undefined {
  const rawUrl = process.env.CAP_DEV_URL?.trim();
  if (!rawUrl) return undefined;

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('CAP_DEV_URL must be a valid http:// or https:// URL.');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('CAP_DEV_URL must use http:// or https://.');
  }

  return {
    url: url.toString().replace(/\/$/, ''),
    cleartext: url.protocol === 'http:',
  };
}

const devServer = getDevServer();

const config: CapacitorConfig = {
  appId: 'com.kai.kit',
  appName: 'Kit',
  webDir: 'dist',
  ...(devServer && { server: devServer }),
};

export default config;
