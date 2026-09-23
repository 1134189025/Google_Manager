import { useState, useRef, useEffect, useMemo } from 'react';
import { normalizePhoneNumber } from '../utils/phoneUtils';
import { extractPhoneAndSmsUrl, normalizeSmsUrlInput } from '../utils/smsUtils';
import {
    appendUniqueLine,
    isMultilineField,
    normalizeMultiValueValue,
} from '../utils/multiValueField';

export const CLICK_COPY_DELAY_MS = 320;

const focusEditableField = (element, multiline = false) => {
    // 编辑框可能已卸载（例如微任务执行前编辑被取消），此时无需聚焦
    if (!element) return;

    try {
        element.focus({ preventScroll: true });
    } catch {
        element.focus();
    }

    if (typeof element.setSelectionRange !== 'function') return;

    if (multiline) {
        const length = String(element.value || '').length;
        element.setSelectionRange(length, length);
        return;
    }

    element.select();
};

const useInlineEdit = ({ onInlineEdit, onInlineEditMany, getAccount, allGroups, recentValuesByField = {} }) => {
    const [editingCell, setEditingCell] = useState(null);
    const [editValue, setEditValue] = useState('');
    const inputRef = useRef(null);
    const [showSuggestions, setShowSuggestions] = useState(false);
    const isSelectingSuggestionRef = useRef(false);
    const clickTimerRef = useRef(null);

    const getSuggestionsForField = (field) => {
        if (!field) return [];
        const recent = recentValuesByField[field] || [];
        if (recent.length > 0) return recent.slice(0, 5);
        if (field === 'groupName' && Array.isArray(allGroups)) return allGroups.slice(0, 5);
        return [];
    };

    const activeField = editingCell?.field || 'groupName';
    const activeSuggestions = useMemo(
        () => getSuggestionsForField(activeField),
        [activeField, allGroups, recentValuesByField]
    );

    const filteredSuggestions = useMemo(() => {
        const keyword = String(editValue || '').trim().toLowerCase();
        if (!keyword) return activeSuggestions.slice(0, 5);
        return activeSuggestions
            .filter(item => item.toLowerCase().includes(keyword))
            .slice(0, 5);
    }, [activeSuggestions, editValue]);

    useEffect(() => {
        if (!editingCell || !inputRef.current) return;
        focusEditableField(inputRef.current, isMultilineField(editingCell.field));
    }, [editingCell]);

    useEffect(() => {
        if (!editingCell || !inputRef.current || !isMultilineField(editingCell.field)) return;
        const element = inputRef.current;
        element.style.height = 'auto';
        element.style.height = `${Math.min(Math.max(element.scrollHeight, 96), 260)}px`;
    }, [editingCell, editValue]);

    useEffect(() => {
        return () => {
            if (clickTimerRef.current) {
                clearTimeout(clickTimerRef.current);
                clickTimerRef.current = null;
            }
        };
    }, []);

    const handleCellClick = (value, label, copyToClipboard) => {
        if (value && !editingCell) {
            if (clickTimerRef.current) {
                clearTimeout(clickTimerRef.current);
            }
            clickTimerRef.current = setTimeout(() => {
                copyToClipboard(value, label);
                clickTimerRef.current = null;
            }, CLICK_COPY_DELAY_MS);
        }
    };

    const handleCellDoubleClick = (e, accountId, field, currentValue) => {
        e.stopPropagation();
        if (typeof e.preventDefault === 'function') {
            e.preventDefault();
        }
        if (clickTimerRef.current) {
            clearTimeout(clickTimerRef.current);
            clickTimerRef.current = null;
        }
        const safeValue = currentValue || '';
        setEditingCell({ accountId, field, originalValue: safeValue });
        setEditValue(safeValue);
        setShowSuggestions(getSuggestionsForField(field).length > 0);
    };

    const cancelEdit = () => {
        setEditingCell(null);
        setEditValue('');
        setShowSuggestions(false);
        isSelectingSuggestionRef.current = false;
    };

    /**
     * 计算一次保存要提交的字段补丁
     * - phone / smsUrl 支持整串粘贴 `号码|接码地址`，一次提交两个字段，避免只存一半；
     * - 直接改手机号且已有接码地址时，提示会一并清除旧绑定，取消则放弃保存。
     */
    const buildSavePatch = (rawValueOverride) => {
        const field = editingCell.field;
        const rawInput = String(rawValueOverride ?? editValue ?? '');
        const originalValue = normalizeMultiValueValue(field, String(editingCell.originalValue ?? ''));
        const patch = {};

        if (field === 'phone' || field === 'smsUrl') {
            const { phone, smsUrl } = extractPhoneAndSmsUrl(rawInput);
            const account = typeof getAccount === 'function' ? getAccount(editingCell.accountId) : null;
            const currentSmsUrl = normalizeSmsUrlInput(account?.smsUrl || '');

            if (field === 'phone') {
                const nextPhone = phone || (rawInput.trim() ? normalizePhoneNumber(rawInput) : '');
                if (!nextPhone) return { error: '手机号无效，请检查后再保存' };

                const phoneChanged = normalizePhoneNumber(nextPhone) !== normalizePhoneNumber(editingCell.originalValue || '');
                if (phoneChanged && currentSmsUrl && !smsUrl) {
                    const confirmed = typeof window !== 'undefined' && typeof window.confirm === 'function'
                        ? window.confirm('手机号已改变，是否同时清除该账号原来的接码地址？')
                        : true;
                    if (!confirmed) return { cancelled: true };
                    patch.phone = normalizePhoneNumber(nextPhone);
                    patch.smsUrl = '';
                    return { patch };
                }

                patch.phone = normalizePhoneNumber(nextPhone);
                if (smsUrl) patch.smsUrl = smsUrl;
                return { patch };
            }

            // smsUrl 字段：允许只填链接，也允许整串粘贴（同时更新手机号）
            const nextSmsUrl = smsUrl || normalizeSmsUrlInput(rawInput);
            if (rawInput.trim() && !nextSmsUrl) {
                return { error: '接码地址必须是 https 链接，例如 https://sms6688.com/api/sms/recordText?token=...' };
            }
            patch.smsUrl = nextSmsUrl;
            if (phone && normalizePhoneNumber(phone) !== normalizePhoneNumber(account?.phone || '')) {
                patch.phone = normalizePhoneNumber(phone);
            }
            return { patch };
        }

        let currentValue = rawInput;
        if (isMultilineField(field)) {
            currentValue = normalizeMultiValueValue(field, currentValue);
        }
        if (originalValue !== currentValue || field === 'smsUrl') {
            patch[field] = currentValue;
        }
        return { patch };
    };

    const saveEdit = (rawValueOverride) => {
        if (!editingCell) {
            cancelEdit();
            return;
        }

        const { patch, error, cancelled } = buildSavePatch(rawValueOverride);
        if (cancelled) {
            // 用户取消了「同时清除旧接码地址」的确认，放弃本次保存
            cancelEdit();
            return;
        }
        if (error) {
            if (typeof window !== 'undefined' && typeof window.alert === 'function') {
                window.alert(error);
            }
            return;
        }
        if (!patch || Object.keys(patch).length === 0) {
            cancelEdit();
            return;
        }

        const keys = Object.keys(patch);
        if (typeof onInlineEditMany === 'function' && keys.length > 1) {
            onInlineEditMany(editingCell.accountId, patch);
        } else if (onInlineEdit) {
            // 单字段，或没有批量回调时退化为逐字段提交
            for (const key of keys) {
                onInlineEdit(editingCell.accountId, key, patch[key]);
            }
        }
        cancelEdit();
    };

    const handleEditableInputBlur = () => {
        if (!isSelectingSuggestionRef.current) {
            saveEdit();
        } else {
            isSelectingSuggestionRef.current = false;
        }
    };

    const handleKeyDown = (e) => {
        if (!editingCell) return;

        const multiline = isMultilineField(editingCell.field);
        if (e.key === 'Escape') {
            if (typeof e.preventDefault === 'function') e.preventDefault();
            cancelEdit();
            return;
        }

        if (multiline) {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                if (typeof e.preventDefault === 'function') e.preventDefault();
                saveEdit();
            }
            return;
        }

        if (e.key === 'Enter') {
            if (typeof e.preventDefault === 'function') e.preventDefault();
            saveEdit();
        }
    };

    const selectSuggestion = (value) => {
        isSelectingSuggestionRef.current = true;

        if (!editingCell) {
            cancelEdit();
            return;
        }

        if (isMultilineField(editingCell.field)) {
            setEditValue(prev => appendUniqueLine(editingCell.field, prev, value));
            setShowSuggestions(getSuggestionsForField(editingCell.field).length > 0);
            queueMicrotask(() => {
                focusEditableField(inputRef.current, true);
            });
            isSelectingSuggestionRef.current = false;
            return;
        }

        // 单选建议：也要走补丁逻辑（如 phone/smsUrl 需要拆分与校验）
        if (editingCell.field === 'phone' || editingCell.field === 'smsUrl') {
            saveEdit(value);
        } else if (onInlineEdit) {
            onInlineEdit(editingCell.accountId, editingCell.field, value);
        }
        cancelEdit();
    };

    return {
        editingCell,
        editValue,
        setEditValue,
        inputRef,
        showSuggestions,
        filteredSuggestions,
        handleCellClick,
        handleCellDoubleClick,
        handleEditableInputBlur,
        handleKeyDown,
        selectSuggestion,
        cancelEdit,
        buildSavePatch,
        isMultilineEditing: isMultilineField(editingCell?.field),
    };
};

export default useInlineEdit;
