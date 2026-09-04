import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'release/**', 'coverage/**', 'node_modules/**', 'test-results/**', 'playwright-report/**', 'output/playwright/**'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: { globals: { process: 'readonly' } }
  },
  {
    files: ['userscript/**/*.user.js'],
    languageOptions: {
      globals: {
        window: 'readonly',
        document: 'readonly',
        URL: 'readonly',
        location: 'readonly',
        Request: 'readonly',
        TextDecoder: 'readonly',
        sessionStorage: 'readonly'
      }
    }
  },
  {
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }]
    }
  }
);
