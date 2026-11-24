import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    SlidersHorizontal,
    Bot,
    Activity,
    Database,
    Monitor,
    X,
    Check,
    RotateCcw,
    Plus,
    RefreshCw,
    Download,
    ChevronDown,
    ChevronRight,
    Brain,
    Layers,
} from 'lucide-react';
import api from '../services/api';
import { confirmDialog } from '../utils/dialogs';
import { renderInBody } from '../utils/portal';
import { formatDbTimestamp } from '../utils/timeUtils';

const MONITOR_OPTIONS = [
    { value: 0, label: '关闭自动采集（仅手动探测）' },
    { value: 1, label: '每 1 分钟' },
    { value: 5, label: '每 5 分钟（推荐）' },
    { value: 15, label: '每 15 分钟' },
    { value: 30, label: '每 30 分钟' },
    { value: 60, label: '每 60 分钟' },
];

const CLOSE_BEHAVIOR_OPTIONS = [
    {
        value: 'ask',
        label: '每次关闭时询问（推荐）',
        desc: '点击右上角关闭按钮时弹窗选择「最小化至托盘」或「直接退出」',
    },
    {
        value: 'minimize',
        label: '最小化至系统托盘',
        desc: '隐藏主窗口到系统托盘后台运行，单击托盘图标随时恢复',
    },
    {
        value: 'quit',
        label: '直接退出应用',
        desc: '点击关闭按钮后立即彻底退出 GoogleManager',
    },
];

const CONTEXT_WINDOW_PRESETS = [
    { label: '32K 窗口', val: '32768' },
    { label: '64K 窗口', val: '65536' },
    { label: '128K 窗口', val: '128000' },
    { label: '200K 窗口', val: '200000' },
    { label: '1M 窗口', val: '1000000' },
];

function formatCompactK(n) {
    if (!Number.isFinite(n) || n <= 0) return '';
    if (n >= 1000000) return `${(n / 1000000).toFixed(n % 1000000 === 0 ? 0 : 1)}M`;
    if (n >= 1000) return `${Math.round(n / 1000)}K`;
    return String(n);
}

function looksLikeValidBaseUrl(raw) {
    const trimmed = String(raw || '').trim();
    return /^https?:\/\/[^/\s]+/i.test(trimmed);
}

function getUrlOrigin(raw) {
    const trimmed = String(raw || '').trim();
    if (!trimmed) return '';
    try {
        return new URL(trimmed).origin.toLowerCase();
    } catch {
        return '';
    }
}

function clampInt(raw, min, max) {
    const num = Number(raw);
    if (!Number.isFinite(num)) return null;
    return Math.min(max, Math.max(min, Math.round(num)));
}

