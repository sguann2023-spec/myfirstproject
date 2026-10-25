import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/components/Chat/Composer/skillExample.test.js'],
  },
});
