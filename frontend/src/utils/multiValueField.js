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

export const isMultilineField = (field) => field === 'groupName' || field === 'remark';

export const splitGroupNameValues = (value) => {
    const normalized = normalizeLineBreaks(value).trim();
    if (!normalized) return [];

    const rawItems = /[\n,，;；]/.test(normalized)
        ? normalized.split(/[\n,，;；]+/)
        : normalized.split(/\s+/);

    return dedupeLines(rawItems);
};

export const splitRemarkValues = (value) => {
    const normalized = normalizeLineBreaks(value).trim();
    if (!normalized) return [];
    return dedupeLines(normalized.split('\n'));
};

export const splitMultiValueLines = (field, value) => {
    if (field === 'groupName') return splitGroupNameValues(value);
    if (field === 'remark') return splitRemarkValues(value);

    const normalized = String(value ?? '').trim();
    return normalized ? [normalized] : [];
};

export const joinMultiValueLines = (items) => dedupeLines(items).join('\n');

export const normalizeMultiValueValue = (field, value) => {
    if (!isMultilineField(field)) {
        return String(value ?? '');
    }

    return joinMultiValueLines(splitMultiValueLines(field, value));
};

export const appendUniqueLine = (field, currentValue, nextValue) => {
    const candidate = String(nextValue ?? '').trim();
    if (!candidate) return normalizeMultiValueValue(field, currentValue);

    const existing = splitMultiValueLines(field, currentValue);
    return joinMultiValueLines([...existing, candidate]);
};
