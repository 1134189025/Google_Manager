#!/usr/bin/env node
/**
 * 打包脚本（`pnpm run build`）
 *
 * 开启在线更新后，打包会额外生成更新包，并要求用私钥签名：
 * - 环境变量已有 TAURI_SIGNING_PRIVATE_KEY（例如 CI）时直接使用；
 * - 否则读取本机 ~/.tauri/googlemanager.key 与同目录的 .password 文件；
 * - 都没有时跳过更新包，只打普通安装包（并给出提示），不会因缺少私钥而失败。
 *
 * 额外参数原样传给 `tauri build`，例如：pnpm run build -- --target universal-apple-darwin
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const env = { ...process.env };
const extraArgs = process.argv.slice(2).filter((arg) => arg !== '--');
const tauriArgs = ['exec', 'tauri', 'build', ...extraArgs];

if (!env.TAURI_SIGNING_PRIVATE_KEY) {
    const keyPath = join(homedir(), '.tauri', 'googlemanager.key');
    const passwordPath = `${keyPath}.password`;
    if (existsSync(keyPath)) {
        env.TAURI_SIGNING_PRIVATE_KEY = readFileSync(keyPath, 'utf8').trim();
        if (!env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD && existsSync(passwordPath)) {
            env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD = readFileSync(passwordPath, 'utf8').trim();
        }
        console.log(`[build] 使用本机更新签名私钥 ${keyPath}`);
    } else if (env.CI) {
        console.error('[build] CI 中缺少更新签名私钥：请在仓库 Settings → Secrets 配置 TAURI_SIGNING_PRIVATE_KEY 与 TAURI_SIGNING_PRIVATE_KEY_PASSWORD');
        process.exit(1);
    } else {
        console.warn('[build] 未找到更新签名私钥，跳过生成更新包（只打普通安装包）');
        tauriArgs.push('--config', JSON.stringify({ bundle: { createUpdaterArtifacts: false } }));
    }
}

const result = spawnSync('pnpm', tauriArgs, { stdio: 'inherit', env, shell: process.platform === 'win32' });
process.exit(result.status ?? 1);
