#!/usr/bin/env node
/**
 * 生成在线更新清单 latest.json（Tauri updater 的静态 JSON 格式）
 *
 * 用法：node scripts/make-latest-json.mjs <版本号> <发布说明.md> <发布文件目录> [下载地址前缀]
 *
 * 发布文件目录里需要有：
 * - Windows：GoogleManager_<版本号>_x64-setup.exe 与 .sig
 * - macOS：  GoogleManager_<版本号>_universal.app.tar.gz 与 .sig（通用二进制，Apple 芯片与 Intel 共用）
 * 某个平台缺文件时跳过该平台并给出警告；一个平台都没有时报错。
 *
 * 下载地址前缀默认是 GitHub Release 的下载地址：
 *   https://github.com/1134189025/Google_Manager/releases/download/v<版本号>
 * 本机模拟更新时可以传 http://127.0.0.1:<端口>。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO = '1134189025/Google_Manager';

export const buildLatestJson = ({ version, notes, dir, baseUrl, pubDate = new Date().toISOString() }) => {
    const prefix = (baseUrl || `https://github.com/${REPO}/releases/download/v${version}`).replace(/\/+$/, '');
    const entry = (fileName) => {
        const filePath = join(dir, fileName);
        const sigPath = `${filePath}.sig`;
        if (!existsSync(filePath) || !existsSync(sigPath)) {
            console.warn(`[latest.json] 缺少 ${fileName} 或其签名，跳过该平台`);
            return null;
        }
        return {
            signature: readFileSync(sigPath, 'utf8').trim(),
            url: `${prefix}/${encodeURIComponent(fileName)}`,
        };
    };

    const platforms = {};
    const windows = entry(`GoogleManager_${version}_x64-setup.exe`);
    if (windows) {
        platforms['windows-x86_64'] = windows;
        platforms['windows-x86_64-nsis'] = windows;
    }
    const mac = entry(`GoogleManager_${version}_universal.app.tar.gz`);
    if (mac) {
        platforms['darwin-aarch64'] = mac;
        platforms['darwin-x86_64'] = mac;
    }
    if (Object.keys(platforms).length === 0) {
        throw new Error(`目录 ${dir} 中没有任何带签名的更新包`);
    }

    return {
        version,
        notes: notes.trim(),
        pub_date: pubDate,
        platforms,
    };
};

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop());
if (isMain) {
    const [version, notesPath, dir, baseUrl] = process.argv.slice(2);
    if (!version || !notesPath || !dir) {
        console.error('用法：node scripts/make-latest-json.mjs <版本号> <发布说明.md> <发布文件目录> [下载地址前缀]');
        process.exit(2);
    }
    const latest = buildLatestJson({
        version,
        notes: readFileSync(notesPath, 'utf8'),
        dir,
        baseUrl,
    });
    const outPath = join(dir, 'latest.json');
    writeFileSync(outPath, `${JSON.stringify(latest, null, 2)}\n`);
    console.log(`[latest.json] 已生成 ${outPath}，平台：${Object.keys(latest.platforms).join(', ')}`);
}
