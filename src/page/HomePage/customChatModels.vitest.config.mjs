import { mergeConfig } from 'vitest/config';
import composerConfig from '../../components/Chat/Composer/vitest.config.mjs';

// Keep the shared jsdom/JSX setup without inheriting Composer's unrelated suites.
const baseConfig = { ...composerConfig, test: { ...composerConfig.test, include: [] } };
export default mergeConfig(baseConfig, {
  test: {
    include: [
      'src/page/SettingPage/SettingPage.test.jsx',
      'src/page/HomePage/settingsNavigation.test.js',
      'src/page/HomePage/chatProviders.test.js',
      'src/page/HomePage/useCustomChatModels.test.js',
      'src/page/HomePage/useChatModelPreference.test.js',
      'src/page/HomePage/useModelThinkingLevels.test.js',
    ],
  },
});
