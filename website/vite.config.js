import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { visualizer } from 'rollup-plugin-visualizer'
import { copyFileSync } from 'fs'
import { resolve } from 'path'

// Enable bundle visualization with ANALYZE=true
const shouldAnalyze = process.env.ANALYZE === 'true';

const backendUrl = process.env.VITE_URL || 'http://localhost:8080';
const authProxyUrl = process.env.VITE_AUTH_PROXY_URL || 'http://localhost:4000';
let backendOrigin = '';
try {
  const url = new URL(backendUrl);
  backendOrigin = url.origin;
} catch (e) {
  console.warn('Invalid VITE_URL:', backendUrl);
}

export default defineConfig({
  esbuild: {
    drop: process.env.NODE_ENV === 'production' ? ['console', 'debugger'] : [],
  },
  plugins: [
    react(),
    {
      name: 'html-transform',
      transformIndexHtml(html) {
        // Replace placeholder preconnect URLs with actual backend URL
        html = html.replace(/https:\/\/api\.example\.com/g, backendOrigin);

        // Ensure fetchpriority is added to the main script
        html = html.replace(
          /<script type="module" crossorigin src="(\/assets\/index-[^"]+\.js)"><\/script>/,
          '<script type="module" crossorigin src="$1" fetchpriority="high"></script>'
        );

        return html;
      }
    },
    {
      name: 'copy-files',
      closeBundle() {
        // Copy preview.png to dist folder after build
        try {
          copyFileSync(
            resolve(__dirname, 'preview.png'),
            resolve(__dirname, 'dist', 'preview.png')
          );
          console.log('✓ Copied preview.png to dist');
        } catch (err) {
          console.warn('Warning: Could not copy preview.png:', err.message);
        }
      }
    },
    // US-145: Bundle analyzer - run with ANALYZE=true pnpm build
    shouldAnalyze && visualizer({
      filename: 'dist/bundle-stats.html',
      open: true,
      gzipSize: true,
      brotliSize: true,
      template: 'treemap'
    })
  ].filter(Boolean),
  // Note: VITE_IDENTITY and VITE_URL are automatically loaded from .env files
  // Don't use define here as it runs before .env is loaded
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: backendUrl,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
        ws: true
      },
      '/auth': {
        target: authProxyUrl,
        changeOrigin: true,
      },
      '/profile': {
        target: authProxyUrl,
        changeOrigin: true,
      },
      '/billing': {
        target: authProxyUrl,
        changeOrigin: true,
      }
    }
  },
  optimizeDeps: {
    exclude: ['./wasm/pkg/nullspace_wasm.js'],
    include: [
      '@nullspace/types',
      '@nullspace/constants',
      '@nullspace/protocol'
    ]
  },
  build: {
    modulePreload: {
      polyfill: true
    },
    rollupOptions: {
      output: {
        // US-145: Manual chunks to split large dependencies
        manualChunks: (id) => {
          // Split recharts (used by EconomyDashboard) into separate chunk
          if (id.includes('node_modules/recharts') ||
              id.includes('node_modules/d3-') ||
              id.includes('node_modules/victory-vendor')) {
            return 'vendor-charts';
          }
          // Split react ecosystem into vendor chunk
          if (id.includes('node_modules/react') ||
              id.includes('node_modules/react-dom') ||
              id.includes('node_modules/react-router') ||
              id.includes('node_modules/scheduler')) {
            return 'vendor-react';
          }
          // Split animation libraries
          if (id.includes('node_modules/@react-spring')) {
            return 'vendor-animation';
          }
          // Keep other node_modules in default vendor chunk
          if (id.includes('node_modules/')) {
            return 'vendor';
          }
        }
      }
    },
    // Increase warning threshold since we're actively splitting
    chunkSizeWarningLimit: 600
  }
})