const SystemSettingsDialog = ({
    isOpen,
    initialTab = 'ai',
    onClose,
    onNotify,
    onBackupRestored,
    onAgentSettingsSaved,
}) => {
    const [tab, setTab] = useState(initialTab);

    // AI 模型配置
    const [baseUrl, setBaseUrl] = useState('');
    const [apiKey, setApiKey] = useState('');
    const [clearApiKey, setClearApiKey] = useState(false);
    const [apiKeyHint, setApiKeyHint] = useState(null);
    const [model, setModel] = useState('');
    const [maxTokens, setMaxTokens] = useState('16384');
    const [contextWindow, setContextWindow] = useState('128000');
    const [temperature, setTemperature] = useState('0.2');
    const [autoCompact, setAutoCompact] = useState(true);
    const [reserveTokens, setReserveTokens] = useState('16384');
    const [keepRecentTokens, setKeepRecentTokens] = useState('20000');
    const [memoryEnabled, setMemoryEnabled] = useState(true);
    const [customSystemPrompt, setCustomSystemPrompt] = useState('');
    const [showCustomPrompt, setShowCustomPrompt] = useState(false);

    // 自动/手动拉取模型
    const [modelsList, setModelsList] = useState([]);
    const [modelQuery, setModelQuery] = useState('');
    const [fetchingModels, setFetchingModels] = useState(false);
    const [modelsOpen, setModelsOpen] = useState(false);
    const [modelsHint, setModelsHint] = useState(null);
    const [settingsLoaded, setSettingsLoaded] = useState(false);
    const lastAutoFetchedUrlRef = useRef('');
    const savedBaseUrlRef = useRef('');
    const isOpenRef = useRef(isOpen);
    const loadRequestIdRef = useRef(0);
    const fetchModelsRequestIdRef = useRef(0);
    const initialAutoFetchDoneRef = useRef(false);

    const [testingAi, setTestingAi] = useState(false);
    const [savingAi, setSavingAi] = useState(false);
    const [testResult, setTestResult] = useState(null);

    // 服务器采集周期
    const [monitorMinutes, setMonitorMinutes] = useState(5);
    const [savingMonitor, setSavingMonitor] = useState(false);

    // 常规与系统托盘关闭行为
    const [closeBehavior, setCloseBehavior] = useState('ask');
    const [savingCloseBehavior, setSavingCloseBehavior] = useState(false);

    // 数据备份与恢复
    const [backups, setBackups] = useState([]);
    const [loadingBackups, setLoadingBackups] = useState(false);
    const [creatingBackup, setCreatingBackup] = useState(false);
    const [restoringName, setRestoringName] = useState(null);

    const fetchModels = useCallback(async (urlOverride, keyOverride, { silent = false } = {}) => {
        if (typeof api?.fetchAgentModels !== 'function') return;
        const targetUrl = String(urlOverride ?? '').trim();
        if (!looksLikeValidBaseUrl(targetUrl)) {
            if (!silent) {
                setModelsHint({ ok: false, text: '请先填写合法的 OpenAI 兼容接口地址' });
            }
            return;
        }
        const reqId = ++fetchModelsRequestIdRef.current;
        setFetchingModels(true);
        if (!silent) {
            setModelsHint(null);
        }
        try {
            // keyOverride 允许传 ""（清除已存 Key 场景，后端不回退旧 Key），undefined/null 时传 null
            const effectiveKey = keyOverride === undefined ? null : keyOverride;
            const res = await api.fetchAgentModels(targetUrl, effectiveKey);
            if (!isOpenRef.current || reqId !== fetchModelsRequestIdRef.current) return;
            if (res?.success && res?.data && Array.isArray(res.data.models)) {
                setModelsList(res.data.models);
                lastAutoFetchedUrlRef.current = targetUrl;
                if (res.data.models.length > 0) {
                    setModelsHint({
                        ok: true,
                        text: `已拉取 ${res.data.models.length} 个可用模型`,
                    });
                    if (!silent) {
                        setModelsOpen(true);
                    }
                } else {
                    setModelsHint({
                        ok: false,
                        text: '接口未返回模型列表，可手动输入模型名称',
                    });
                }
            } else {
                setModelsList([]);
                setModelsOpen(false);
                setModelsHint({
                    ok: false,
                    text: silent
                        ? `自动拉取模型未成功（可手动填写）：${res?.message || '接口不支持 /models'}`
                        : (res?.message || '拉取模型列表失败'),
                });
            }
        } finally {
            if (reqId === fetchModelsRequestIdRef.current) {
                setFetchingModels(false);
            }
        }
    }, []);

    const loadAll = useCallback(async () => {
        const reqId = ++loadRequestIdRef.current;
        try {
            const [aiRes, monRes, closeRes] = await Promise.all([
                api.getAgentSettings(),
                api.getAppMonitorSettings(),
                typeof api?.getWindowCloseSettings === 'function'
                    ? api.getWindowCloseSettings()
                    : Promise.resolve(null),
            ]);
            if (!isOpenRef.current || reqId !== loadRequestIdRef.current) return;
            if (aiRes.success && aiRes.data) {
                const d = aiRes.data;
                const initialUrl = String(d.baseUrl || '').trim();
                savedBaseUrlRef.current = initialUrl;
                setBaseUrl(d.baseUrl || '');
                setModel(d.model || '');
                setMaxTokens(
                    d.maxTokens === 0
                        ? '0'
                        : String(d.maxTokens || 16384),
                );
                setContextWindow(String(d.contextWindow || 128000));
                setTemperature(String(d.temperature ?? 0.2));
                setAutoCompact(d.autoCompact ?? true);
                setReserveTokens(String(d.reserveTokens || 16384));
                setKeepRecentTokens(String(d.keepRecentTokens || 20000));
                setMemoryEnabled(d.memoryEnabled ?? true);
                setCustomSystemPrompt(d.customSystemPrompt || '');
                setShowCustomPrompt(Boolean(d.customSystemPrompt));
                setApiKeyHint(d.apiKeyHint || null);
                setApiKey('');
                setClearApiKey(false);
                setSettingsLoaded(true);
            }
            if (monRes.success && monRes.data) {
                setMonitorMinutes(monRes.data.serverMonitorMinutes ?? 5);
            }
            if (closeRes?.success && closeRes.data?.closeBehavior) {
                setCloseBehavior(closeRes.data.closeBehavior);
            }
        } catch {
            // 忽略初始化错误
        }
    }, []);

    const loadBackups = useCallback(async () => {
        setLoadingBackups(true);
        try {
            const res = await api.listBackups();
            if (res.success && Array.isArray(res.data)) {
                setBackups(res.data);
            }
        } finally {
            setLoadingBackups(false);
        }
    }, []);

    useEffect(() => {
        isOpenRef.current = isOpen;
        if (!isOpen) {
            loadRequestIdRef.current += 1;
            fetchModelsRequestIdRef.current += 1;
            lastAutoFetchedUrlRef.current = '';
            savedBaseUrlRef.current = '';
            initialAutoFetchDoneRef.current = false;
            setSettingsLoaded(false);
            setFetchingModels(false);
            setModelsList([]);
            setModelsOpen(false);
            setModelQuery('');
            return;
        }
        initialAutoFetchDoneRef.current = false;
        setSettingsLoaded(false);
        setTab(initialTab || 'ai');
        setTestResult(null);
        setModelsHint(null);
        setModelsOpen(false);
        loadAll();
        loadBackups();
    }, [isOpen, initialTab, loadAll, loadBackups]);

    // 仅在弹窗打开且停留在 AI Tab 时，对已保存地址执行一次静默自动拉取
    useEffect(() => {
        if (!isOpen || tab !== 'ai' || !settingsLoaded) return;
        if (initialAutoFetchDoneRef.current) return;
        initialAutoFetchDoneRef.current = true;
        const initialUrl = savedBaseUrlRef.current;
        if (looksLikeValidBaseUrl(initialUrl) && lastAutoFetchedUrlRef.current !== initialUrl) {
            fetchModels(initialUrl, null, { silent: true });
        }
    }, [isOpen, tab, settingsLoaded, fetchModels]);

    const filteredModels = useMemo(() => {
        const kw = modelQuery.trim().toLowerCase();
        if (!kw) return modelsList;
        return modelsList.filter(m =>
            String(m.id || '').toLowerCase().includes(kw) ||
            String(m.ownedBy || '').toLowerCase().includes(kw),
        );
    }, [modelsList, modelQuery]);

    const compactThresholdPreview = useMemo(() => {
        const cw = Math.max(4096, Number.parseInt(String(contextWindow || '128000'), 10) || 128000);
        const rev = Math.min(Math.floor(cw / 2), Math.max(1024, Number.parseInt(String(reserveTokens || '16384'), 10) || 16384));
        return Math.max(2048, cw - rev);
    }, [contextWindow, reserveTokens]);

    if (!isOpen) return null;

    const handleSelectFetchedModel = (item) => {
        setModel(item.id);
        const syncedNotes = [];
        if (item.contextWindow && Number(item.contextWindow) >= 4096) {
            const clampedCw = clampInt(item.contextWindow, 4096, 2000000);
            if (clampedCw !== null) {
                setContextWindow(String(clampedCw));
                syncedNotes.push(`上下文窗口 ${formatCompactK(clampedCw)}`);
            }
        }
        // 若用户显式选择了 0（自动不限），选用模型时保留 0 不静默覆盖
        const keepAutoMaxTokens = String(maxTokens ?? '').trim() === '0';
        if (!keepAutoMaxTokens && item.maxOutputTokens && Number(item.maxOutputTokens) >= 256) {
            const clampedMax = clampInt(item.maxOutputTokens, 256, 1000000);
            if (clampedMax !== null) {
                setMaxTokens(String(clampedMax));
                syncedNotes.push(`最大输出 ${formatCompactK(clampedMax)}`);
            }
        }
        setModelsHint({
            ok: true,
            text: syncedNotes.length > 0
                ? `已选用模型 ${item.id}（已自动同步${syncedNotes.join('、')}）`
                : `已选用模型 ${item.id}`,
        });
        setModelsOpen(false);
    };

    const handleSaveAi = async (e) => {
        e.preventDefault();
        setSavingAi(true);
        try {
            const trimmedMax = String(maxTokens ?? '').trim();
            const parsedMax = trimmedMax === '' ? 0 : Number.parseInt(trimmedMax, 10);
            const normalizedMax = Number.isFinite(parsedMax) && parsedMax >= 0 ? parsedMax : 16384;

            const parsedCw = Number.parseInt(String(contextWindow ?? ''), 10);
            const normalizedCw = Number.isFinite(parsedCw) && parsedCw > 0 ? parsedCw : 128000;

            const parsedTemp = Number.parseFloat(String(temperature ?? '0.2'));
            const normalizedTemp = Number.isFinite(parsedTemp) ? parsedTemp : 0.2;

            const parsedReserve = Number.parseInt(String(reserveTokens ?? ''), 10);
            const normalizedReserve = Number.isFinite(parsedReserve) && parsedReserve > 0 ? parsedReserve : 16384;

            const parsedKeep = Number.parseInt(String(keepRecentTokens ?? ''), 10);
            const normalizedKeep = Number.isFinite(parsedKeep) && parsedKeep > 0 ? parsedKeep : 20000;

            const res = await api.saveAgentSettings({
                baseUrl: baseUrl.trim(),
                apiKey: apiKey.trim() || null,
                clearApiKey,
                model: model.trim(),
                maxTokens: normalizedMax,
                contextWindow: normalizedCw,
                temperature: normalizedTemp,
                autoCompact,
                reserveTokens: normalizedReserve,
                keepRecentTokens: normalizedKeep,
                memoryEnabled,
                customSystemPrompt: customSystemPrompt.trim(),
            });
            if (!res.success || !res.data) {
                onNotify?.(res.message || '保存 AI 设置失败', 'error');
                return;
            }
            const d = res.data;
            savedBaseUrlRef.current = String(d.baseUrl || '').trim();
            setBaseUrl(d.baseUrl || '');
            setModel(d.model || '');
            setMaxTokens(
                d.maxTokens === 0
                    ? '0'
                    : String(d.maxTokens || 16384),
            );
            setContextWindow(String(d.contextWindow ?? normalizedCw));
            setTemperature(String(d.temperature ?? normalizedTemp));
            setAutoCompact(d.autoCompact ?? autoCompact);
            setReserveTokens(String(d.reserveTokens ?? normalizedReserve));
            setKeepRecentTokens(String(d.keepRecentTokens ?? normalizedKeep));
            setMemoryEnabled(d.memoryEnabled ?? memoryEnabled);
            setCustomSystemPrompt(d.customSystemPrompt ?? '');
            setApiKeyHint(d.apiKeyHint || null);
            setApiKey('');
            setClearApiKey(false);
            onAgentSettingsSaved?.(d);
            onNotify?.('AI 模型配置已保存');
        } finally {
            setSavingAi(false);
        }
    };

    const handleTestAi = async () => {
        setTestingAi(true);
        setTestResult(null);
        try {
            const res = await api.testAgentConnection(
                baseUrl.trim() || null,
                clearApiKey ? '' : (apiKey.trim() || null),
                model.trim() || null,
            );
            if (res.success && res.data) {
                setTestResult({ ok: true, message: res.data.message });
            } else {
                setTestResult({ ok: false, message: res.message || '连接失败' });
            }
        } finally {
            setTestingAi(false);
        }
    };

    const handleSaveMonitor = async (e) => {
        e.preventDefault();
        setSavingMonitor(true);
        try {
            const res = await api.saveAppMonitorSettings(Number(monitorMinutes));
            if (!res.success || !res.data) {
                onNotify?.(res.message || '保存采集周期失败', 'error');
                return;
            }
            setMonitorMinutes(res.data.serverMonitorMinutes);
            onNotify?.('服务器采集周期已保存');
        } finally {
            setSavingMonitor(false);
        }
    };

    const handleSaveCloseBehavior = async (e) => {
        e.preventDefault();
        if (typeof api?.saveWindowCloseSettings !== 'function') return;
        setSavingCloseBehavior(true);
        try {
            const res = await api.saveWindowCloseSettings(closeBehavior);
            if (!res.success || !res.data) {
                onNotify?.(res.message || '保存窗口关闭行为失败', 'error');
                return;
            }
            setCloseBehavior(res.data.closeBehavior);
            onNotify?.('窗口关闭行为已保存');
        } finally {
            setSavingCloseBehavior(false);
        }
    };

    const handleCreateBackup = async () => {
        setCreatingBackup(true);
        try {
            const res = await api.createBackup('manual');
            if (res.success) {
                onNotify?.('已创建本地数据库快照备份');
                await loadBackups();
            } else {
                onNotify?.(res.message || '创建备份失败', 'error');
            }
        } finally {
            setCreatingBackup(false);
        }
    };

    const handleRestoreBackup = async (backupName) => {
        const ok = await confirmDialog(
            `确定要从备份 "${backupName}" 恢复全部数据吗？当前未备份的更改会被替换（恢复前系统会自动保护备份）。`,
            { title: '恢复数据备份', okLabel: '确认恢复', cancelLabel: '取消', kind: 'warning' },
        );
        if (!ok) return;
        setRestoringName(backupName);
        try {
            const res = await api.restoreBackup(backupName);
            if (res.success) {
                onNotify?.('备份恢复成功，已刷新本地数据');
                await loadBackups();
                onBackupRestored?.();
            } else {
                onNotify?.(res.message || '恢复备份失败', 'error');
            }
        } finally {
            setRestoringName(null);
        }
    };

    return renderInBody(
        <div className="gm-overlay" role="dialog" aria-modal="true" aria-label="系统设置">
            <div className="gm-modal w-full max-w-2xl max-h-[90vh] flex flex-col p-6 space-y-4">
                <div className="flex items-center justify-between">
                    <h2 className="text-base font-semibold text-[var(--text-primary)] flex items-center gap-2">
                        <SlidersHorizontal size={18} className="text-[var(--primary)]" />
                        系统设置
                    </h2>
                    <button type="button" className="gm-btn gm-btn-ghost p-1" onClick={() => onClose?.()}>
                        <X size={16} />
                    </button>
                </div>

                {/* 分区 Tab */}
                <div className="flex flex-wrap items-center gap-1.5 border-b border-[var(--border-subtle)] pb-2">
                    {[
                        { id: 'ai', label: 'AI 模型配置', icon: Bot },
                        { id: 'general', label: '常规与托盘', icon: Monitor },
                        { id: 'monitor', label: '服务器监控', icon: Activity },
                        { id: 'backup', label: '数据备份与恢复', icon: Database },
                    ].map(item => {
                        const Icon = item.icon;
                        return (
                            <button
                                key={item.id}
                                type="button"
                                onClick={() => setTab(item.id)}
                                className={`gm-btn text-xs ${
                                    tab === item.id ? 'gm-btn-primary' : 'gm-btn-ghost'
                                }`}
                            >
                                <Icon size={14} />
                                {item.label}
                            </button>
                        );
                    })}
                </div>

                <div className="flex-1 overflow-y-auto space-y-4 text-xs pr-0.5">
                    {tab === 'ai' && (
                        <form onSubmit={handleSaveAi} className="space-y-3.5">
                            <label className="block space-y-1">
                                <span className="text-[var(--text-secondary)]">
                                    OpenAI 兼容接口地址（远程需 HTTPS，本机服务可用 HTTP）
                                </span>
                                <input
                                    className="gm-input w-full font-mono"
                                    value={baseUrl}
                                    onChange={e => {
                                        const nextUrl = e.target.value;
                                        setBaseUrl(nextUrl);
                                        if (nextUrl.trim() !== lastAutoFetchedUrlRef.current) {
                                            setModelsList([]);
                                            setModelsOpen(false);
                                        }
                                    }}
                                    onBlur={() => {
                                        const trimmed = baseUrl.trim();
                                        if (
                                            !looksLikeValidBaseUrl(trimmed) ||
                                            lastAutoFetchedUrlRef.current === trimmed ||
                                            clearApiKey
                                        ) {
                                            return;
                                        }
                                        const trimmedKey = apiKey.trim();
                                        const savedOrigin = getUrlOrigin(savedBaseUrlRef.current);
                                        const nextOrigin = getUrlOrigin(trimmed);
                                        const isSameOrigin = Boolean(
                                            savedOrigin && nextOrigin && savedOrigin === nextOrigin,
                                        );
                                        // 仅在同源或用户已手动输入新 Key 时静默拉取，防止旧服务商 Key 泄露至新地址
                                        if (!isSameOrigin && !trimmedKey) {
                                            return;
                                        }
                                        fetchModels(trimmed, trimmedKey || null, { silent: true });
                                    }}
                                    placeholder="https://api.openai.com/v1 或 http://127.0.0.1:11434/v1"
                                />
                            </label>

                            <div className="space-y-1">
                                <div className="flex items-center justify-between">
                                    <span className="text-[var(--text-secondary)]">
                                        API Key {apiKeyHint ? `(已保存: ${apiKeyHint})` : '（可选，本机服务可留空）'}
                                    </span>
                                    {apiKeyHint && (
                                        <label className="flex items-center gap-1 cursor-pointer text-[var(--danger)]">
                                            <input
                                                type="checkbox"
                                                checked={clearApiKey}
                                                onChange={e => setClearApiKey(e.target.checked)}
                                            />
                                            清除已存 Key
                                        </label>
                                    )}
                                </div>
                                <input
                                    type="password"
                                    className="gm-input w-full font-mono"
                                    value={apiKey}
                                    disabled={clearApiKey}
                                    onChange={e => setApiKey(e.target.value)}
                                    placeholder={apiKeyHint ? '留空表示保持原有 Key 不变' : 'sk-...'}
                                />
                            </div>

                            {/* 模型名称 + 自动/手动拉取模型列表 */}
                            <div className="space-y-1.5">
                                <div className="flex items-center justify-between gap-2">
                                    <span className="text-[var(--text-secondary)]">模型名称</span>
                                    <div className="flex items-center gap-1.5">
                                        {modelsList.length > 0 && (
                                            <button
                                                type="button"
                                                className="text-[11px] font-mono text-[var(--primary)] hover:underline cursor-pointer"
                                                onClick={() => setModelsOpen(v => !v)}
                                            >
                                                {modelsOpen ? '收起模型列表' : `选择已拉取模型 (${modelsList.length})`}
                                            </button>
                                        )}
                                        <button
                                            type="button"
                                            className="gm-btn gm-btn-ghost text-[11px] py-0.5 px-2"
                                            onClick={() => fetchModels(
                                                baseUrl,
                                                clearApiKey ? '' : (apiKey.trim() || null),
                                                { silent: false },
                                            )}
                                            disabled={fetchingModels || !baseUrl.trim()}
                                        >
                                            <Download size={12} className={fetchingModels ? 'animate-pulse' : ''} />
                                            <span>{fetchingModels ? '拉取中...' : '拉取模型'}</span>
                                        </button>
                                    </div>
                                </div>
                                <input
                                    className="gm-input w-full font-mono"
                                    value={model}
                                    onChange={e => setModel(e.target.value)}
                                    placeholder="gpt-4o-mini / qwen2.5:14b"
                                />
                                {modelsHint && (
                                    <div
                                        className="text-[11px]"
                                        style={{ color: modelsHint.ok ? 'var(--success)' : 'var(--text-secondary)' }}
                                    >
                                        {modelsHint.text}
                                    </div>
                                )}
                                {modelsOpen && modelsList.length > 0 && (
                                    <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] p-2 space-y-2">
                                        <input
                                            type="text"
                                            className="gm-input w-full text-[11px] font-mono py-1"
                                            value={modelQuery}
                                            onChange={e => setModelQuery(e.target.value)}
                                            placeholder="搜索模型 ID 或提供方..."
                                        />
                                        <div className="max-h-40 overflow-y-auto divide-y divide-[var(--border-light)]">
                                            {filteredModels.length === 0 ? (
                                                <div className="py-3 text-center text-[11px] text-[var(--text-secondary)]">
                                                    无匹配模型
                                                </div>
                                            ) : (
                                                filteredModels.map(item => {
                                                    const selected = item.id === model;
                                                    return (
                                                        <button
                                                            key={item.id}
                                                            type="button"
                                                            onClick={() => handleSelectFetchedModel(item)}
                                                            className={`w-full flex items-center justify-between gap-2 px-2 py-1.5 text-left text-[11px] transition-colors cursor-pointer ${
                                                                selected
                                                                    ? 'bg-[var(--primary-light)] text-[var(--primary)]'
                                                                    : 'hover:bg-[var(--bg-hover)] text-[var(--text-primary)]'
                                                            }`}
                                                        >
                                                            <span className="font-mono truncate">{item.id}</span>
                                                            <span className="flex items-center gap-1.5 shrink-0 text-[10px] font-mono text-[var(--text-secondary)]">
                                                                {item.ownedBy && <span>{item.ownedBy}</span>}
                                                                {item.contextWindow && (
                                                                    <span className="px-1.5 py-0.5 rounded bg-[var(--bg-panel)] border border-[var(--border-subtle)]">
                                                                        CTX {formatCompactK(item.contextWindow)}
                                                                    </span>
                                                                )}
                                                            </span>
                                                        </button>
                                                    );
                                                })
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* 上下文窗口 + 最大输出 + 温度 */}
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                <label className="block space-y-1 sm:col-span-2">
                                    <span className="text-[var(--text-secondary)]">
                                        上下文窗口限制 (Token，用于 Pi 自动压缩阈值计算)
                                    </span>
                                    <input
                                        type="number"
                                        min={4096}
                                        max={2000000}
                                        className="gm-input w-full font-mono"
                                        value={contextWindow}
                                        onChange={e => setContextWindow(e.target.value)}
                                        placeholder="128000"
                                    />
                                    <div className="flex flex-wrap gap-1 pt-1">
                                        {CONTEXT_WINDOW_PRESETS.map(preset => (
                                            <button
                                                key={preset.val}
                                                type="button"
                                                onClick={() => setContextWindow(preset.val)}
                                                className={`px-2 py-0.5 rounded text-[10.5px] font-mono border transition-colors cursor-pointer ${
                                                    String(contextWindow) === preset.val
                                                        ? 'bg-[var(--primary-light)] text-[var(--primary)] border-[var(--primary)]'
                                                        : 'bg-[var(--bg-elevated)] text-[var(--text-secondary)] border-[var(--border)] hover:text-[var(--text-primary)]'
                                                }`}
                                            >
                                                {preset.label}
                                            </button>
                                        ))}
                                    </div>
                                </label>

                                <label className="block space-y-1">
                                    <span className="text-[var(--text-secondary)]">
                                        采样温度 (0.0 ~ 2.0)
                                    </span>
                                    <input
                                        type="number"
                                        min={0}
                                        max={2}
                                        step="0.01"
                                        className="gm-input w-full font-mono"
                                        value={temperature}
                                        onChange={e => setTemperature(e.target.value)}
                                        placeholder="0.2"
                                    />
                                </label>
                            </div>

                            <label className="block space-y-1">
                                <span className="text-[var(--text-secondary)]">
                                    最大输出 Token（0 = 自动不限，最高 1,000,000）
                                </span>
                                <input
                                    type="number"
                                    min={0}
                                    max={1000000}
                                    className="gm-input w-full font-mono"
                                    value={maxTokens}
                                    onChange={e => setMaxTokens(e.target.value)}
                                    placeholder="0 表示自动"
                                />
                                <div className="flex flex-wrap gap-1 pt-1">
                                    {[
                                        { label: '自动', val: '0' },
                                        { label: '8K', val: '8192' },
                                        { label: '32K', val: '32768' },
                                        { label: '64K', val: '65536' },
                                        { label: '128K', val: '128000' },
                                        { label: '256K', val: '256000' },
                                    ].map(preset => (
                                        <button
                                            key={preset.val}
                                            type="button"
                                            onClick={() => setMaxTokens(preset.val)}
                                            className={`px-2 py-0.5 rounded text-[10.5px] font-mono border transition-colors cursor-pointer ${
                                                String(maxTokens) === preset.val
                                                    ? 'bg-[var(--primary-light)] text-[var(--primary)] border-[var(--primary)]'
                                                    : 'bg-[var(--bg-elevated)] text-[var(--text-secondary)] border-[var(--border)] hover:text-[var(--text-primary)]'
                                            }`}
                                        >
                                            {preset.label}
                                        </button>
                                    ))}
                                </div>
                            </label>

                            {/* Pi-Agent 上下文压缩配置 */}
                            <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3 space-y-2.5">
                                <div className="flex items-center justify-between gap-2">
                                    <div className="flex items-center gap-1.5 font-semibold text-[var(--text-primary)]">
                                        <Layers size={14} className="text-[var(--primary)]" />
                                        <span>Pi-Agent 上下文自动压缩</span>
                                    </div>
                                    <label className="inline-flex items-center gap-1.5 cursor-pointer text-[11px]">
                                        <input
                                            type="checkbox"
                                            checked={autoCompact}
                                            onChange={e => setAutoCompact(e.target.checked)}
                                        />
                                        <span>启用自动压缩</span>
                                    </label>
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <label className="block space-y-1">
                                        <span className="text-[var(--text-secondary)]">
                                            预留响应余量 reserveTokens
                                        </span>
                                        <input
                                            type="number"
                                            min={1024}
                                            max={256000}
                                            className="gm-input w-full font-mono"
                                            value={reserveTokens}
                                            onChange={e => setReserveTokens(e.target.value)}
                                        />
                                    </label>
                                    <label className="block space-y-1">
                                        <span className="text-[var(--text-secondary)]">
                                            保留近期对话 keepRecentTokens
                                        </span>
                                        <input
                                            type="number"
                                            min={1000}
                                            max={500000}
                                            className="gm-input w-full font-mono"
                                            value={keepRecentTokens}
                                            onChange={e => setKeepRecentTokens(e.target.value)}
                                        />
                                    </label>
                                </div>
                                <p className="text-[11px] text-[var(--text-secondary)] m-0">
                                    触发公式：<span className="font-mono">contextTokens &gt; contextWindow - reserveTokens</span>
                                    （当前触发线约 <span className="font-mono text-[var(--text-primary)]">{compactThresholdPreview.toLocaleString()}</span> tokens），保留末尾完整问答并把早期历史提炼为结构化交接摘要。
                                </p>
                            </div>

                            {/* Hermes 本地长期记忆开关 */}
                            <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3 space-y-1.5">
                                <div className="flex items-center justify-between gap-2">
                                    <div className="flex items-center gap-1.5 font-semibold text-[var(--text-primary)]">
                                        <Brain size={14} className="text-[var(--primary)]" />
                                        <span>Hermes 本地长期记忆</span>
                                    </div>
                                    <label className="inline-flex items-center gap-1.5 cursor-pointer text-[11px]">
                                        <input
                                            type="checkbox"
                                            checked={memoryEnabled}
                                            onChange={e => setMemoryEnabled(e.target.checked)}
                                        />
                                        <span>启用跨对话记忆注入</span>
                                    </label>
                                </div>
                                <p className="text-[11px] text-[var(--text-secondary)] m-0">
                                    维护 <span className="font-mono">USER.md</span>（1,500 字）与 <span className="font-mono">MEMORY.md</span>（2,500 字）双区有界记忆，每轮冻结注入并在后台同步镜像到本地目录，自动拦截敏感凭据。
                                </p>
                            </div>

                            {/* 附加系统指令（可折叠） */}
                            <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)]">
                                <button
                                    type="button"
                                    className="w-full flex items-center justify-between px-3 py-2 text-left text-[11.5px] font-medium text-[var(--text-primary)] cursor-pointer"
                                    onClick={() => setShowCustomPrompt(v => !v)}
                                >
                                    <span>附加系统指令（可选）</span>
                                    {showCustomPrompt ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                </button>
                                {showCustomPrompt && (
                                    <div className="px-3 pb-3 pt-1 border-t border-[var(--border-subtle)] space-y-1">
                                        <textarea
                                            rows={3}
                                            maxLength={4000}
                                            className="gm-input w-full text-xs"
                                            value={customSystemPrompt}
                                            onChange={e => setCustomSystemPrompt(e.target.value)}
                                            placeholder="例如：分析服务器时默认按区域分组；涉及续费优先标注剩余天数。"
                                        />
                                        <div className="text-right text-[10.5px] font-mono gm-text-3">
                                            {customSystemPrompt.length} / 4000
                                        </div>
                                    </div>
                                )}
                            </div>

                            {testResult && (
                                <div
                                    className="rounded-lg px-3 py-2 text-xs"
                                    style={{
                                        background: testResult.ok ? 'var(--success-soft)' : 'var(--danger-soft)',
                                        color: testResult.ok ? 'var(--success)' : 'var(--danger)',
                                    }}
                                >
                                    {testResult.message}
                                </div>
                            )}

                            <div className="flex justify-end gap-2 pt-2">
                                <button
                                    type="button"
                                    className="gm-btn gm-btn-ghost"
                                    onClick={handleTestAi}
                                    disabled={testingAi || !baseUrl.trim() || !model.trim()}
                                >
                                    <RefreshCw size={14} className={testingAi ? 'animate-spin' : ''} />
                                    测试连接
                                </button>
                                <button type="submit" className="gm-btn gm-btn-primary" disabled={savingAi}>
                                    <Check size={14} />
                                    {savingAi ? '保存中...' : '保存 AI 设置'}
                                </button>
                            </div>
                        </form>
                    )}

                    {tab === 'general' && (
                        <form onSubmit={handleSaveCloseBehavior} className="space-y-4">
                            <p className="text-[var(--text-secondary)] leading-relaxed">
                                设置点击主窗口右上角关闭按钮（或按 Alt+F4）时的默认操作。最小化至系统托盘后，可在任务栏托盘单击图标恢复窗口或右键退出。
                            </p>
                            <div className="space-y-2">
                                {CLOSE_BEHAVIOR_OPTIONS.map((opt) => (
                                    <label
                                        key={opt.value}
                                        className="flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors"
                                        style={{
                                            background: closeBehavior === opt.value
                                                ? 'var(--primary-light)'
                                                : 'var(--bg-elevated)',
                                            borderColor: closeBehavior === opt.value
                                                ? 'var(--primary)'
                                                : 'var(--border-subtle)',
                                        }}
                                    >
                                        <input
                                            type="radio"
                                            name="windowCloseBehavior"
                                            value={opt.value}
                                            checked={closeBehavior === opt.value}
                                            onChange={() => setCloseBehavior(opt.value)}
                                            className="mt-0.5"
                                        />
                                        <div className="space-y-0.5">
                                            <div className="font-semibold text-[var(--text-primary)]">
                                                {opt.label}
                                            </div>
                                            <div className="text-[11.5px] text-[var(--text-secondary)]">
                                                {opt.desc}
                                            </div>
                                        </div>
                                    </label>
                                ))}
                            </div>
                            <div className="flex justify-end">
                                <button
                                    type="submit"
                                    className="gm-btn gm-btn-primary"
                                    disabled={savingCloseBehavior}
                                >
                                    <Check size={14} />
                                    {savingCloseBehavior ? '保存中...' : '保存窗口设置'}
                                </button>
                            </div>
                        </form>
                    )}

                    {tab === 'monitor' && (
                        <form onSubmit={handleSaveMonitor} className="space-y-4">
                            <p className="text-[var(--text-secondary)] leading-relaxed">
                                打开「服务器」页面并处于可见状态时，系统会按此周期对启用定期采集的节点执行一次轻量只读探针，窗口隐藏时自动暂停。
                            </p>
                            <label className="block space-y-1">
                                <span className="text-[var(--text-secondary)]">服务器自动采集周期</span>
                                <select
                                    className="gm-input w-full"
                                    value={monitorMinutes}
                                    onChange={e => setMonitorMinutes(Number(e.target.value))}
                                >
                                    {MONITOR_OPTIONS.map(opt => (
                                        <option key={opt.value} value={opt.value}>
                                            {opt.label}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <div className="flex justify-end">
                                <button type="submit" className="gm-btn gm-btn-primary" disabled={savingMonitor}>
                                    <Check size={14} />
                                    {savingMonitor ? '保存中...' : '保存采集设置'}
                                </button>
                            </div>
                        </form>
                    )}

                    {tab === 'backup' && (
                        <div className="space-y-3">
                            <div className="flex items-center justify-between gap-2">
                                <span className="text-[var(--text-secondary)]">
                                    使用 SQLite VACUUM INTO 全库快照备份（涵盖谷歌账号及全部数字资产与 AI 记忆表）。
                                </span>
                                <button
                                    type="button"
                                    className="gm-btn gm-btn-primary text-xs shrink-0"
                                    onClick={handleCreateBackup}
                                    disabled={creatingBackup}
                                >
                                    <Plus size={14} />
                                    {creatingBackup ? '创建中...' : '创建备份'}
                                </button>
                            </div>
                            <div className="border border-[var(--border-subtle)] rounded-lg overflow-hidden">
                                {loadingBackups ? (
                                    <div className="p-6 text-center text-[var(--text-secondary)]">加载备份列表...</div>
                                ) : backups.length === 0 ? (
                                    <div className="p-6 text-center text-[var(--text-secondary)]">暂无本地备份记录</div>
                                ) : (
                                    <table className="w-full text-xs">
                                        <thead>
                                            <tr className="bg-[var(--bg-elevated)] text-left text-[var(--text-secondary)]">
                                                <th className="px-3 py-2">文件名</th>
                                                <th className="px-3 py-2">大小 / 时间</th>
                                                <th className="px-3 py-2 text-right">操作</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-[var(--border-subtle)]">
                                            {backups.map(b => {
                                                const bytes = b.sizeBytes ?? b.size;
                                                return (
                                                    <tr key={b.name}>
                                                        <td className="px-3 py-2 font-mono">{b.name}</td>
                                                        <td className="px-3 py-2 text-[var(--text-secondary)]">
                                                            {bytes ? `${Math.round(bytes / 1024)} KB` : '-'}
                                                            {b.createdAt ? ` · ${formatDbTimestamp(b.createdAt)}` : ''}
                                                        </td>
                                                        <td className="px-3 py-2 text-right">
                                                            <button
                                                                type="button"
                                                                className="gm-btn gm-btn-ghost text-xs py-1 px-2.5"
                                                                onClick={() => handleRestoreBackup(b.name)}
                                                                disabled={restoringName === b.name}
                                                            >
                                                                <RotateCcw size={12} />
                                                                {restoringName === b.name ? '恢复中...' : '恢复备份'}
                                                            </button>
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>,
    );
};

export default SystemSettingsDialog;
