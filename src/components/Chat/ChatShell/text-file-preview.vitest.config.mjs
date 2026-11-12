import base from '../Composer/LocalFilePreviewList/vitest.config.mjs';

export default {
  ...base,
  test: {
    environment: 'jsdom',
    include: ['src/components/Chat/ChatShell/TextFilePreview.test.jsx'],
  },
};
