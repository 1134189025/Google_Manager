import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'child_process'
import path from 'path'

const normalizeBasePath = (value) => {
    if (!value || value === '/') {
        return '/'
    }

    const withLeadingSlash = value.startsWith('/') ? value : `/${value}`
    return withLeadingSlash.endsWith('/') ? withLeadingSlash : `${withLeadingSlash}/`
}

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const resolveGitCommit = () => {
    if (process.env.GOOGLE_MANAGER_GIT_SHA) {
        return process.env.GOOGLE_MANAGER_GIT_SHA
    }

    try {
        return execSync('git rev-parse --short HEAD', {
            cwd: __dirname,
            stdio: ['ignore', 'pipe', 'ignore'],
            timeout: 1500,
        }).toString().trim()
    } catch {
        return ''
    }
}

const frontendHost = process.env.GOOGLE_MANAGER_FRONTEND_HOST || '0.0.0.0'
const frontendPort = Number(process.env.GOOGLE_MANAGER_FRONTEND_PORT || '5173')
const apiTarget = process.env.GOOGLE_MANAGER_API_TARGET || 'http://127.0.0.1:3001'
const basePath = normalizeBasePath(process.env.GOOGLE_MANAGER_BASE_PATH || '/')
const apiBasePath = process.env.VITE_API_URL || (basePath === '/' ? '/api' : `${basePath.slice(0, -1)}/api`)
const buildOutDir = process.env.GOOGLE_MANAGER_FRONTEND_BUILD_DIR
    ? path.resolve(process.env.GOOGLE_MANAGER_FRONTEND_BUILD_DIR)
    : path.resolve(__dirname, '../static')
const allowedHosts = true
const hmrHost = process.env.GOOGLE_MANAGER_HMR_HOST
const hmrProtocol = process.env.GOOGLE_MANAGER_HMR_PROTOCOL || 'wss'
const hmrClientPort = Number(process.env.GOOGLE_MANAGER_HMR_CLIENT_PORT || '443')
const hmrPath = process.env.GOOGLE_MANAGER_HMR_PATH || basePath
const appVersion = process.env.GOOGLE_MANAGER_APP_VERSION || process.env.npm_package_version || 'dev'
const appBuildTime = process.env.GOOGLE_MANAGER_BUILD_TIME || new Date().toISOString()
const appCommitSha = resolveGitCommit()

const hmrConfig = hmrHost
    ? {
        protocol: hmrProtocol,
        host: hmrHost,
        clientPort: hmrClientPort,
        path: hmrPath,
    }
    : undefined

const proxy = {
    '/api': {
        target: apiTarget,
        changeOrigin: true,
    },
}

if (apiBasePath !== '/api') {
    proxy[apiBasePath] = {
        target: apiTarget,
        changeOrigin: true,
        rewrite: (requestPath) => requestPath.replace(new RegExp(`^${escapeRegex(apiBasePath)}`), '/api'),
    }
}

// https://vitejs.dev/config/
export default defineConfig({
    plugins: [react()],
    base: basePath,
    define: {
        'import.meta.env.VITE_API_URL': JSON.stringify(apiBasePath),
        __APP_VERSION__: JSON.stringify(appVersion),
        __APP_BUILD_TIME__: JSON.stringify(appBuildTime),
        __APP_COMMIT_SHA__: JSON.stringify(appCommitSha),
    },
    build: {
        outDir: buildOutDir,
        emptyOutDir: true,
    },
    server: {
        host: frontendHost,
        port: frontendPort,
        strictPort: true,
        allowedHosts,
        ...(hmrConfig ? { hmr: hmrConfig } : {}),
        proxy,
    },
    preview: {
        host: frontendHost,
        port: frontendPort,
        strictPort: true,
        allowedHosts,
    },
})
