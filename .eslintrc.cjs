/** @type {import('eslint').Linter.Config} */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
  ],
  env: {
    node: true,
    es2021: true,
  },
  ignorePatterns: [
    'dist',
    'build',
    'node_modules',
    '.turbo',
    'coverage',
    '*.config.js',
    '*.config.cjs',
  ],
  rules: {
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/no-unused-vars': [
      'warn',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],
    'no-console': 'off',
  },
  overrides: [
    {
      files: ['apps/web/**/*.{ts,tsx}'],
      env: { browser: true },
      plugins: ['react-hooks', 'react-refresh'],
      extends: ['plugin:react-hooks/recommended'],
      rules: {
        'react-refresh/only-export-components': [
          'warn',
          { allowConstantExport: true },
        ],
      },
    },
    {
      files: ['apps/api-gateway/**/*.ts'],
      extends: ['prettier'],
      plugins: ['prettier'],
      rules: {
        'prettier/prettier': 'warn',
      },
    },
    {
      files: ['apps/mobile/**/*.{ts,tsx,js,jsx}'],
      env: { es6: true },
    },
  ],
};
