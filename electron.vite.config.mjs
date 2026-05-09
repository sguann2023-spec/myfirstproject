import react from '@vitejs/plugin-react-swc'
import { defineConfig } from 'electron-vite'
import { resolve } from 'node:path'
import { transformWithEsbuild } from 'vite'
import pkg from './package.json' with { type: 'json' }

const isDev = process.env.NODE_ENV === 'development'

export default defineConfig({
  main: {
    resolve: {
      alias: {
        '@main': resolve('src/main'),
        '@types': resolve('src/renderer/src/types'),
        '@shared': resolve('src/packages/shared'),
        '@logger': resolve('src/main/services/LoggerService'),
        '@mcp-trace/trace-core': resolve('src/packages/mcp-trace/trace-core'),
        '@mcp-trace/trace-node': resolve('src/packages/mcp-trace/trace-node')
      }
    },
    build: {
      sourcemap: isDev,
      rollupOptions: {
        input: resolve('src/main/index.ts'),
        external: ['electron', ...Object.keys(pkg.dependencies)],
        output: {
          entryFileNames: 'index.js'
        },
        onwarn(warning, warn) {
          if (warning.code === 'COMMONJS_VARIABLE_IN_ESM') return
          warn(warning)
        }
      }
    }
  },
  preload: {
    resolve: {
      alias: {
        '@shared': resolve('src/packages/shared'),
        '@mcp-trace/trace-core': resolve('src/packages/mcp-trace/trace-core')
      }
    },
    build: {
      sourcemap: isDev
    }
  },
  renderer: {
    plugins: [
      {
        name: 'legacy-jsx-in-src',
        enforce: 'pre',
        async transform(code, id) {
          const normalized = id.split('?')[0]
          if (!/(\/src\/components\/.+\.js$|\/src\/page\/.+\.js$|\/src\/index\.js$)/.test(normalized)) return null
          return transformWithEsbuild(code, normalized, {
            loader: 'jsx',
            jsx: 'automatic'
          })
        }
      },
      react()
    ],
    optimizeDeps: {
      esbuildOptions: {
        loader: {
          '.js': 'jsx'
        }
      }
    },
    worker: {
      format: 'es'
    },
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/packages/shared'),
        '@types': resolve('src/renderer/src/types'),
        '@logger': resolve('src/renderer/src/services/LoggerService'),
        '@mcp-trace/trace-core': resolve('src/packages/mcp-trace/trace-core'),
        '@mcp-trace/trace-web': resolve('src/packages/mcp-trace/trace-web'),
        '@cherrystudio/ai-core/provider': resolve('src/packages/aiCore/src/core/providers/index.ts'),
        '@cherrystudio/ai-core/built-in/plugins': resolve('src/packages/aiCore/src/core/plugins/built-in/index.ts'),
        '@cherrystudio/ai-core/core/plugins': resolve('src/packages/aiCore/src/core/plugins/index.ts'),
        '@cherrystudio/ai-core': resolve('src/packages/aiCore/src'),
        '@cherrystudio/ai-sdk-provider': resolve('src/packages/ai-sdk-provider/src'),
        '@cherrystudio/extension-table-plus': resolve('src/packages/extension-table-plus/src')
      }
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/renderer/index.html'),
          miniWindow: resolve('src/renderer/miniWindow.html'),
          selectionToolbar: resolve('src/renderer/selectionToolbar.html'),
          selectionAction: resolve('src/renderer/selectionAction.html'),
          traceWindow: resolve('src/renderer/traceWindow.html')
        },
        onwarn(warning, warn) {
          if (warning.code === 'COMMONJS_VARIABLE_IN_ESM') return
          warn(warning)
        }
      }
    }
  }
})
