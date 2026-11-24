import { useCallback, useEffect, useState } from 'react';
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

const SystemSettingsDialog = ({
    isOpen,
    initialTab = 'ai',
    onClose,
    onNotify,
    onBackupRestored,
}) => {
    const [tab, setTab] = useState(initialTab);

    // AI 模型配置
    const [baseUrl, setBaseUrl] = useState('');
    const [apiKey, setApiKey] = useState('');
    const [clearApiKey, setClearApiKey] = useState(false);
    const [apiKeyHint, setApiKeyHint] = useState(null);
    const [model, setModel] = useState('');
    const [maxTokens, setMaxTokens] = useState('16384');
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

    const loadAll = useCallback(async () => {
        try {
            const [aiRes, monRes, closeRes] = await Promise.all([
                api.getAgentSettings(),
                api.getAppMonitorSettings(),
                typeof api?.getWindowCloseSettings === 'function'
                    ? api.getWindowCloseSettings()
                    : Promise.resolve(null),
            ]);
            if (aiRes.success && aiRes.data) {
                setBaseUrl(aiRes.data.baseUrl || '');
                setModel(aiRes.data.model || '');
                setMaxTokens(
                    aiRes.data.maxTokens === 0
                        ? '0'
                        : String(aiRes.data.maxTokens || 16384),
                );
                setApiKeyHint(aiRes.data.apiKeyHint || null);
                setApiKey('');
                setClearApiKey(false);
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
        if (!isOpen) return;
        setTab(initialTab || 'ai');
        setTestResult(null);
        loadAll();
        loadBackups();
    }, [isOpen, initialTab, loadAll, loadBackups]);

    if (!isOpen) return null;

    const handleSaveAi = async (e) => {
        e.preventDefault();
        setSavingAi(true);
        try {
            const trimmedMax = String(maxTokens ?? '').trim();
            const parsedMax = trimmedMax === '' ? 0 : Number.parseInt(trimmedMax, 10);
            const normalizedMax = Number.isFinite(parsedMax) && parsedMax >= 0 ? parsedMax : 16384;
            const res = await api.saveAgentSettings({
                baseUrl: baseUrl.trim(),
                apiKey: apiKey.trim() || null,
                clearApiKey,
                model: model.trim(),
                maxTokens: normalizedMax,
            });
            if (!res.success || !res.data) {
                onNotify?.(res.message || '保存 AI 设置失败', 'error');
                return;
            }
            setBaseUrl(res.data.baseUrl || '');
            setModel(res.data.model || '');
            setMaxTokens(
                res.data.maxTokens === 0
                    ? '0'
                    : String(res.data.maxTokens || 16384),
            );
            setApiKeyHint(res.data.apiKeyHint || null);
            setApiKey('');
            setClearApiKey(false);
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
                apiKey.trim() || null,
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

                <div className="flex-1 overflow-y-auto space-y-4 text-xs">
                    {tab === 'ai' && (
                        <form onSubmit={handleSaveAi} className="space-y-3">
                            <label className="block space-y-1">
                                <span className="text-[var(--text-secondary)]">
                                    OpenAI 兼容接口地址（远程需 HTTPS，本机服务可用 HTTP）
                                </span>
                                <input
                                    className="gm-input w-full font-mono"
                                    value={baseUrl}
                                    onChange={e => setBaseUrl(e.target.value)}
                                    placeholder="https://api.openai.com/v1 或 http://127.0.0.1:11434/v1"
                                />
                            </label>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <label className="block space-y-1">
                                    <span className="text-[var(--text-secondary)]">模型名称</span>
                                    <input
                                        className="gm-input w-full font-mono"
                                        value={model}
                                        onChange={e => setModel(e.target.value)}
                                        placeholder="gpt-4o-mini / qwen2.5:14b"
                                    />
                                </label>
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
                            </div>
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
                                    使用 SQLite VACUUM INTO 全库快照备份（涵盖谷歌账号及 9 张新数字资产表）。
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
                                            {backups.map(b => (
                                                <tr key={b.name}>
                                                    <td className="px-3 py-2 font-mono">{b.name}</td>
                                                    <td className="px-3 py-2 text-[var(--text-secondary)]">
                                                        {b.size ? `${Math.round(b.size / 1024)} KB` : '-'}
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
                                            ))}
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
