// @ts-check
import { defineConfig } from 'astro/config';

// Static output: the 2D sections ship as plain HTML and CSS, with no framework runtime. The only
// JavaScript on the page is the forest scene (three.js), split into its own chunk.
export default defineConfig({
  site: process.env.SITE_URL ?? 'https://www.aboveforest.com',
  base: process.env.SITE_BASE ?? '/',
  trailingSlash: 'ignore',
  build: { inlineStylesheets: 'auto' },
  prefetch: { prefetchAll: false, defaultStrategy: 'hover' },
  vite: {
    build: {
      // three.js is ~150 KB gzipped on its own: keep it out of the warning noise.
      chunkSizeWarningLimit: 900,
    },
  },
});
