import { resolveConfig } from 'electron-vite';
import { build } from 'vite';

process.env.NODE_ENV_ELECTRON_VITE = 'production';
const resolved = await resolveConfig({}, 'build', 'production');
if (!resolved.config?.renderer) throw new Error('Missing renderer config');
await build(resolved.config.renderer);
