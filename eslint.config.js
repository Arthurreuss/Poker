// @ts-check
import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/node_modules/', '**/dist/', '**/coverage/', '.claude/'] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: [
            '*.js',
            '*.ts',
            'scripts/*.mjs',
            'scripts/test/*.mjs',
            'apps/web/vite.config.ts',
            'apps/web/vitest.config.ts',
            'apps/server/build.mjs',
          ],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['apps/web/src/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
  },
  // --- Engine-Reinheit (WP-008): keine I/O, keine Uhr, kein unkontrollierter Zufall ---
  // Ausnahme: crypto-rng.ts (einziger Node-Import, Produktions-Zufall). Tests dürfen Node nutzen.
  {
    files: ['packages/engine/src/**/*.ts'],
    ignores: ['packages/engine/src/crypto-rng.ts', 'packages/engine/src/**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex:
                '^(node:|(fs|path|os|crypto|child_process|net|http|https|http2|dns|tls|dgram|url|util|stream|events|worker_threads|cluster|process|timers|perf_hooks|readline|vm|zlib|buffer)(/|$))',
              message: 'Engine bleibt frei von I/O und Node-APIs (nur crypto-rng.ts darf Node importieren).',
            },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        ...[
          'Date',
          'process',
          'performance',
          'setTimeout',
          'setInterval',
          'setImmediate',
          'clearTimeout',
          'clearInterval',
          'queueMicrotask',
          'fetch',
          'crypto',
          'require',
          'Buffer',
          'WebSocket',
          'XMLHttpRequest',
          'localStorage',
          'sessionStorage',
          'console',
        ].map((name) => ({
          name,
          message: 'Engine ist rein: keine Uhr, kein I/O, kein globaler Zufall (Zeit/Rng als Parameter).',
        })),
      ],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'Zufall nur über injiziertes Rng.' },
        { object: 'globalThis', message: 'Kein Zugriff auf globale Objekte über globalThis.' },
      ],
      'no-restricted-syntax': [
        'error',
        { selector: 'ImportExpression', message: 'Keine dynamischen Imports in der Engine.' },
      ],
    },
  },
  {
    files: ['apps/web/src/**/*.{ts,tsx}'],
    ...reactHooks.configs.flat.recommended,
  },
  {
    files: ['**/*.js', '**/*.mjs'],
    ...tseslint.configs.disableTypeChecked,
    // languageOptions zusammenführen, sonst gehen die parserOptions von disableTypeChecked verloren.
    languageOptions: { ...tseslint.configs.disableTypeChecked.languageOptions, globals: globals.node },
  },
);
