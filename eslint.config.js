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
)
