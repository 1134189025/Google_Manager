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

// 开发服务器只给本机的 Tauri 窗口用：默认只监听回环地址，不对局域网暴露
const frontendHost = process.env.GOOGLE_MANAGER_FRONTEND_HOST || '127.0.0.1'
const frontendPort = Number(process.env.GOOGLE_MANAGER_FRONTEND_PORT || '5173')
const basePath = normalizeBasePath(process.env.GOOGLE_MANAGER_BASE_PATH || '/')
const buildOutDir = process.env.GOOGLE_MANAGER_FRONTEND_BUILD_DIR
    ? path.resolve(process.env.GOOGLE_MANAGER_FRONTEND_BUILD_DIR)
    : path.resolve(__dirname, '../static')
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

// https://vitejs.dev/config/
export default defineConfig({
    plugins: [react()],
    base: basePath,
    define: {
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
        ...(hmrConfig ? { hmr: hmrConfig } : {}),
    },
    preview: {
        host: frontendHost,
        port: frontendPort,
        strictPort: true,
    },
})
