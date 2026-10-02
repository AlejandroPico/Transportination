import { cp, mkdir } from 'node:fs/promises';
await mkdir(new URL('../vendor/satellite/', import.meta.url), { recursive: true });
await cp(new URL('../node_modules/satellite.js/dist/', import.meta.url), new URL('../vendor/satellite/', import.meta.url), { recursive: true });
await cp(new URL('../node_modules/satellite.js/LICENSE.md', import.meta.url), new URL('../vendor/satellite/LICENSE.md', import.meta.url)).catch(() => {});
console.log('Satellite.js 7.1.0 prepared for browser workers');
