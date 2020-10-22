module.exports = {
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2018,
    sourceType: 'module',
  },
  ignorePatterns: [
    // break
    'index.cjs',
    '**/node_modules/**',
    '**/dist/**',
    '**/generated/**',
  ],
  plugins: [
    // break
    'prettier',
    'codegen',
  ],
  rules: {
    'prettier/prettier': ['warn', require('./.prettierrc')],
    'codegen/codegen': 'error',
  },
}
