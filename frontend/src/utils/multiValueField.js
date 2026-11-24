const normalizeLineBreaks = (value) => String(value ?? '').replace(/\r\n?/g, '\n');

const dedupeLines = (items) => {
    const seen = new Set();
    const result = [];

    for (const item of items) {
        const normalized = String(item ?? '').trim();
        if (!normalized || seen.has(normalized)) continue;
        seen.add(normalized);
        result.push(normalized);
    }

    return result;
};

export const UNCATEGORIZED_FILTER_KEY = '__uncategorized__';

export const CATEGORY_COLORS = [
    {
        id: 'blue', label: '钴蓝', dot: '#5b8ef4',
        bg: 'rgba(91, 142, 244, 0.14)', border: 'rgba(91, 142, 244, 0.38)', text: '#6b9cff',
        lightBg: 'rgba(37, 99, 235, 0.10)', lightBorder: 'rgba(37, 99, 235, 0.34)', lightText: '#1d4ed8',
    },
    {
        id: 'emerald', label: '翠绿', dot: '#34d399',
        bg: 'rgba(52, 211, 153, 0.14)', border: 'rgba(52, 211, 153, 0.36)', text: '#34d399',
        lightBg: 'rgba(5, 150, 105, 0.10)', lightBorder: 'rgba(5, 150, 105, 0.34)', lightText: '#047857',
    },
    {
        id: 'amber', label: '琥珀', dot: '#f59e0b',
        bg: 'rgba(245, 158, 11, 0.14)', border: 'rgba(245, 158, 11, 0.38)', text: '#fbbf24',
        lightBg: 'rgba(217, 119, 6, 0.11)', lightBorder: 'rgba(217, 119, 6, 0.36)', lightText: '#b45309',
    },
    {
        id: 'rose', label: '玫红', dot: '#f43f5e',
        bg: 'rgba(244, 63, 94, 0.14)', border: 'rgba(244, 63, 94, 0.38)', text: '#fb7185',
        lightBg: 'rgba(225, 29, 72, 0.10)', lightBorder: 'rgba(225, 29, 72, 0.34)', lightText: '#be123c',
    },
    {
        id: 'violet', label: '紫罗兰', dot: '#a78bfa',
        bg: 'rgba(167, 139, 250, 0.15)', border: 'rgba(167, 139, 250, 0.38)', text: '#b89eff',
        lightBg: 'rgba(124, 58, 237, 0.10)', lightBorder: 'rgba(124, 58, 237, 0.34)', lightText: '#6d28d9',
    },
    {
        id: 'cyan', label: '青蓝', dot: '#22d3ee',
        bg: 'rgba(34, 211, 238, 0.14)', border: 'rgba(34, 211, 238, 0.36)', text: '#22d3ee',
        lightBg: 'rgba(8, 145, 178, 0.10)', lightBorder: 'rgba(8, 145, 178, 0.34)', lightText: '#0e7490',
    },
    {
        id: 'orange', label: '暖橙', dot: '#fb923c',
        bg: 'rgba(251, 146, 60, 0.14)', border: 'rgba(251, 146, 60, 0.38)', text: '#fb923c',
        lightBg: 'rgba(234, 88, 12, 0.10)', lightBorder: 'rgba(234, 88, 12, 0.34)', lightText: '#c2410c',
    },
    {
        id: 'slate', label: '石墨', dot: '#94a3b8',
        bg: 'rgba(148, 163, 184, 0.14)', border: 'rgba(148, 163, 184, 0.35)', text: '#94a3b8',
        lightBg: 'rgba(71, 85, 105, 0.10)', lightBorder: 'rgba(71, 85, 105, 0.32)', lightText: '#334155',
    },
];

export const getCategoryColorMeta = (colorId) => {
    const base = CATEGORY_COLORS.find(c => c.id === colorId) || CATEGORY_COLORS[0];
    const isLight = typeof document !== 'undefined' && document.documentElement?.dataset?.theme === 'light';
    if (!isLight) return base;
    return {
        ...base,
        bg: base.lightBg || base.bg,
        border: base.lightBorder || base.border,
        text: base.lightText || base.text,
    };
};

export const isMultilineField = (field) => field === 'groupName' || field === 'remark';

export const splitDelimitedGroupNames = (value) => {
    const normalized = normalizeLineBreaks(value).trim();
    if (!normalized) return [];
    return dedupeLines(normalized.split(/[\n,，;；]+/));
};

export const splitGroupNameValues = (value, knownCategories = null) => {
    const normalized = normalizeLineBreaks(value).trim();
    if (!normalized) return [];

    if (/[\n,，;；]/.test(normalized)) {
        return dedupeLines(normalized.split(/[\n,，;；]+/));
    }

    if (knownCategories) {
        const knownList = Array.isArray(knownCategories)
            ? knownCategories
            : Array.from(knownCategories);
        const normalizedLower = normalized.toLowerCase();
        if (knownList.some(item => String(item ?? '').trim().toLowerCase() === normalizedLower)) {
            return [normalized];
        }
    }

    return dedupeLines(normalized.split(/\s+/));
};

export const splitRemarkValues = (value) => {
    const normalized = normalizeLineBreaks(value).trim();
    if (!normalized) return [];
    return dedupeLines(normalized.split('\n'));
};

export const splitMultiValueLines = (field, value, knownCategories = null) => {
    if (field === 'groupName') return splitGroupNameValues(value, knownCategories);
    if (field === 'remark') return splitRemarkValues(value);

    const normalized = String(value ?? '').trim();
    return normalized ? [normalized] : [];
};

export const joinMultiValueLines = (items) => dedupeLines(items).join('\n');

export const normalizeMultiValueValue = (field, value, knownCategories = null) => {
    if (!isMultilineField(field)) {
        return String(value ?? '');
    }

    return joinMultiValueLines(splitMultiValueLines(field, value, knownCategories));
};

export const appendUniqueLine = (field, currentValue, nextValue, knownCategories = null) => {
    const candidate = String(nextValue ?? '').trim();
    if (!candidate) return normalizeMultiValueValue(field, currentValue, knownCategories);

    const existing = splitMultiValueLines(field, currentValue, knownCategories);
    return joinMultiValueLines([...existing, candidate]);
};
