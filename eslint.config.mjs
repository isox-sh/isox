import js from '@eslint/js'
import stylistic from '@stylistic/eslint-plugin'
import { defineConfig, globalIgnores } from 'eslint/config'
import simpleImportSort from 'eslint-plugin-simple-import-sort'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default defineConfig(
  globalIgnores(['**/dist/**', '**/build/**', '**/coverage/**', '**/.cache/**', '**/.isox/**', 'tmp/**']),
  {
    files: ['**/*.{js,cjs,mjs,ts,cts,mts}'],
    extends: [js.configs.recommended],
    languageOptions: { globals: globals.node },
    plugins: { '@stylistic': stylistic, 'simple-import-sort': simpleImportSort },
    rules: {
      'curly': ['error', 'all'],
      '@stylistic/brace-style': ['error', '1tbs', { allowSingleLine: false }],
      '@stylistic/semi': ['error', 'never'],
      'simple-import-sort/imports': ['error', {
        groups: [
          ['^\\u0000'], // Side effects, preserving their relative order.
          ['^node:'], // Node.js builtins.
          ['^@?\\w'], // Packages, including workspace packages.
          ['^'], // Other absolute imports and aliases.
          ['^\\.'], // Relative imports.
          ['^.+\\u0000$'], // All type imports; longest match wins over the groups above.
        ],
      }],
    },
  },
  {
    files: ['**/*.{ts,cts,mts}'],
    extends: [tseslint.configs.recommended],
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', {
        prefer: 'type-imports',
        fixStyle: 'separate-type-imports',
      }],
      '@stylistic/member-delimiter-style': ['error', {
        multiline: { delimiter: 'none' },
        singleline: { delimiter: 'comma', requireLast: false },
      }],
    },
  },
  {
    files: ['packages/core/src/executor/runner.ts'],
    rules: {
      // The executor loader resolves CommonJS plugins and manifests dynamically.
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
)
