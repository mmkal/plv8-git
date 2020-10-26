const path = require('path')

/** @type {import('webpack').Configuration} */
module.exports = {
  entry: path.join(__dirname, './src/index.ts'),
  mode: 'none',
  output: {
    libraryTarget: 'commonjs2',
    path: path.resolve(__dirname, 'dist'),
    filename: 'bundle.js',
  },
  optimization: {
    minimize: false,
  },
  target: 'web',
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: [{loader: 'ts-loader', options: {transpileOnly: true}}],
        exclude: /node_modules/,
      },
      {
        test: /isomorphic-git/,
        use: [
          {
            loader: 'babel-loader',
            options: {
              babelrc: false,
              plugins: [
                // isomorphic git uses promises. but we want to avoid the event loop to allow using
                // filesystem operations that have synchronous fallbacks. Everything's done in memory
                // anyway, so no need for async operations.
                // This does _not_ allow doing things like cloning remote repos, but you'd never want to
                // do that in a database trigger anyway
                'babel-plugin-transform-async-to-promises',
              ],
            },
          },
        ],
      },
      {
        test: /async-lock/,
        use: [
          {
            loader: require.resolve('./scripts/async-lock-shim'),
          },
        ],
      },
    ],
  },
  resolve: {
    extensions: ['.tsx', '.ts', '.js'],
    fallback: {
      path: require.resolve('path-browserify'),
      stream: require.resolve('stream-browserify'),
      process: require.resolve('process/browser'),
    },
  },
}
