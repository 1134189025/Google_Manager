/**
 * Chrome / Edge 浏览器密码 CSV 解析、冲突分类与导出序列化
 */

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_ROWS = 10000;

export function parseBrowserPasswordsCsv(input) {
    if (typeof input !== 'string') {
        throw new Error('CSV 内容无效');
    }
    const byteLen = new TextEncoder().encode(input).byteLength;
    if (byteLen > MAX_BYTES) {
        throw new Error('CSV 大小不能超过 10 MiB');
    }
    const text = input.replace(/^\ufeff/, '');
    const rows = [];
    let row = [];
    let field = '';
    let quoted = false;
    let closed = false;

    const finishField = () => {
        row.push(field);
        if (row.length > 32) {
            throw new Error('CSV 字段数量过多');
        }
        field = '';
        closed = false;
    };

    const finishRow = () => {
        finishField();
        if (row.some(v => v !== '')) {
            rows.push(row);
        }
        if (rows.length > MAX_ROWS + 1) {
            throw new Error('CSV 最多支持 10000 条记录');
        }
        row = [];
    };

    for (let i = 0; i < text.length; i += 1) {
        const ch = text[i];
        if (quoted) {
            if (ch === '"') {
                if (text[i + 1] === '"') {
                    field += '"';
                    i += 1;
                } else {
                    quoted = false;
                    closed = true;
                }
            } else {
                field += ch;
            }
            continue;
        }
        if (ch === ',') {
            finishField();
        } else if (ch === '\r' || ch === '\n') {
            finishRow();
            if (ch === '\r' && text[i + 1] === '\n') i += 1;
        } else if (ch === '"' && !field && !closed) {
            quoted = true;
        } else {
            if (closed || charIsQuote(ch)) {
                throw new Error('CSV 引号格式无效');
            }
            field += ch;
        }
    }

    if (quoted) throw new Error('CSV 引号未闭合');
    if (field || row.length || closed) finishRow();

    const headers = rows.shift()?.map(v => v.trim().toLowerCase());
    if (
        !headers ||
        new Set(headers).size !== headers.length ||
        !['url', 'username', 'password'].every(col => headers.includes(col))
    ) {
        throw new Error('CSV 必须包含 url、username、password 字段，请使用 Chrome 或 Edge 导出的密码文件');
    }

    const parsed = [];
    for (const values of rows) {
        if (values.length !== headers.length) continue;
        const rec = Object.fromEntries(headers.map((h, idx) => [h, values[idx]]));
        const url = String(rec.url ?? '').trim();
        const username = String(rec.username ?? '').trim();
        const password = String(rec.password ?? '');
        const rawTitle = String(rec.name ?? rec.title ?? '').trim();
        let hostFallback = url;
        try {
            hostFallback = new URL(url).hostname || url;
        } catch {
            // 非完整 URL 保留原值
        }
        const name = rawTitle || hostFallback || username || '未命名账号';
        parsed.push({
            name,
            url,
            username,
            password,
            notes: String(rec.note ?? rec.notes ?? '').trim(),
        });
    }
    return parsed;
}

function charIsQuote(ch) {
    return ch === '"';
}

function normalizeSiteKey(url) {
    const trimmed = String(url ?? '').trim().toLowerCase();
    try {
        const u = new URL(trimmed);
        return `${u.origin}${u.pathname.replace(/\/+$/, '')}`;
    } catch {
        return trimmed.replace(/\/+$/, '');
    }
}

/**
 * 与现有密钥库比对分类：new（新建）、duplicate（完全重复跳过）、conflict（同站点同用户名但密码不同）
 */
export function classifyCsvImportRows(parsedRows, existingItems = []) {
    return parsedRows.map((row, index) => {
        const keyUrl = normalizeSiteKey(row.url);
        const keyUser = String(row.username ?? '').trim().toLowerCase();
        const matches = existingItems.filter(
            item =>
                normalizeSiteKey(item.url) === keyUrl &&
                String(item.username ?? '').trim().toLowerCase() === keyUser,
        );
        if (matches.length === 0) {
            return { ...row, rowIndex: index, status: 'new', selected: true };
        }
        const exact = matches.some(m => (m.secretValue ?? '') === row.password);
        if (exact) {
            return { ...row, rowIndex: index, status: 'duplicate', selected: false };
        }
        return { ...row, rowIndex: index, status: 'conflict', selected: true };
    });
}

function escapeCsvCell(value) {
    let str = String(value ?? '');
    if (/^[=+\-@\t\r]/.test(str)) {
        str = `'${str}`;
    }
    if (/[",\r\n]/.test(str)) {
        return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
}

export function exportVaultItemsToBrowserCsv(items = []) {
    const header = 'name,url,username,password,note';
    const lines = [header];
    for (const item of items) {
        if (!item) continue;
        if (item.kind && item.kind !== 'account' && item.kind !== 'password') continue;
        lines.push([
            escapeCsvCell(item.name || ''),
            escapeCsvCell(item.url || ''),
            escapeCsvCell(item.username || ''),
            escapeCsvCell(item.secretValue || ''),
            escapeCsvCell(item.notes || ''),
        ].join(','));
    }
    return `${lines.join('\r\n')}\r\n`;
}
