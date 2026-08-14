import { defineConfig, rspack } from '@rsbuild/core'
import { pluginReact } from '@rsbuild/plugin-react'
import { pluginTailwindcss } from '@rsbuild/plugin-tailwindcss'

const apiTarget = process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:3000'

export default defineConfig({
  plugins: [pluginReact(), pluginTailwindcss()],
  tools: {
    // React-PDF's browser build still references the Node Buffer global when
    // resolving image sources. Provide the browser implementation at bundle
    // time instead of leaking a global into the application runtime.
    rspack: {
      plugins: [
        new rspack.ProvidePlugin({
          Buffer: ['buffer', 'Buffer'],
        }),
      ],
    },
  },
  source: {
    entry: {
      index: './src/main.tsx',
    },
  },
  html: {
    template: './index.html',
  },
  server: {
    // Force IPv4 on Windows; `localhost` may resolve to ::1 and fail with EACCES.
    host: '127.0.0.1',
    port: 5174,
    strictPort: true,
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
      },
      '/uploads': {
        target: apiTarget,
        changeOrigin: true,
      },
    },
  },
})
