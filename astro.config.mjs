import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

const base = process.env.PUBLIC_BASE_PATH || '/';

export default defineConfig({
  site: process.env.PUBLIC_SITE_URL || 'https://stickitoutdrums.com',
  base,
  devToolbar: { enabled: false },
  redirects: {
    '/membership.html': '/membership/',
    '/membership-checkout.html': '/membership/checkout/',
    '/membership-welcome.html': '/membership/welcome/',
    '/free-lesson.html': '/free-lesson/',
    '/lessons.html': '/lessons/',
    '/challenges.html': '/challenges/',
    '/account.html': '/account/',
    '/portal.html': '/portal/',
    '/payment.html': '/payment/',
    '/unlock.html': '/unlock/',
    '/brand.html': '/brand-lab.html',
  },
  build: {
    assets: 'assets',
  },
  vite: {
    plugins: [tailwindcss()],
    build: {
      rollupOptions: {
        output: {
          assetFileNames: 'assets/app-[hash][extname]',
          chunkFileNames: 'assets/ch-[hash].js',
          entryFileNames: 'assets/en-[hash].js',
        },
      },
    },
  },
});
