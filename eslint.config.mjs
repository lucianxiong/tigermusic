import js from '@eslint/js';
import globals from 'globals';
import appGlobals from './tools/app-globals.json' with { type: 'json' };

export default [
  {
    ignores: [
      'node_modules/**', 'dist/**', 'android/**', 'ios/**', '.agent/**',
      'tools/audits/**', 'tools/**/*.txt', 'tools/**/*.png',
      'app/**/*.png', 'app/**/*.ico',
      /* 本地开发产物：旧版备份与自检截图（已被 .gitignore 排除，非交付物） */
      'app/_backup/**', 'app/_shots/**',
      /* 本地自动化 / 临时产物 */
      '.trash/**', 'browser/**'
    ]
  },
  js.configs.recommended,
  {
    files: ['app/js/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'script',
      globals: { ...globals.browser, ...globals.webextensions, ...appGlobals }
    },
    rules: {
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_' }],
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-control-regex': 'off',
      'no-useless-escape': 'warn',
      'no-irregular-whitespace': 'warn',
      'no-misleading-character-class': 'off',
      'no-inner-declarations': 'warn',
      'no-func-assign': 'warn',
      'no-redeclare': 'off',
      'no-prototype-builtins': 'off'
    }
  },
  {
    files: ['app/sw.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'script',
      globals: { ...globals.serviceworker }
    }
  },
  {
    /* 纯逻辑工具：浏览器 / Node 双端可用（UMD 导出守卫，供单元测试 require） */
    files: ['app/js/music-utils.js', 'app/js/audio-fx.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'script',
      globals: { ...globals.browser, ...appGlobals, module: 'readonly' }
    }
  },
  {
    files: ['electron/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: { ...globals.node }
    },
    rules: {
      'no-unused-vars': ['warn', { args: 'none' }],
      'no-empty': ['warn', { allowEmptyCatch: true }]
    }
  },
  {
    files: ['tools/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: { ...globals.node }
    },
    rules: {
      'no-unused-vars': ['warn', { args: 'none' }],
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-console': 'off'
    }
  }
];
