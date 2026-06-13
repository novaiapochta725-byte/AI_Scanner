import { initPlatformApi } from './lib/platform-api.js';
import { initApp } from './app.js';

(async () => {
  await initPlatformApi();
  await initApp();
})();
