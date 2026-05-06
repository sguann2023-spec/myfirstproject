const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const WebpackObfuscator = require('webpack-obfuscator');
const { getI18nReservedStrings } = require('./config/obfuscation.i18n');

module.exports = (env, argv) => {
  const isProd = argv.mode === 'production';
  const enableObfuscation = isProd && process.env.OBFUSCATE !== '0';

  return {
    mode: isProd ? 'production' : 'development',
    devtool: isProd ? false : 'eval-source-map',
    entry: {
      main: './src/index.js',
      settings: './src/page/SettingPage/SettingPage.entry.jsx'
    },
    output: {
      path: path.resolve(__dirname, 'dist'),
      filename: '[name].bundle.js'
    },
    module: {
      rules: [
        {
          test: /\.(js|jsx|ts|tsx)$/,
          exclude: /node_modules/,
          use: {
            loader: 'babel-loader',
            options: {
              presets: [
                '@babel/preset-env',
                ['@babel/preset-react', { runtime: 'automatic' }],
                '@babel/preset-typescript'
              ]
            }
          }
        },
        {
          test: /\.css$/,
          use: ['style-loader', 'css-loader', 'postcss-loader']
        },
        {
          test: /\.(png|svg|jpg|jpeg|gif|webp)$/i,
          type: 'asset/resource'
        },
        {
          test: /\.(woff2?|ttf|eot|otf)$/i,
          type: 'asset/resource'
        }
      ]
    },
    plugins: [
      new HtmlWebpackPlugin({
        template: './public/index.html',
        filename: 'index.html',
        chunks: ['main']
      }),
      new HtmlWebpackPlugin({
        template: './public/settings.html',
        filename: 'settings.html',
        chunks: ['settings']
      }),
      new CopyWebpackPlugin({
        patterns: [
          {
            from: 'public',
            to: '.',
            globOptions: {
              ignore: ['**/index.html', '**/settings.html']
            }
          },
          { from: 'locales', to: 'locales' }
        ]
      }),
      ...(enableObfuscation
        ? [
            new WebpackObfuscator({
              compact: true,
              identifierNamesGenerator: 'hexadecimal',
              renameGlobals: false,
              ignoreRequireImports: true,
              stringArray: true,
              stringArrayThreshold: 0.6,
              splitStrings: false,
              transformObjectKeys: false,
              reservedStrings: getI18nReservedStrings()
            })
          ]
        : [])
    ],
    resolve: {
      extensions: ['.js', '.jsx', '.ts', '.tsx'],
      alias: {
        '@renderer': path.resolve(__dirname, 'src/renderer/src'),
        '@shared': path.resolve(__dirname, 'src/packages/shared'),
        '@logger': path.resolve(__dirname, 'src/shared/logger'),
        '@cherrystudio/ai-core/built-in/plugins': path.resolve(
          __dirname,
          'src/packages/aiCore/src/core/plugins/built-in/index.ts'
        ),
        '@cherrystudio/ai-core/provider': path.resolve(__dirname, 'src/packages/aiCore/src/core/providers/index.ts'),
        '@cherrystudio/ai-core/core/plugins': path.resolve(__dirname, 'src/packages/aiCore/src/core/plugins/index.ts'),
        '@cherrystudio/ai-core': path.resolve(__dirname, 'src/packages/aiCore/src'),
        '@cherrystudio/ai-sdk-provider': path.resolve(__dirname, 'src/packages/ai-sdk-provider/src'),
        '@mcp-trace/trace-core': path.resolve(__dirname, 'src/packages/mcp-trace/trace-core/index.ts'),
        '@mcp-trace/trace-web': path.resolve(__dirname, 'src/packages/mcp-trace/trace-web/index.ts'),
        '@types': path.resolve(__dirname, 'src/renderer/src/types'),
        '@renderer/store$': path.resolve(__dirname, 'src/components/Chat/MessagePane/RendererCompat/storeShim.js'),
        '@renderer/store/messageBlock$': path.resolve(
          __dirname,
          'src/components/Chat/MessagePane/RendererCompat/messageBlockShim.js'
        ),
        '@renderer/hooks/useSettings$': path.resolve(
          __dirname,
          'src/components/Chat/MessagePane/RendererCompat/useSettingsShim.js'
        )
      }
    },
    target: 'electron-renderer'
  };
};
