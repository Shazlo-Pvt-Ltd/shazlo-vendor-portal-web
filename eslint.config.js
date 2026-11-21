import js from '@eslint/js'
import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'

// Shared by every app and package. Legacy app/ and backend/ are not linted here.
export default tseslint.config(
  { ignores: ['**/dist/**', '**/coverage/**', '**/reports/**', '**/.venv/**', '**/node_modules/**', 'app/**', 'backend/**', 'services/**', '.claude/**', '**/public/mockServiceWorker.js', '**/test-results/**', '**/playwright-report/**', '**/src/api/schema.d.ts'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { files: ['apps/**/*.tsx', 'packages/**/*.tsx'], ...reactHooks.configs.flat['recommended-latest'] },
  { rules: { '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' }] } },
  { files: ['test/**/*.js'], languageOptions: { globals: { structuredClone: 'readonly' } } },
  // #267: the shared pill's default words are the admin's. Seller screens use their own pill, which
  // names every status in the seller's words (apps/vendor-portal/src/copy/status.ts).
  {
    files: ['apps/vendor-portal/src/**/*.{ts,tsx}'],
    ignores: ['apps/vendor-portal/src/components/StatusPill.tsx', 'apps/vendor-portal/src/**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@shazlo/ui',
              importNames: ['StatusPill', 'statusPillLabel'],
              message: 'Use StatusPill from src/components/StatusPill, which shows the seller words for each status (#267).',
            },
          ],
          // Reaching into the package's source would get round the rule above.
          patterns: [{ group: ['@shazlo/ui/src', '@shazlo/ui/src/**', '**/packages/ui/src', '**/packages/ui/src/**'], message: 'Import from @shazlo/ui, not from its source files.' }],
        },
      ],
    },
  },
)
