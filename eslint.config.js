import js from '@eslint/js'
import globals from 'globals'
import svelte from 'eslint-plugin-svelte'
import svelteParser from 'svelte-eslint-parser'
import tseslint from 'typescript-eslint'

// The extension is the only surface that runs inside a page it does not
// control. Its rules are stricter than the rest of the repository because a
// mistake here leaks a credential to a hostile site rather than to a log file.

export default tseslint.config(
  {
    ignores: ['node_modules/**', 'dist/**', 'test-results/**', 'public/**', 'manifests/**'],
  },

  js.configs.recommended,

  {
    rules: {
      // See the matching note in the root eslint.config.js.
      'prefer-const': ['error', { ignoreReadBeforeAssign: true }],
      'no-useless-assignment': 'off',
    },
  },

  {
    files: ['src/**/*.ts'],
    extends: [tseslint.configs.recommended],
    languageOptions: {
      globals: { ...globals.browser, ...globals.webextensions, chrome: 'readonly' },
    },
    rules: {
      'no-console': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],

      'no-restricted-globals': [
        'error',
        { name: 'localStorage', message: 'Page-origin storage is shared with the page. Use chrome.storage for preferences only.' },
        { name: 'sessionStorage', message: 'Page-origin storage is shared with the page. Use chrome.storage for preferences only.' },
      ],

      'no-restricted-syntax': [
        'error',
        { selector: "MemberExpression[property.name='innerHTML']", message: 'Build nodes instead. The page is hostile.' },
        { selector: "MemberExpression[property.name='outerHTML']", message: 'Build nodes instead. The page is hostile.' },
        { selector: "MemberExpression[property.name='insertAdjacentHTML']", message: 'Build nodes instead. The page is hostile.' },
        { selector: "NewExpression[callee.name='Function']", message: 'No runtime code construction.' },
      ],
      'no-eval': 'error',
      'no-implied-eval': 'error',

      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { regex: '^(\\.\\./)+(src|website|admin|backend)/', message: 'Do not import another surface.' },
          ],
        },
      ],
    },
  },

  {
    files: ['**/*.svelte'],
    extends: [tseslint.configs.base, svelte.configs.recommended],
    languageOptions: {
      parser: svelteParser,
      parserOptions: { parser: tseslint.parser, extraFileExtensions: ['.svelte'] },
      globals: { ...globals.browser, ...globals.webextensions, chrome: 'readonly' },
    },
    rules: {
      'no-console': 'error',
      'no-undef': 'off',
      'no-unused-vars': 'off',
      'no-useless-assignment': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'svelte/no-at-html-tags': 'error',
      'svelte/no-target-blank': 'error',
      'svelte/require-each-key': 'warn',
      'svelte/prefer-svelte-reactivity': 'warn',
    },
  },

  {
    files: ['tests/**/*.ts', 'tests/**/*.mjs', '*.config.ts', 'vite.*.config.ts', 'scripts/**/*.mjs'],
    extends: [tseslint.configs.recommended],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser, ...globals.webextensions, chrome: 'readonly' },
    },
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
)
