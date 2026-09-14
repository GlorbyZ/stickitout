import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: 'https://stickitoutbook.com',
  output: 'server',
  adapter: cloudflare({
    imageService: 'passthrough',
    prerenderEnvironment: 'node',
  }),
  integrations: [
    sitemap({
      filter: (page) =>
        !page.includes('/api/') &&
        !page.includes('/portal') &&
        !page.includes('/free-lesson/watch') &&
        !page.includes('/book/thanks') &&
        !page.includes('/login'),
    }),
  ],
  redirects: {
    '/membership.html': '/',
    '/membership': '/',
    '/payment.html': '/book',
    '/payment': '/book',
    '/unlock.html': '/book/thanks',
    '/unlock': '/book/thanks',
    '/membership-checkout.html': '/join',
    '/membership-welcome.html': '/join',
    '/account.html': '/login',
    '/account': '/login',
    '/portal.html': '/portal',
  },
  vite: {
    plugins: [tailwindcss()],
  },
});
