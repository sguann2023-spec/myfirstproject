const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin'); // 取消这行的注释

module.exports = {
  mode: 'development',
  entry: {
    main: './src/index.js', // 主应用入口
    settings: './src/page/SettingPage/SettingPage.entry.jsx' // 新的设置页入口文件
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
        type: 'asset/resource',
      }
    ]
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: './public/index.html',
      filename: 'index.html', // 输出到 dist/index.html
      chunks: ['main'] // 只引用 main.bundle.js
    }),
    new HtmlWebpackPlugin({
      template: './public/settings.html', // 使用新的 settings.html 模板
      filename: 'settings.html', // 输出到 dist/settings.html
      chunks: ['settings'] // 只引用 settings.bundle.js
    }),
    // 注释掉或删除下面的 CopyWebpackPlugin 配置
    // 在CopyWebpackPlugin配置中添加
    new CopyWebpackPlugin({
      patterns: [
        { 
          from: 'public', 
          to: '.', 
          globOptions: { 
            // 忽略 index.html 和 settings.html 模板
            ignore: ['**/index.html', '**/settings.html'] 
          } 
        },
        { from: 'locales', to: 'locales' }
      ]
    })
  ],
  resolve: {
    extensions: ['.js', '.jsx']
  },
  target: 'electron-renderer'
};