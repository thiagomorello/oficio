// GET /api/config (público, sem segredos) e /manifest.webmanifest gerados a partir da configuração da instância.
import { SUPPORTED_LOCALES, type PublicConfig } from '../../shared/branding';
import type { ServerConfig } from '../config';

export function publicConfig(config: Pick<ServerConfig, 'branding' | 'defaultLocale' | 'version'>): PublicConfig {
  return { ...config.branding, defaultLocale: config.defaultLocale, locales: SUPPORTED_LOCALES, version: config.version };
}

export interface WebManifest {
  name: string;
  short_name: string;
  start_url: string;
  display: string;
  theme_color: string;
  background_color: string;
  icons: { src: string; sizes: string; type: string; purpose?: string }[];
}

export function webManifest(config: Pick<ServerConfig, 'branding'>): WebManifest {
  const name = config.branding.appName;
  return {
    name,
    short_name: name.length <= 12 ? name : name.slice(0, 12).trimEnd(),
    start_url: '/',
    display: 'standalone',
    theme_color: '#121212',
    background_color: '#121212',
    icons: [
      { src: '/assets/brand/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/assets/brand/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/assets/brand/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
