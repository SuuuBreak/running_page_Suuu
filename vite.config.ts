import process from 'node:process';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import viteTsconfigPaths from 'vite-tsconfig-paths';
import svgr from 'vite-plugin-svgr';
import tailwindcss from '@tailwindcss/vite';
import routeElevationPlugin from './scripts/route-elevation.mjs';

// The following are known larger packages or packages that can be loaded asynchronously.
const individuallyPackages = [
  'activities',
  'github.svg',
  'grid.svg',
  'mol.svg',
];
const basePath = process.env.PATH_PREFIX || '/';

const colorClassMapping: { [key: string]: string } = {
  // Background
  '#1a1a1a': 'svg-color-bg',
  '#222': 'svg-color-bg',
  '#444': 'svg-color-inactive-cell',
  '#4dd2ff': 'svg-color-active-cell',
  // Primary Text
  '#fff': 'svg-color-text',
  '#e1ed5e': 'svg-color-text',
};

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    routeElevationPlugin(),
    {
      name: 'archive-pages-entries',
      enforce: 'post',
      apply: 'build',
      generateBundle: {
        order: 'post',
        handler(_options, bundle) {
          const entry = bundle['index.html'];
          if (entry?.type !== 'asset') return;
          // GitHub Pages serves directory indexes without an SPA rewrite.
          for (const route of ['map', 'summary', 'atlas']) {
            this.emitFile({
              type: 'asset',
              fileName: `${route}/index.html`,
              source: entry.source,
            });
          }
        },
      },
    },
    react(),
    tailwindcss(),
    viteTsconfigPaths(),
    svgr({
      include: ['**/*.svg'],
      svgrOptions: {
        exportType: 'named',
        namedExport: 'ReactComponent',
        plugins: ['@svgr/plugin-svgo', '@svgr/plugin-jsx'],
        svgoConfig: {
          floatPrecision: 2,
          plugins: [
            {
              name: 'preset-default',
              params: {
                overrides: {
                  removeTitle: false,
                  removeViewBox: false,
                },
              },
            },
            {
              name: 'addClassesByFillColor',
              fn: () => {
                return {
                  element: {
                    enter: (node) => {
                      const fillColor = node.attributes.fill;
                      if (fillColor) {
                        const lowerCaseFill = fillColor.toLowerCase();
                        if (colorClassMapping[lowerCaseFill]) {
                          node.attributes.class =
                            colorClassMapping[lowerCaseFill];
                        }
                      }
                      const strokeColor = node.attributes.stroke;
                      if (strokeColor) {
                        const lowerCaseStroke = strokeColor.toLowerCase();
                        if (colorClassMapping[lowerCaseStroke]) {
                          // If class already exists, append, otherwise set.
                          const existingClass = node.attributes.class || '';
                          const newClass = colorClassMapping[lowerCaseStroke];
                          if (!existingClass.includes(newClass)) {
                            node.attributes.class =
                              `${existingClass} ${newClass}`.trim();
                          }
                        }
                      }
                    },
                  },
                };
              },
            },
          ],
        },
      },
    }),
  ],
  base: basePath.endsWith('/') ? basePath : `${basePath}/`,
  define: {
    'import.meta.env.VERCEL': JSON.stringify(process.env.VERCEL),
  },
  build: {
    manifest: true,
    outDir: './dist', // for user easy to use, vercel use default dir -> dist
    rollupOptions: {
      output: {
        manualChunks: (id: string) => {
          if (id.includes('node_modules')) {
            if (id.includes('@surbowl/world-geo-json-zh'))
              return 'world-geography';
            if (id.includes('mapbox-gl') || id.includes('react-map-gl'))
              return 'map-engine';
            if (
              id.includes('recharts') ||
              id.includes('/d3-') ||
              id.includes('/victory-')
            )
              return 'chart-engine';
            return 'vendors';
            // If there will be more and more external packages referenced in the future,
            // the following approach can be considered.
            // const name = id.split('node_modules/')[1].split('/');
            // return name[0] == '.pnpm' ? name[1] : name[0];
          } else {
            for (const item of individuallyPackages) {
              if (id.includes(item)) {
                return item;
              }
            }
          }
        },
      },
    },
  },
});
