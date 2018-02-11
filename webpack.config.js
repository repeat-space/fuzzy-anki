'use strict';

const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');

module.exports = {
  cache: true,
  entry: {
    app: path.resolve(`${__dirname}/src/index.js`)
  },
  devtool: 'cheap-module-source-map',
  output: {
    filename: '[name].bundle.js',
    sourceMapFilename: '[file].map',
    path: path.resolve(`${__dirname}/dist`),
    publicPath: '/'
  },
  resolve: {
    modules: ['node_modules']
  },
  plugins: [
    new CopyPlugin([{
      from: 'src/index.html'
    }])
  ],
  module: {
    rules: [
      // {
      //   test: /\.js$/,
      //   exclude: /(node_modules)/,
      //   loader: 'babel-loader?cacheDirectory=true'
      // },
      {
        test: /\.css$/,
        use: [ 'style-loader', 'css-loader' ]
      }
    ]
  }
};
