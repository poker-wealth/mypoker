// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'jest.config.js'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // ignoreRestSiblings allows the redaction idiom `const { secret, ...safe } = obj` — the safest
      // way to strip private fields, since a newly-added secret can't leak by being forgotten.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/explicit-function-return-type': 'warn',
      'no-console': 'off',
    },
  },
  {
    // Tests don't need explicit return types (inline mocks, etc.).
    files: ['test/**/*.ts'],
    rules: { '@typescript-eslint/explicit-function-return-type': 'off' },
  },
  {
    // Browser frontend assets for the Mini App — plain JS with browser globals, not the TS build.
    files: ['scripts/app/**/*.js'],
    languageOptions: {
      globals: {
        window: 'readonly',
        document: 'readonly',
        fetch: 'readonly',
        setInterval: 'readonly',
        alert: 'readonly',
        encodeURIComponent: 'readonly',
      },
    },
    rules: { '@typescript-eslint/explicit-function-return-type': 'off' },
  },
);
