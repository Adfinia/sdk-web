import { defineConfig } from 'tsup'

export default defineConfig([
  // ESM + CJS for npm consumers
  {
    entry: ['src/index.ts'],
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    clean: true,
    treeshake: true,
    minify: false,
    target: 'es2020',
    outDir: 'dist',
    outExtension: ({ format }) => ({ js: format === 'cjs' ? '.cjs' : '.js' }),
  },
  // IIFE for <script src="..."> consumers
  {
    entry: { adfinia: 'src/index.ts' },
    format: ['iife'],
    globalName: 'Adfinia',
    sourcemap: true,
    minify: true,
    // es2020 for BigInt support — covered by all targeted browsers in README.
    target: 'es2020',
    outDir: 'dist',
    outExtension: () => ({ js: '.iife.js' }),
    footer: {
      // Hoist the default export onto window.Adfinia for <script> users.
      js: 'if(typeof window!=="undefined"){window.Adfinia=Adfinia.default||Adfinia;}',
    },
  },
])
