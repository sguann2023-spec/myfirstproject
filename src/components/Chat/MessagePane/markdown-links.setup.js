import { afterEach } from 'vitest';
import { cleanup } from './markdown-links.test-utils';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
afterEach(cleanup);
