import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        content: resolve(__dirname, 'content.js'),
        background: resolve(__dirname, 'background.ts')
      },
      output: {
        entryFileNames: '[name].js', // This keeps the names exactly as they are in the manifest
      }
    }
  }
})
