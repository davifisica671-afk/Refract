import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { version } from './package.json'

process.env.VITE_APP_VERSION = version;

export default defineConfig({
    plugins: [react()],
    base: './',
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "./src"),
            "@hooks": path.resolve(__dirname, "./src/hooks"),
            "@config": path.resolve(__dirname, "./src/config"),
        },
    },
    optimizeDeps: {
        entries: [path.resolve(__dirname, 'index.html')],
    },
    server: {
        port: 5180,
        watch: {
            ignored: [
                '**/.claude/worktrees/**',
                '**/.code-review-graph/**',
                '**/dist-electron/**',
                '**/release/**',
                '**/natively-browser/**',
            ],
        },
    },
    build: {
        chunkSizeWarningLimit: 1000,
        rollupOptions: {
            input: path.resolve(__dirname, 'index.html'),
            output: {
                manualChunks: {
                    vendor: ['react', 'react-dom', 'framer-motion'],
                    ui: ['lucide-react', '@radix-ui/react-dialog', '@radix-ui/react-toast']
                }
            }
        }
    }
})
