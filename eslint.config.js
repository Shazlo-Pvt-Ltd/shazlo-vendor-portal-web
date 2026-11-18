import js from '@eslint/js'
import tseslint from 'typescript-eslint'

// Shared by every app and package. Legacy app/ and backend/ are not linted here.
export default tseslint.config(
  { ignores: ['**/dist/**', '**/coverage/**', '**/reports/**', '**/.venv/**', '**/node_modules/**', 'app/**', 'backend/**', 'services/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // The vendor portal's security rules (apps/vendor-portal/README.md, "Security rules").
    files: ['apps/vendor-portal/src/**/*.{ts,tsx}'],
    ignores: ['**/*.test.{ts,tsx}', '**/test/**'],
    rules: {
      // A token, password or e-mail in web storage can be read by any script on the page. The
      // access token stays in memory; the refresh token is an HttpOnly cookie.
      'no-restricted-globals': [
        'error',
        ...['localStorage', 'sessionStorage', 'indexedDB'].map((name) => ({
          name,
          message: 'The portal must not use web storage: keep tokens in memory (see "Security rules" in the portal README).',
        })),
      ],
      'no-restricted-properties': [
        'error',
        ...['localStorage', 'sessionStorage', 'indexedDB'].flatMap((name) =>
          ['window', 'globalThis', 'self'].map((object) => ({
            object,
            property: name,
            message: 'The portal must not use web storage: keep tokens in memory (see "Security rules" in the portal README).',
          })),
        ),
      ],
      // Never render a string as HTML: a vendor typed it.
      'no-restricted-syntax': [
        'error',
        {
          selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
          message: 'dangerouslySetInnerHTML is forbidden: what a vendor typed must never be rendered as HTML.',
        },
        {
          selector: "Property[key.name='dangerouslySetInnerHTML']",
          message: 'dangerouslySetInnerHTML is forbidden: what a vendor typed must never be rendered as HTML.',
        },
        {
          selector: "AssignmentExpression[left.property.name=/^(innerHTML|outerHTML)$/]",
          message: 'Do not assign HTML: what a vendor typed must never be rendered as HTML.',
        },
        {
          selector: "MemberExpression[property.name='insertAdjacentHTML']",
          message: 'Do not insert HTML: what a vendor typed must never be rendered as HTML.',
        },
      ],
      // A log line is where tokens and passwords leak. Errors may be reported; nothing else.
      'no-console': ['error', { allow: ['error'] }],
      'no-eval': 'error',
      'no-implied-eval': 'off',
      'no-new-func': 'error',
    },
  },
  {
    files: ['apps/*/scripts/*.mjs'],
    languageOptions: { globals: { process: 'readonly', console: 'readonly', URL: 'readonly' } },
  },
  { files: ['test/**/*.js'], languageOptions: { globals: { structuredClone: 'readonly' } } },
)
