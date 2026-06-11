import { defineConfig } from 'vite';
import { resolve } from 'path';
import { cpSync, existsSync, mkdirSync } from 'fs';

// Build sonrası CSS klasörünü dist'e kopyalayan plugin
function copyStaticAssets() {
  return {
    name: 'copy-static-assets',
    closeBundle() {
      const distDir = resolve(__dirname, 'dist');

      // css/ klasörünü kopyala
      const cssSrc = resolve(__dirname, 'css');
      const cssDest = resolve(distDir, 'css');
      if (existsSync(cssSrc)) {
        if (!existsSync(cssDest)) mkdirSync(cssDest, { recursive: true });
        cpSync(cssSrc, cssDest, { recursive: true });
        console.log('  ✓ css/ → dist/css/ kopyalandı');
      }

      // renderer/assets/ klasörünü kopyala
      const rendererAssetsSrc = resolve(__dirname, 'assets');
      const rendererAssetsDest = resolve(distDir, 'assets_static');
      if (existsSync(rendererAssetsSrc)) {
        if (!existsSync(rendererAssetsDest)) mkdirSync(rendererAssetsDest, { recursive: true });
        cpSync(rendererAssetsSrc, rendererAssetsDest, { recursive: true });
        console.log('  ✓ renderer/assets/ → dist/assets_static/ kopyalandı');
      }
    }
  };
}

export default defineConfig({
  root: resolve(__dirname),
  base: './', // Electron file:// uyumlu göreceli yollar
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        login: resolve(__dirname, 'login.html'),
        chat: resolve(__dirname, 'chat.html'),
      },
    },
  },
  plugins: [copyStaticAssets()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@types': resolve(__dirname, 'src/types'),
    },
  },
});
