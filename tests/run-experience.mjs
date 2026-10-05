import { registerHooks } from 'node:module';
import { resolve } from './three-loader.mjs';
registerHooks({ resolve });
const { checkExperience } = await import('./experience.js');
console.log(checkExperience().join('\n'));
console.log('ALL PASSED');
