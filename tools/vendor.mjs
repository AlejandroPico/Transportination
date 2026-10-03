import { cp, mkdir } from 'node:fs/promises';
await mkdir(new URL('../vendor/satellite/', import.meta.url), { recursive: true });
await cp(new URL('../node_modules/satellite.js/dist/', import.meta.url), new URL('../vendor/satellite/', import.meta.url), { recursive: true });
await cp(new URL('../node_modules/satellite.js/LICENSE.md', import.meta.url), new URL('../vendor/satellite/LICENSE.md', import.meta.url)).catch(() => {});
console.log('Satellite.js 7.1.0 prepared for browser workers');
await mkdir(new URL('../vendor/mqtt/', import.meta.url), { recursive: true });
for (const name of ['paho-mqtt-min.js', 'edl-v10', 'epl-v10', 'about.html']) await cp(new URL('../node_modules/paho-mqtt/' + name, import.meta.url), new URL('../vendor/mqtt/' + name, import.meta.url));
console.log('Eclipse Paho MQTT 1.1.0 prepared with its license notices');
