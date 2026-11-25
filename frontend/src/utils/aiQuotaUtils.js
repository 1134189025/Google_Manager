/**
 * AI 订阅额度展示整理工具
 * - 将 Gemini / Google Cloud Code 返回的繁杂分模型配额收拢为清晰的
 *   「Gemini 模型」与「Claude 和 GPT 模型」双分组（周限额 + 5 小时限额），
 *   彻底过滤掉重复的 20+ 条分模型明细行。
 * - 统一计算剩余百分比与预警等级（normal / low / crit）。
 */

const clampPercent = (val) => Math.max(0, Math.min(100, val));

export function getQuotaRemainingPercent(win) {
    if (!win || typeof win.usedPercent !== 'number' || !Number.isFinite(win.usedPercent)) {
        return null;
    }
    return clampPercent(100 - win.usedPercent);
}

export function getQuotaLevel(remainingPercent) {
    if (remainingPercent == null) return 'normal';
    if (remainingPercent <= 10) return 'crit';
    if (remainingPercent <= 25) return 'low';
    return 'normal';
}

const isWeeklyWindow = (win) => {
    const text = `${win.model || ''} ${win.label || ''}`.toLowerCase();
    return (
        win.windowSeconds === 604800
        || text.includes('weekly')
        || text.includes('周额度')
        || text.includes('周限额')
        || text.includes('seven_day')
    );
};

const isFiveHourWindow = (win) => {
    const text = `${win.model || ''} ${win.label || ''}`.toLowerCase();
    return (
        win.windowSeconds === 18000
        || text.includes('5h')
        || text.includes('five_hour')
        || text.includes('5小时')
        || text.includes('5 小时')
    );
};

const isCreditWindow = (win) => {
    const model = String(win?.model || '').trim().toLowerCase();
    const label = String(win?.label || '').trim().toLowerCase();
    return label.startsWith('credits/') || model.startsWith('credits/');
};

const isSecondaryPool = (win) => {
    if (isCreditWindow(win)) return true;
    const text = `${win?.model || ''} ${win?.label || ''}`.toLowerCase();
    return text.includes('argon') || text.includes('carbon');
};

const isGeminiPool = (win) => {
    if (isSecondaryPool(win)) return false;
    const model = String(win.model || '').toLowerCase();
    const label = String(win.label || '').toLowerCase();
    return model.startsWith('gemini') || label.includes('gemini');
};

const isClaudeOrGptPool = (win) => {
    if (isSecondaryPool(win)) return false;
    const model = String(win.model || '').toLowerCase();
    const label = String(win.label || '').toLowerCase();
    return (
        model.startsWith('3p-')
        || model.startsWith('3p:')
        || model.startsWith('claude')
        || model.startsWith('gpt')
        || label.includes('claude')
        || label.includes('gpt')
    );
};

const toMetricItem = (key, label, win) => {
    const usedPercent = typeof win.usedPercent === 'number' && Number.isFinite(win.usedPercent)
        ? win.usedPercent
        : null;
    const remainingPercent = getQuotaRemainingPercent(win);
    return {
        key,
        label,
        usedPercent,
        remainingPercent,
        level: getQuotaLevel(remainingPercent),
        resetsAt: win.resetsAt || null,
        raw: win,
    };
};

const pickMostConstrained = (list) => {
    const valid = list.filter(w => typeof w.usedPercent === 'number' && Number.isFinite(w.usedPercent));
    if (valid.length === 0) return list[0] || null;
    return valid.reduce((worst, cur) => (cur.usedPercent > worst.usedPercent ? cur : worst), valid[0]);
};

/**
 * 构建 AI 订阅卡片额度展示模型
 * @returns {{ mode: 'grouped' | 'flat', groups: Array<{ id: string, title: string, items: Array }>, flatWindows: Array, credits: Array }}
 */
export function buildQuotaDisplayModel(usage, oauthProvider = '') {
    const windows = Array.isArray(usage?.windows) ? usage.windows : [];
    if (windows.length === 0) {
        return { mode: 'flat', groups: [], flatWindows: [], credits: [] };
    }

    const provider = String(oauthProvider || '').trim().toLowerCase();
    const source = String(usage?.source || '').trim().toLowerCase();
    const isExplicitOtherProvider = Boolean(provider) && provider !== 'gemini' && provider !== 'antigravity';
    const isGeminiLike = !isExplicitOtherProvider && (
        provider === 'gemini'
        || provider === 'antigravity'
        || source.includes('gemini')
        || source.includes('cloudcode')
        || source.includes('antigravity')
    );

    if (!isGeminiLike) {
        return { mode: 'flat', groups: [], flatWindows: windows, credits: [] };
    }

    const credits = windows.filter(isCreditWindow);
    const geminiWeekly = windows.find(w => isGeminiPool(w) && isWeeklyWindow(w));
    const gemini5h = windows.find(w => isGeminiPool(w) && isFiveHourWindow(w));
    const claudeWeekly = windows.find(w => isClaudeOrGptPool(w) && isWeeklyWindow(w));
    const claude5h = windows.find(w => isClaudeOrGptPool(w) && isFiveHourWindow(w));

    const groups = [];

    // 1. Gemini 模型分组（左：周限额，右：5 小时限额）
    const geminiItems = [];
    if (geminiWeekly) geminiItems.push(toMetricItem('gemini-weekly', '周限额', geminiWeekly));
    if (gemini5h) geminiItems.push(toMetricItem('gemini-5h', '5 小时限额', gemini5h));
    if (geminiItems.length === 0) {
        const fallbackGemini = pickMostConstrained(windows.filter(isGeminiPool));
        if (fallbackGemini) {
            geminiItems.push(toMetricItem('gemini-fallback', '当前限额', fallbackGemini));
        }
    }
    if (geminiItems.length > 0) {
        groups.push({ id: 'gemini', title: 'Gemini 模型', items: geminiItems });
    }

    // 2. Claude 和 GPT 模型分组（左：周限额，右：5 小时限额）
    const claudeItems = [];
    if (claudeWeekly) claudeItems.push(toMetricItem('claude-weekly', '周限额', claudeWeekly));
    if (claude5h) claudeItems.push(toMetricItem('claude-5h', '5 小时限额', claude5h));
    if (claudeItems.length === 0) {
        const fallbackClaude = pickMostConstrained(windows.filter(isClaudeOrGptPool));
        if (fallbackClaude) {
            claudeItems.push(toMetricItem('claude-fallback', '当前限额', fallbackClaude));
        }
    }
    if (claudeItems.length > 0) {
        groups.push({ id: 'claude-gpt', title: 'Claude 和 GPT 模型', items: claudeItems });
    }

    if (groups.length > 0) {
        return { mode: 'grouped', groups, flatWindows: [], credits };
    }

    return { mode: 'flat', groups: [], flatWindows: windows, credits: [] };
}
