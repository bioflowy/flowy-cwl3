'use strict';

/** @type {import('eslint').Linter.BaseConfig} */
module.exports = {
  root: true,
  extends: ['@mizdra/mizdra', '@mizdra/mizdra/+node', '@mizdra/mizdra/+prettier'],
  parserOptions: {
    ecmaVersion: 2022,
  },
  env: {
    es2022: true,
    node: true,
  },
  overrides: [
    {
      files: ['*.ts', '*.tsx', '*.cts', '*.mts'],
      extends: ['@mizdra/mizdra/+typescript', '@mizdra/mizdra/+prettier'],
    },
  ],
  rules: {
    // ... 既存のルール
    '@typescript-eslint/no-unused-vars': 'warn',
    '@typescript-eslint/naming-convention': 'warn',
    '@typescript-eslint/restrict-template-expressions': 'warn',
    'eqeqeq': 'warn',
    'no-param-reassign': 'warn',
    '@typescript-eslint/naming-convention': 'warn',
    '@typescript-eslint/naming-convention': 'warn',
    'default-param-last': 'warn',
    'max-params': 'warn',
    '@typescript-eslint/no-unused-vars': 'warn',
    '@typescript-eslint/no-useless-constructor': 'warn',
    'no-useless-catch': 'warn',
    '@typescript-eslint/restrict-template-expressions': 'warn',
    '@typescript-eslint/restrict-plus-operands': 'warn',
  },
};
