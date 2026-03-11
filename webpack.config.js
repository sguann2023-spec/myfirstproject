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
          test: /\.(js|jsx)$/,
          exclude: /node_modules/,
          use: {
            loader: 'babel-loader',
            options: {
              presets: ['@babel/preset-env', '@babel/preset-react']
            }
          }
        },
        {
          test: /\.css$/,
          use: ['style-loader', 'css-loader']
        },
        {
          test: /\.(png|svg|jpg|jpeg|gif)$/i,
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
      extensions: ['.js', '.jsx']
    },
    target: 'electron-renderer'
  };
};