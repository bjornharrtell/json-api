import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'

// https://vite.dev/config/
export default defineConfig({
  plugins: [dts({ rollupTypes: true, tsconfigPath: './tsconfig.app.json' })],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  esbuild: {
    supported: {
      decorators: false,
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    minify: true,
    lib: {
      entry: resolve(__dirname, 'src/lib.ts'),
      formats: ['es'],
      fileName: 'lib',
    },
    rollupOptions: {
      external: ['ky'],
    },
  },
})
