import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  {
    ignores: ['scripts/**', 
      '.remember/**',
      'out/**',
      'dist/**',
      'coverage/**',
      'node_modules/**',
      '*.config.*',
      'eslint.config.mjs',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      // Zustand store actions are read off the store object; they never use `this`.
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'child_process',
              importNames: ['exec', 'execSync'],
              message: 'Use execFile/spawn or runPowerShell (Security.md §5.2)',
            },
            {
              name: 'node:child_process',
              importNames: ['exec', 'execSync'],
              message: 'Use execFile/spawn or runPowerShell (Security.md §5.2)',
            },
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
          message: 'Not allowed (Security.md §7)',
        },
      ],
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    // Design-system.md §2: no raw hex colours in components; use tokens.
    files: ['src/renderer/**/*.tsx'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
          message: 'Not allowed (Security.md §7)',
        },
        {
          selector: 'Literal[value=/#[0-9a-fA-F]{3,8}\b/]',
          message: 'Use design tokens, not raw hex (Design-system.md §2)',
        },
      ],
    },
  },
  {
    files: ['**/*.test.ts', '**/*.test.tsx', 'tests/**/*.ts'],
    rules: {
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/require-await': 'off',
    },
  },
);
