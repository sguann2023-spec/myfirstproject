import { defineConfig } from 'vite';

export default defineConfig({
    test: {
        environment: 'node',
        include: ['src/shared/loginServicesReady.test.js']
    }
});
