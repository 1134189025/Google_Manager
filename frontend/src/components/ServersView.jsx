import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Server,
    Terminal,
    FolderOpen,
    Folder,
    File as FileIcon,
    Network,
    RefreshCw,
    Plus,
    Edit2,
    Trash2,
    Search,
    X,
    ShieldAlert,
    Cpu,
    HardDrive,
    Activity,
    Upload,
    Download,
    ArrowUp,
    Eye,
    EyeOff,
    Power,
    Box,
} from 'lucide-react';
import { open as openFileDialog, save as saveFileDialog } from '@tauri-apps/plugin-dialog';
import api from '../services/api';
import { confirmDialog } from '../utils/dialogs';
import { renderInBody } from '../utils/portal';
import { formatDbTimestamp } from '../utils/timeUtils';
import {
    DATE_INPUT_MAX,
    DATE_INPUT_MIN,
    DEFAULT_USD_CNY_RATE,
    clampDateInputValue,
    convertToCny,
    daysUntilDay,
    finalizeDateInputValue,
    formatCnyAmount,
    formatCycleLabel,
    formatDaysBadge,
    formatMoney,
} from '../utils/renewalUtils';

const EMPTY_SERVER_FORM = {
    name: '',
    host: '',
    port: '22',
    username: 'root',
    authKind: 'password',
    credential: '',
    passphrase: '',
    region: '',
    collectEnabled: true,
    billingAmount: '',
    billingCurrency: 'USD',
    billingCycle: 'month',
    expiresAt: '',
    tags: '',
    notes: '',
};

const EXPOSURE_STYLE = {
    public: { background: 'var(--danger-soft)', color: 'var(--danger)', label: '公网' },
    private: { background: 'var(--warning-soft)', color: 'var(--warning)', label: '内网' },
    local: { background: 'var(--bg-elevated)', color: 'var(--text-secondary)', label: '本机' },
};

function formatKbSize(kb) {
    if (!Number.isFinite(kb) || kb <= 0) return null;
    const gb = kb / (1024 * 1024);
    if (gb >= 1) return `${gb.toFixed(1)} GB`;
    const mb = kb / 1024;
    return `${Math.round(mb)} MB`;
}

function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes < 0) return '-';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function parseServicesJson(raw) {
    if (!raw) return null;
    try {
        const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (!obj || typeof obj !== 'object') return null;
        return {
            ports: Array.isArray(obj.ports) ? obj.ports : [],
            dockerAvailable: Boolean(obj.dockerAvailable ?? obj.docker_available),
            dockerReason: obj.dockerReason ?? obj.docker_reason ?? null,
            containers: Array.isArray(obj.containers) ? obj.containers : [],
        };
    } catch {
        return null;
    }
}

export function parseHostKeyMismatch(message) {
    if (typeof message !== 'string' || !message.startsWith('HOST_KEY_CHANGED:')) return null;
    const rest = message.slice('HOST_KEY_CHANGED:'.length);
    const idx = rest.indexOf(':SHA256:');
    if (idx > 0) {
        return {
            expected: rest.slice(0, idx),
            actual: rest.slice(idx + 1),
        };
    }
    const parts = rest.split(':');
    return {
        expected: parts.slice(0, 2).join(':') || rest,
        actual: parts.slice(2).join(':') || '',
    };
}

function joinRemotePath(base, name) {
    const cleanBase = !base || base === '/' ? '' : base.replace(/\/+$/, '');
    return `${cleanBase}/${name}`;
}

function parentRemotePath(path) {
    if (!path || path === '/') return '/';
    const trimmed = path.replace(/\/+$/, '');
    const idx = trimmed.lastIndexOf('/');
    if (idx <= 0) return '/';
    return trimmed.slice(0, idx);
}

const MetricBar = ({ label, value, totalText }) => {
    const hasVal = typeof value === 'number' && Number.isFinite(value);
    const pct = hasVal ? Math.max(0, Math.min(100, Math.round(value))) : 0;
    const barColor =
        pct >= 90 ? 'var(--danger)' : pct >= 75 ? 'var(--warning)' : 'var(--primary)';
    const segments = 10;
    const activeCount = hasVal ? Math.round((pct / 100) * segments) : 0;

    return (
        <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[11px]">
                <span className="text-[var(--text-secondary)]">
                    {label}
                    {totalText ? ` (${totalText})` : ''}
                </span>
                <span className="font-mono font-semibold text-[var(--text-primary)]">
                    {hasVal ? `${pct}%` : '-'}
                </span>
            </div>
            <div className="gm-pixel-meter" aria-hidden="true">
                {Array.from({ length: segments }).map((_, idx) => (
                    <span
                        key={idx}
                        className="gm-pixel-meter-seg"
                        style={
                            idx < activeCount
                                ? { background: barColor, opacity: 0.92 }
                                : undefined
                        }
                    />
                ))}
            </div>
        </div>
    );
};

const looksLikePublicSshKey = (text) => {
    const trimmed = String(text || '').trim();
    return /^(ssh-(ed25519|rsa|dss)|ecdsa-sha2-|sk-ssh-)/i.test(trimmed);
};

const ServersView = ({
    fxRate = DEFAULT_USD_CNY_RATE,
    onNotify,
    onOverviewChanged,
    onOpenTerminal,
    onOpenSystemSettings,
}) => {
    const [servers, setServers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState('all');
    const [probingIds, setProbingIds] = useState({});
    const [probingAll, setProbingAll] = useState(false);
    const [monitorMinutes, setMonitorMinutes] = useState(5);

    // 新增 / 编辑弹窗
    const [formOpen, setFormOpen] = useState(false);
    const [editingId, setEditingId] = useState(null);
    const [form, setForm] = useState(EMPTY_SERVER_FORM);
    const [showCred, setShowCred] = useState(false);
    const [saving, setSaving] = useState(false);

    // 主机指纹变更重置弹窗
    const [fpResetTarget, setFpResetTarget] = useState(null); // { server, expected, actual }
    const [fpConfirmText, setFpConfirmText] = useState('');
    const [fpResetting, setFpResetting] = useState(false);

    // 端口与容器抽屉
    const [servicesDrawerServer, setServicesDrawerServer] = useState(null);

    // SFTP 文件浏览器弹窗
    const [sftpServer, setSftpServer] = useState(null);
    const [sftpPath, setSftpPath] = useState('.');
    const [sftpPathInput, setSftpPathInput] = useState('.');
    const [sftpEntries, setSftpEntries] = useState([]);
    const [sftpTruncated, setSftpTruncated] = useState(false);
    const [sftpLoading, setSftpLoading] = useState(false);
    const [sftpBusy, setSftpBusy] = useState(false);
    const [mkdirName, setMkdirName] = useState('');
    const [showMkdirInput, setShowMkdirInput] = useState(false);

    const serversRef = useRef([]);
    useEffect(() => {
        serversRef.current = servers;
    }, [servers]);

    const loadServers = useCallback(async () => {
        setLoading(true);
        try {
            const [res, settingsRes] = await Promise.all([
                api.getServers(),
                typeof api.getAppMonitorSettings === 'function'
                    ? api.getAppMonitorSettings()
                    : Promise.resolve({ success: false }),
            ]);
            if (res.success && Array.isArray(res.data)) {
                setServers(res.data);
            }
            if (settingsRes?.success && settingsRes.data) {
                setMonitorMinutes(settingsRes.data.serverMonitorMinutes ?? 5);
            }
        } catch (err) {
            onNotify?.(`加载服务器列表失败: ${err?.message || err}`, 'error');
        } finally {
            setLoading(false);
        }
    }, [onNotify]);

    useEffect(() => {
        loadServers();
    }, [loadServers]);

    const handleProbeOne = useCallback(
        async (server, { silent = false } = {}) => {
            setProbingIds(prev => ({ ...prev, [server.id]: true }));
            try {
                const res = await api.probeServer(server.id);
                if (res.success && res.data) {
                    setServers(prev => prev.map(item => (item.id === server.id ? res.data : item)));
                    setServicesDrawerServer(prev =>
                        prev && prev.id === server.id ? res.data : prev,
                    );
                    if (!silent) {
                        if (res.data.status === 'online') {
                            onNotify?.(`${server.name} 探测成功`);
                        } else {
                            onNotify?.(`${server.name} 离线：${res.data.probeError || '连接失败'}`, 'error');
                        }
                    }
                    return;
                }
                const mismatch = parseHostKeyMismatch(res.message);
                if (mismatch) {
                    await loadServers();
                    if (!silent) {
                        setFpResetTarget({
                            server,
                            expected: mismatch.expected,
                            actual: mismatch.actual,
                        });
                        setFpConfirmText('');
                    }
                    return;
                }
                if (!silent) {
                    onNotify?.(res.message || `探测 ${server.name} 失败`, 'error');
                }
            } finally {
                setProbingIds(prev => {
                    const next = { ...prev };
                    delete next[server.id];
                    return next;
                });
            }
        },
        [loadServers, onNotify],
    );

    const handleProbeAll = useCallback(
        async ({ silent = false, onlyCollectEnabled = false } = {}) => {
            const targets = (onlyCollectEnabled
                ? serversRef.current.filter(s => s.collectEnabled)
                : serversRef.current);
            if (targets.length === 0) return;
            setProbingAll(true);
            try {
                // 限制并发度为 2，避免同时握手过多占用连接
                let cursor = 0;
                const worker = async () => {
                    while (cursor < targets.length) {
                        const target = targets[cursor++];
                        await handleProbeOne(target, { silent: true });
                    }
                };
                await Promise.all([worker(), worker()]);
                if (!silent) {
                    onNotify?.(`已完成 ${targets.length} 台服务器探测`);
                }
            } finally {
                setProbingAll(false);
            }
        },
        [handleProbeOne, onNotify],
    );

    // 周期采集定时器：页面隐藏时自动跳过
    useEffect(() => {
        if (!monitorMinutes || monitorMinutes <= 0) return undefined;
        const intervalMs = monitorMinutes * 60 * 1000;
        const timer = setInterval(() => {
            if (typeof document !== 'undefined' && document.hidden) return;
            handleProbeAll({ silent: true, onlyCollectEnabled: true });
        }, intervalMs);
        return () => clearInterval(timer);
    }, [monitorMinutes, handleProbeAll]);

    const openCreateModal = () => {
        setEditingId(null);
        setForm(EMPTY_SERVER_FORM);
        setShowCred(false);
        setFormOpen(true);
    };

    const openEditModal = (server) => {
        setEditingId(server.id);
        setForm({
            name: server.name || '',
            host: server.host || '',
            port: String(server.port || 22),
            username: server.username || 'root',
            authKind: server.authKind === 'key' ? 'key' : 'password',
            credential: server.credential || '',
            passphrase: server.passphrase || '',
            region: server.region || '',
            collectEnabled: server.collectEnabled !== false,
            billingAmount: server.billingAmount ?? '',
            billingCurrency: server.billingCurrency || 'USD',
            billingCycle: server.billingCycle || 'month',
            expiresAt: server.expiresAt || '',
            tags: server.tags || '',
            notes: server.notes || '',
        });
        setShowCred(false);
        setFormOpen(true);
    };

    const handleImportPrivateKeyFile = async () => {
        try {
            const selected = await openFileDialog({
                title: '选择 SSH 私钥文件',
                multiple: false,
            });
            if (!selected || Array.isArray(selected)) return;
            const res = await api.readTextFile(selected);
            if (!res.success) {
                onNotify?.(res.message || '读取私钥文件失败', 'error');
                return;
            }
            setForm(prev => ({ ...prev, authKind: 'key', credential: res.data || '' }));
            onNotify?.('已导入私钥内容');
        } catch (err) {
            onNotify?.(err?.message || '读取私钥文件失败', 'error');
        }
    };

    const handleSaveServer = async (e) => {
        e.preventDefault();
        if (!form.name.trim() || !form.host.trim()) {
            onNotify?.('请填写服务器名称与主机地址', 'error');
            return;
        }
        const portNum = Number.parseInt(form.port, 10);
        if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
            onNotify?.('SSH 端口必须为 1-65535 的整数', 'error');
            return;
        }
        const payload = {
            name: form.name.trim(),
            host: form.host.trim(),
            port: portNum,
            username: form.username.trim() || 'root',
            authKind: form.authKind === 'key' ? 'key' : 'password',
            credential: form.credential || null,
            passphrase: form.passphrase || null,
            region: form.region.trim() || null,
            collectEnabled: Boolean(form.collectEnabled),
            billingAmount: form.billingAmount === '' ? null : Number(form.billingAmount),
            billingCurrency: form.billingCurrency || 'USD',
            billingCycle: form.billingCycle || 'month',
            expiresAt: form.expiresAt.trim() || null,
            tags: form.tags.trim() || null,
            notes: form.notes.trim() || null,
        };
        setSaving(true);
        try {
            const res = editingId
                ? await api.updateServer(editingId, payload)
                : await api.createServer(payload);
            if (!res.success) {
                onNotify?.(res.message || '保存服务器失败', 'error');
                return;
            }
            setFormOpen(false);
            await loadServers();
            onOverviewChanged?.();
            onNotify?.(editingId ? '服务器配置已更新' : '服务器已添加');
        } finally {
            setSaving(false);
        }
    };

    const handleToggleCollect = async (server) => {
        const res = await api.updateServer(server.id, {
            name: server.name,
            host: server.host,
            port: server.port,
            username: server.username,
            authKind: server.authKind,
            credential: server.credential,
            passphrase: server.passphrase,
            region: server.region,
            os: server.os,
            kernel: server.kernel,
            collectEnabled: !server.collectEnabled,
            billingAmount: server.billingAmount,
            billingCurrency: server.billingCurrency,
            billingCycle: server.billingCycle,
            expiresAt: server.expiresAt,
            tags: server.tags,
            notes: server.notes,
        });
        if (res.success && res.data) {
            setServers(prev => prev.map(item => (item.id === server.id ? res.data : item)));
            onNotify?.(res.data.collectEnabled ? '已启用定期采集' : '已暂停定期采集');
        } else {
            onNotify?.(res.message || '切换采集状态失败', 'error');
        }
    };

    const handleDeleteServer = async (server) => {
        const ok = await confirmDialog(
            `确定要删除服务器 "${server.name}" (${server.host}:${server.port}) 吗？`,
            { title: '删除服务器', okLabel: '删除', cancelLabel: '取消', kind: 'warning' },
        );
        if (!ok) return;
        const res = await api.deleteServer(server.id);
        if (!res.success) {
            onNotify?.(res.message || '删除服务器失败', 'error');
            return;
        }
        setServers(prev => prev.filter(item => item.id !== server.id));
        onOverviewChanged?.();
        onNotify?.('服务器已删除');
    };

    const handleConfirmFingerprintReset = async (e) => {
        e.preventDefault();
        if (!fpResetTarget) return;
        const expectedText = `${fpResetTarget.server.host}:${fpResetTarget.server.port}`;
        if (fpConfirmText.trim() !== expectedText) {
            onNotify?.(`请输入完整的 ${expectedText} 以确认重置`, 'error');
            return;
        }
        setFpResetting(true);
        try {
            const res = await api.resetServerHostFingerprint(fpResetTarget.server.id);
            if (!res.success || !res.data) {
                onNotify?.(res.message || '重置指纹失败', 'error');
                return;
            }
            setServers(prev => prev.map(s => (s.id === res.data.id ? res.data : s)));
            const target = res.data;
            setFpResetTarget(null);
            onNotify?.('已清除旧指纹，正在重新校验连接…');
            await handleProbeOne(target);
        } finally {
            setFpResetting(false);
        }
    };

    // ─── SFTP 操作 ────────────────────────────────────────────────
    const loadSftpDir = useCallback(
        async (server, path = '.') => {
            setSftpLoading(true);
            try {
                const res = await api.sftpListDir(server.id, path);
                if (!res.success || !res.data) {
                    const mismatch = parseHostKeyMismatch(res.message);
                    if (mismatch) {
                        setFpResetTarget({
                            server,
                            expected: mismatch.expected,
                            actual: mismatch.actual,
                        });
                        setFpConfirmText('');
                    }
                    onNotify?.(res.message || '读取远端目录失败', 'error');
                    return false;
                }
                setSftpPath(res.data.path);
                setSftpPathInput(res.data.path);
                setSftpEntries(res.data.entries || []);
                setSftpTruncated(Boolean(res.data.truncated));
                return true;
            } finally {
                setSftpLoading(false);
            }
        },
        [onNotify],
    );

    const openSftpBrowser = async (server) => {
        setSftpServer(server);
        setSftpEntries([]);
        setShowMkdirInput(false);
        setMkdirName('');
        await loadSftpDir(server, '.');
    };

    const handleSftpDownload = async (entry) => {
        if (!sftpServer) return;
        try {
            const savePath = await saveFileDialog({
                title: `下载 ${entry.name}`,
                defaultPath: entry.name,
            });
            if (!savePath) return;
            setSftpBusy(true);
            const remote = joinRemotePath(sftpPath, entry.name);
            const res = await api.sftpDownloadFile(sftpServer.id, remote, savePath);
            if (res.success) {
                onNotify?.(`已下载 ${entry.name} (${formatBytes(res.data)})`);
            } else {
                onNotify?.(res.message || '下载失败', 'error');
            }
        } finally {
            setSftpBusy(false);
        }
    };

    const handleSftpUpload = async () => {
        if (!sftpServer) return;
        try {
            const localPath = await openFileDialog({
                title: '选择要上传的本地文件',
                multiple: false,
            });
            if (!localPath || Array.isArray(localPath)) return;
            const fileName = localPath.split(/[\\/]/).pop() || 'upload.bin';
            const remote = joinRemotePath(sftpPath, fileName);
            setSftpBusy(true);
            const res = await api.sftpUploadFile(sftpServer.id, localPath, remote);
            if (res.success) {
                onNotify?.(`已上传 ${fileName} (${formatBytes(res.data)})`);
                await loadSftpDir(sftpServer, sftpPath);
            } else {
                onNotify?.(res.message || '上传失败', 'error');
            }
        } finally {
            setSftpBusy(false);
        }
    };

    const handleSftpMkdir = async (e) => {
        e.preventDefault();
        if (!sftpServer) return;
        const name = mkdirName.trim();
        if (!name || name.includes('/')) {
            onNotify?.('请输入有效的新目录名称（不能含 /）', 'error');
            return;
        }
        setSftpBusy(true);
        try {
            const res = await api.sftpMkdir(sftpServer.id, joinRemotePath(sftpPath, name));
            if (res.success) {
                setShowMkdirInput(false);
                setMkdirName('');
                onNotify?.(`已创建目录 ${name}`);
                await loadSftpDir(sftpServer, sftpPath);
            } else {
                onNotify?.(res.message || '创建目录失败', 'error');
            }
        } finally {
            setSftpBusy(false);
        }
    };

    const handleSftpRemove = async (entry) => {
        if (!sftpServer) return;
        const ok = await confirmDialog(
            `确定要删除远端${entry.isDir ? '目录' : '文件'} "${entry.name}" 吗？此操作不可撤销。`,
            { title: '删除远端文件', okLabel: '删除', cancelLabel: '取消', kind: 'warning' },
        );
        if (!ok) return;
        setSftpBusy(true);
        try {
            const res = await api.sftpRemove(
                sftpServer.id,
                joinRemotePath(sftpPath, entry.name),
                Boolean(entry.isDir),
            );
            if (res.success) {
                onNotify?.(`已删除 ${entry.name}`);
                await loadSftpDir(sftpServer, sftpPath);
            } else {
                onNotify?.(res.message || '删除失败', 'error');
            }
        } finally {
            setSftpBusy(false);
        }
    };

    const filteredServers = useMemo(() => {
        const kw = search.trim().toLowerCase();
        return servers.filter(s => {
            if (statusFilter !== 'all' && s.status !== statusFilter) return false;
            if (!kw) return true;
            return [s.name, s.host, s.region, s.os, s.tags, s.notes]
                .filter(Boolean)
                .some(v => String(v).toLowerCase().includes(kw));
        });
    }, [servers, search, statusFilter]);

    const summary = useMemo(() => {
        let online = 0;
        let monthlyCny = 0;
        let yearlyCny = 0;
        let usdCount = 0;
        for (const s of servers) {
            if (s.status === 'online') online += 1;
            const amt = Number(s.billingAmount);
            if (!Number.isFinite(amt) || amt <= 0) continue;
            if (s.billingCurrency === 'USD') usdCount += 1;
            const cnyAmt = convertToCny(amt, s.billingCurrency, fxRate) || 0;
            if (s.billingCycle === 'month') {
                monthlyCny += cnyAmt;
                yearlyCny += cnyAmt * 12;
            } else if (s.billingCycle === 'year') {
                monthlyCny += cnyAmt / 12;
                yearlyCny += cnyAmt;
            }
        }
        return {
            total: servers.length,
            online,
            usdCount,
            monthlyCny: Math.round(monthlyCny * 100) / 100,
            yearlyCny: Math.round(yearlyCny * 100) / 100,
        };
    }, [servers, fxRate]);

    const drawerServices = useMemo(
        () => (servicesDrawerServer ? parseServicesJson(servicesDrawerServer.servicesJson) : null),
        [servicesDrawerServer],
    );

    return (
        <div className="max-w-7xl mx-auto space-y-5 gm-view-enter">
            {/* 顶部操作栏 */}
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h1 className="gm-title flex items-center gap-2">
                        <Server size={20} className="text-[var(--primary)]" />
                        服务器台账与监控
                    </h1>
                    <p className="gm-subtitle">
                        通过纯 Rust SSH 采集系统负载、监听端口与 Docker 状态，支持 TOFU 主机指纹校验与 SFTP 文件管理。
                    </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <button
                        type="button"
                        className="gm-btn gm-btn-ghost text-xs"
                        onClick={() => onOpenSystemSettings?.('monitor')}
                        title="调整服务器采集周期"
                    >
                        <Activity size={14} />
                        {monitorMinutes > 0 ? `自动采集：每 ${monitorMinutes} 分钟` : '自动采集：已关闭'}
                    </button>
                    <button
                        type="button"
                        className="gm-btn gm-btn-ghost"
                        onClick={() => handleProbeAll()}
                        disabled={probingAll || servers.length === 0}
                    >
                        <RefreshCw size={15} className={probingAll ? 'animate-spin' : ''} />
                        全部探测
                    </button>
                    <button type="button" className="gm-btn gm-btn-primary" onClick={openCreateModal}>
                        <Plus size={15} />
                        新增服务器
                    </button>
                </div>
            </div>

            {/* 概览卡片（统一人民币结算） */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <div className="gm-card gm-pixel-card p-4">
                    <div className="text-xs text-[var(--text-secondary)]">服务器总数</div>
                    <div className="mt-1 text-2xl font-bold font-mono text-[var(--text-primary)]">{summary.total}</div>
                </div>
                <div className="gm-card gm-pixel-card p-4">
                    <div className="text-xs text-[var(--text-secondary)] flex items-center gap-1.5">
                        <span className="gm-pixel-led is-success" aria-hidden="true" />
                        <span>在线节点</span>
                    </div>
                    <div className="mt-1 text-2xl font-bold font-mono text-[var(--success)]">{summary.online}</div>
                </div>
                <div className="gm-card gm-pixel-card p-4">
                    <div className="text-xs text-[var(--text-secondary)]">折合月支出（人民币）</div>
                    <div className="mt-1 text-2xl font-bold font-mono text-[var(--text-primary)]">
                        {formatCnyAmount(summary.monthlyCny)}
                    </div>
                </div>
                <div className="gm-card gm-pixel-card p-4">
                    <div className="text-xs text-[var(--text-secondary)]">折合年支出（人民币）</div>
                    <div className="mt-1 text-2xl font-bold font-mono text-[var(--primary)]">
                        {formatCnyAmount(summary.yearlyCny)}
                    </div>
                </div>
            </div>

            {/* 搜索与筛选 */}
            <div className="gm-card p-3 flex flex-wrap items-center gap-3">
                <div className="relative flex-1 min-w-[220px]">
                    <Search
                        size={15}
                        className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"
                    />
                    <input
                        type="text"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder="按名称、IP、区域、标签搜索..."
                        className="gm-input w-full pl-9"
                    />
                </div>
                <div className="flex items-center gap-1.5">
                    {[
                        { id: 'all', label: '全部' },
                        { id: 'online', label: '在线' },
                        { id: 'offline', label: '离线' },
                        { id: 'unknown', label: '未探测' },
                    ].map(tab => (
                        <button
                            key={tab.id}
                            type="button"
                            onClick={() => setStatusFilter(tab.id)}
                            className={`gm-btn text-xs ${
                                statusFilter === tab.id ? 'gm-btn-primary' : 'gm-btn-ghost'
                            }`}
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* 服务器卡片列表 */}
            {loading ? (
                <div className="gm-card p-8 text-center text-[var(--text-secondary)]">正在加载服务器列表...</div>
            ) : filteredServers.length === 0 ? (
                <div className="gm-card p-10 text-center space-y-2">
                    <Server size={28} className="mx-auto text-[var(--text-muted)]" />
                    <div className="font-medium text-[var(--text-primary)]">暂无符合条件的服务器</div>
                    <p className="text-xs text-[var(--text-secondary)]">
                        点击右上角「新增服务器」即可接入 VPS 监控、多标签终端与 SFTP。
                    </p>
                </div>
            ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {filteredServers.map(server => {
                        const isProbing = Boolean(probingIds[server.id]);
                        const mismatch = parseHostKeyMismatch(server.probeError);
                        const days = server.expiresAt ? daysUntilDay(server.expiresAt) : null;
                        const dueBadge = days !== null ? formatDaysBadge(days) : null;
                        const services = parseServicesJson(server.servicesJson);
                        const dotColor =
                            server.status === 'online'
                                ? 'var(--success)'
                                : server.status === 'offline'
                                    ? 'var(--danger)'
                                    : 'var(--text-muted)';

                        return (
                            <div key={server.id} className="gm-card p-4 space-y-3">
                                <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <span
                                                className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                                                style={{ background: dotColor }}
                                                title={`状态: ${server.status}`}
                                            />
                                            <h3 className="font-semibold text-[var(--text-primary)] truncate">
                                                {server.name}
                                            </h3>
                                            {server.region && (
                                                <span className="gm-badge text-[11px]">{server.region}</span>
                                            )}
                                            <span className="gm-badge text-[11px]">
                                                {server.authKind === 'key' ? '私钥' : '密码'}
                                            </span>
                                            {dueBadge && (
                                                <span
                                                    className="gm-badge text-[11px]"
                                                    style={{
                                                        background:
                                                            dueBadge.tone === 'danger'
                                                                ? 'var(--danger-soft)'
                                                                : dueBadge.tone === 'warning'
                                                                    ? 'var(--warning-soft)'
                                                                    : 'var(--bg-elevated)',
                                                        color:
                                                            dueBadge.tone === 'danger'
                                                                ? 'var(--danger)'
                                                                : dueBadge.tone === 'warning'
                                                                    ? 'var(--warning)'
                                                                    : 'var(--text-secondary)',
                                                    }}
                                                >
                                                    {dueBadge.text}
                                                </span>
                                            )}
                                        </div>
                                        <div className="mt-1 text-xs font-mono text-[var(--text-secondary)]">
                                            {server.username}@{server.host}:{server.port}
                                        </div>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => handleToggleCollect(server)}
                                        className={`gm-btn text-[11px] px-2 py-1 ${
                                            server.collectEnabled ? 'gm-btn-ghost' : 'gm-btn-ghost opacity-60'
                                        }`}
                                        title={server.collectEnabled ? '定期采集中（点击暂停）' : '已暂停定期采集（点击启用）'}
                                    >
                                        <Power size={12} />
                                        {server.collectEnabled ? '定期采集' : '已暂停'}
                                    </button>
                                </div>

                                {(server.os || server.uptime || server.loadavg) && (
                                    <div className="text-xs text-[var(--text-secondary)] flex flex-wrap gap-x-4 gap-y-1">
                                        {server.os && <span>系统: {server.os}</span>}
                                        {server.uptime && <span>运行: {server.uptime}</span>}
                                        {server.loadavg && <span className="font-mono">负载: {server.loadavg}</span>}
                                    </div>
                                )}

                                <div className="grid grid-cols-3 gap-3">
                                    <MetricBar label="CPU" value={server.cpu} />
                                    <MetricBar
                                        label="内存"
                                        value={server.memory}
                                        totalText={formatKbSize(server.memTotalKb)}
                                    />
                                    <MetricBar
                                        label="磁盘"
                                        value={server.disk}
                                        totalText={formatKbSize(server.diskTotalKb)}
                                    />
                                </div>

                                {server.probeError && (
                                    <div
                                        className="rounded-lg px-3 py-2 text-xs flex items-center justify-between gap-2"
                                        style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}
                                    >
                                        <div className="flex items-center gap-1.5 min-w-0">
                                            <ShieldAlert size={14} className="shrink-0" />
                                            <span className="truncate">
                                                {mismatch
                                                    ? `主机指纹已变更 (${mismatch.actual})`
                                                    : server.probeError}
                                            </span>
                                        </div>
                                        {mismatch && (
                                            <button
                                                type="button"
                                                className="gm-btn gm-btn-ghost text-xs shrink-0"
                                                onClick={() => {
                                                    setFpResetTarget({
                                                        server,
                                                        expected: mismatch.expected,
                                                        actual: mismatch.actual,
                                                    });
                                                    setFpConfirmText('');
                                                }}
                                            >
                                                重置指纹
                                            </button>
                                        )}
                                    </div>
                                )}

                                <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-[var(--border-subtle)] text-xs text-[var(--text-secondary)]">
                                    <div className="flex flex-wrap items-center gap-3">
                                        {server.billingAmount != null && (
                                            <span>
                                                费用: {formatMoney(server.billingAmount, server.billingCurrency)}/
                                                {formatCycleLabel(server.billingCycle)}
                                            </span>
                                        )}
                                        {server.probedAt && (
                                            <span>上次探测: {formatDbTimestamp(server.probedAt)}</span>
                                        )}
                                        {services && (
                                            <span>
                                                端口 {services.ports.length} · 容器 {services.containers.length}
                                            </span>
                                        )}
                                    </div>
                                    <div className="flex flex-wrap items-center gap-1.5">
                                        <button
                                            type="button"
                                            className="gm-btn gm-btn-primary text-xs px-2.5 py-1"
                                            onClick={() => onOpenTerminal?.(server)}
                                        >
                                            <Terminal size={13} />
                                            打开终端
                                        </button>
                                        <button
                                            type="button"
                                            className="gm-btn gm-btn-ghost text-xs px-2 py-1"
                                            onClick={() => openSftpBrowser(server)}
                                        >
                                            <FolderOpen size={13} />
                                            SFTP 文件
                                        </button>
                                        <button
                                            type="button"
                                            className="gm-btn gm-btn-ghost text-xs px-2 py-1"
                                            onClick={() => setServicesDrawerServer(server)}
                                        >
                                            <Network size={13} />
                                            端口与容器
                                        </button>
                                        <button
                                            type="button"
                                            className="gm-btn gm-btn-ghost text-xs px-2 py-1"
                                            onClick={() => handleProbeOne(server)}
                                            disabled={isProbing}
                                        >
                                            <RefreshCw size={13} className={isProbing ? 'animate-spin' : ''} />
                                            探测
                                        </button>
                                        <button
                                            type="button"
                                            className="gm-btn gm-btn-ghost text-xs px-2 py-1"
                                            onClick={() => openEditModal(server)}
                                            title="编辑服务器"
                                            aria-label={`编辑 ${server.name}`}
                                        >
                                            <Edit2 size={13} />
                                        </button>
                                        <button
                                            type="button"
                                            className="gm-btn gm-btn-ghost text-xs px-2 py-1 text-[var(--danger)]"
                                            onClick={() => handleDeleteServer(server)}
                                            title="删除服务器"
                                            aria-label={`删除 ${server.name}`}
                                        >
                                            <Trash2 size={13} />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* 新增 / 编辑服务器弹窗 */}
            {formOpen &&
                renderInBody(
                    <div className="gm-overlay" role="dialog" aria-modal="true" aria-label={editingId ? '编辑服务器' : '新增服务器'}>
                        <div className="gm-modal w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6 space-y-4">
                            <div className="flex items-center justify-between">
                                <h2 className="text-base font-semibold text-[var(--text-primary)]">
                                    {editingId ? '编辑服务器' : '新增服务器'}
                                </h2>
                                <button type="button" className="gm-btn gm-btn-ghost p-1" onClick={() => setFormOpen(false)}>
                                    <X size={16} />
                                </button>
                            </div>
                            <form onSubmit={handleSaveServer} className="space-y-3 text-xs">
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <label className="space-y-1">
                                        <span className="text-[var(--text-secondary)]">名称 *</span>
                                        <input
                                            className="gm-input w-full"
                                            value={form.name}
                                            onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))}
                                            placeholder="如：Tokyo 生产节点"
                                            required
                                        />
                                    </label>
                                    <label className="space-y-1">
                                        <span className="text-[var(--text-secondary)]">区域 / 节点说明</span>
                                        <input
                                            className="gm-input w-full"
                                            value={form.region}
                                            onChange={e => setForm(prev => ({ ...prev, region: e.target.value }))}
                                            placeholder="日本东京 / Oracle Cloud"
                                        />
                                    </label>
                                    <label className="space-y-1">
                                        <span className="text-[var(--text-secondary)]">主机 IP / 域名 *</span>
                                        <input
                                            className="gm-input w-full font-mono"
                                            value={form.host}
                                            onChange={e => setForm(prev => ({ ...prev, host: e.target.value }))}
                                            placeholder="203.0.113.10"
                                            required
                                        />
                                    </label>
                                    <div className="grid grid-cols-2 gap-2">
                                        <label className="space-y-1">
                                            <span className="text-[var(--text-secondary)]">SSH 端口</span>
                                            <input
                                                type="number"
                                                min={1}
                                                max={65535}
                                                className="gm-input w-full font-mono"
                                                value={form.port}
                                                onChange={e => setForm(prev => ({ ...prev, port: e.target.value }))}
                                            />
                                        </label>
                                        <label className="space-y-1">
                                            <span className="text-[var(--text-secondary)]">用户名</span>
                                            <input
                                                className="gm-input w-full font-mono"
                                                value={form.username}
                                                onChange={e => setForm(prev => ({ ...prev, username: e.target.value }))}
                                                placeholder="root"
                                            />
                                        </label>
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <label className="space-y-1">
                                        <span className="text-[var(--text-secondary)]">认证方式</span>
                                        <select
                                            className="gm-input w-full"
                                            value={form.authKind}
                                            onChange={e => setForm(prev => ({ ...prev, authKind: e.target.value }))}
                                        >
                                            <option value="password">密码认证</option>
                                            <option value="key">OpenSSH 私钥认证</option>
                                        </select>
                                    </label>
                                    {form.authKind === 'key' && (
                                        <label className="space-y-1">
                                            <span className="text-[var(--text-secondary)]">私钥口令（如未加密可留空）</span>
                                            <input
                                                type="password"
                                                className="gm-input w-full"
                                                value={form.passphrase}
                                                onChange={e => setForm(prev => ({ ...prev, passphrase: e.target.value }))}
                                                placeholder="可选"
                                            />
                                        </label>
                                    )}
                                </div>

                                {form.authKind === 'password' ? (
                                    <label className="block space-y-1">
                                        <span className="text-[var(--text-secondary)]">SSH 密码（明文存于本地 SQLite）</span>
                                        <div className="relative">
                                            <input
                                                type={showCred ? 'text' : 'password'}
                                                className="gm-input w-full pr-9 font-mono"
                                                value={form.credential}
                                                onChange={e => setForm(prev => ({ ...prev, credential: e.target.value }))}
                                                placeholder="输入 SSH 登录密码"
                                            />
                                            <button
                                                type="button"
                                                className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"
                                                onClick={() => setShowCred(v => !v)}
                                                aria-label={showCred ? '隐藏密码' : '显示密码'}
                                            >
                                                {showCred ? <EyeOff size={14} /> : <Eye size={14} />}
                                            </button>
                                        </div>
                                    </label>
                                ) : (
                                    <div className="space-y-1">
                                        <div className="flex items-center justify-between">
                                            <span className="text-[var(--text-secondary)]">SSH 私钥全文</span>
                                            <button
                                                type="button"
                                                className="gm-btn gm-btn-ghost text-xs py-0.5 px-2"
                                                onClick={handleImportPrivateKeyFile}
                                            >
                                                从文件导入私钥
                                            </button>
                                        </div>
                                        <textarea
                                            rows={4}
                                            className="gm-input w-full font-mono"
                                            value={form.credential}
                                            onChange={e => setForm(prev => ({ ...prev, credential: e.target.value }))}
                                            placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                                        />
                                        {looksLikePublicSshKey(form.credential) && (
                                            <div
                                                role="alert"
                                                className="flex items-start gap-2 rounded-md px-2.5 py-2 text-[11.5px]"
                                                style={{
                                                    background: 'var(--warning-soft)',
                                                    color: 'var(--warning)',
                                                    border: '1px solid rgba(251, 191, 36, 0.3)',
                                                }}
                                            >
                                                <ShieldAlert size={14} className="shrink-0 mt-0.5" />
                                                <span>
                                                    检测到您粘贴的似乎是 SSH 公钥（如 ssh-ed25519 / .pub）。连接服务器需要填写私钥文件（通常以 -----BEGIN OPENSSH PRIVATE KEY----- 开头）。
                                                </span>
                                            </div>
                                        )}
                                    </div>
                                )}

                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                    <label className="space-y-1">
                                        <span className="text-[var(--text-secondary)]">费用金额</span>
                                        <input
                                            type="number"
                                            step="0.01"
                                            min="0"
                                            className="gm-input w-full"
                                            value={form.billingAmount}
                                            onChange={e => setForm(prev => ({ ...prev, billingAmount: e.target.value }))}
                                            placeholder="如：5.00"
                                        />
                                    </label>
                                    <label className="space-y-1">
                                        <span className="text-[var(--text-secondary)]">币种</span>
                                        <select
                                            className="gm-input w-full"
                                            value={form.billingCurrency}
                                            onChange={e => setForm(prev => ({ ...prev, billingCurrency: e.target.value }))}
                                        >
                                            <option value="USD">USD</option>
                                            <option value="CNY">CNY</option>
                                        </select>
                                    </label>
                                    <label className="space-y-1">
                                        <span className="text-[var(--text-secondary)]">计费周期</span>
                                        <select
                                            className="gm-input w-full"
                                            value={form.billingCycle}
                                            onChange={e => setForm(prev => ({ ...prev, billingCycle: e.target.value }))}
                                        >
                                            <option value="month">按月</option>
                                            <option value="year">按年</option>
                                            <option value="once">一次性</option>
                                        </select>
                                    </label>
                                    <label className="space-y-1">
                                        <span className="text-[var(--text-secondary)]">到期日期</span>
                                        <input
                                            type="date"
                                            min={DATE_INPUT_MIN}
                                            max={DATE_INPUT_MAX}
                                            className="gm-input w-full"
                                            value={form.expiresAt}
                                            onChange={e => setForm(prev => ({
                                                ...prev,
                                                expiresAt: clampDateInputValue(e.target.value),
                                            }))}
                                            onBlur={e => setForm(prev => ({
                                                ...prev,
                                                expiresAt: finalizeDateInputValue(e.target.value),
                                            }))}
                                        />
                                    </label>
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <label className="space-y-1">
                                        <span className="text-[var(--text-secondary)]">标签</span>
                                        <input
                                            className="gm-input w-full"
                                            value={form.tags}
                                            onChange={e => setForm(prev => ({ ...prev, tags: e.target.value }))}
                                            placeholder="prod, blog"
                                        />
                                    </label>
                                    <label className="flex items-center gap-2 pt-5 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={form.collectEnabled}
                                            onChange={e => setForm(prev => ({ ...prev, collectEnabled: e.target.checked }))}
                                        />
                                        <span className="text-[var(--text-primary)]">纳入定期监控采集</span>
                                    </label>
                                </div>

                                <label className="block space-y-1">
                                    <span className="text-[var(--text-secondary)]">备注</span>
                                    <textarea
                                        rows={2}
                                        className="gm-input w-full"
                                        value={form.notes}
                                        onChange={e => setForm(prev => ({ ...prev, notes: e.target.value }))}
                                    />
                                </label>

                                <div className="flex justify-end gap-2 pt-2">
                                    <button type="button" className="gm-btn gm-btn-ghost" onClick={() => setFormOpen(false)}>
                                        取消
                                    </button>
                                    <button type="submit" className="gm-btn gm-btn-primary" disabled={saving}>
                                        {saving ? '保存中...' : '保存'}
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>,
                )}

            {/* 主机指纹变更重置确认弹窗 */}
            {fpResetTarget &&
                renderInBody(
                    <div className="gm-overlay" role="dialog" aria-modal="true" aria-label="重置服务器主机指纹">
                        <div className="gm-modal w-full max-w-lg p-6 space-y-4">
                            <div className="flex items-center justify-between">
                                <h2 className="text-base font-semibold text-[var(--danger)] flex items-center gap-2">
                                    <ShieldAlert size={18} />
                                    SSH 主机指纹已变更
                                </h2>
                                <button type="button" className="gm-btn gm-btn-ghost p-1" onClick={() => setFpResetTarget(null)}>
                                    <X size={16} />
                                </button>
                            </div>
                            <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                                服务器 <span className="font-mono text-[var(--text-primary)]">{fpResetTarget.server.host}:{fpResetTarget.server.port}</span> 返回的公钥指纹与此前首次信任（TOFU）记录的不一致。若您刚重装系统或更换了实例，可核对指纹后重置；否则请勿信任该连接。
                            </p>
                            <div className="rounded-lg p-3 bg-[var(--bg-elevated)] space-y-1.5 text-xs font-mono">
                                <div>此前记录：{fpResetTarget.expected || '未知'}</div>
                                <div className="text-[var(--danger)]">本次收到：{fpResetTarget.actual || '未知'}</div>
                            </div>
                            <form onSubmit={handleConfirmFingerprintReset} className="space-y-3">
                                <label className="block space-y-1 text-xs">
                                    <span className="text-[var(--text-secondary)]">
                                        请输入 <code className="font-mono text-[var(--text-primary)]">{fpResetTarget.server.host}:{fpResetTarget.server.port}</code> 以确认重置旧指纹：
                                    </span>
                                    <input
                                        className="gm-input w-full font-mono"
                                        value={fpConfirmText}
                                        onChange={e => setFpConfirmText(e.target.value)}
                                        placeholder={`${fpResetTarget.server.host}:${fpResetTarget.server.port}`}
                                    />
                                </label>
                                <div className="flex justify-end gap-2">
                                    <button type="button" className="gm-btn gm-btn-ghost" onClick={() => setFpResetTarget(null)}>
                                        取消
                                    </button>
                                    <button
                                        type="submit"
                                        className="gm-btn gm-btn-danger"
                                        disabled={
                                            fpResetting ||
                                            fpConfirmText.trim() !== `${fpResetTarget.server.host}:${fpResetTarget.server.port}`
                                        }
                                    >
                                        {fpResetting ? '重置中...' : '确认重置指纹'}
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>,
                )}

            {/* 端口与 Docker 容器只读详情抽屉 */}
            {servicesDrawerServer &&
                renderInBody(
                    <div className="gm-overlay" role="dialog" aria-modal="true" aria-label="端口与容器详情">
                        <div className="gm-modal w-full max-w-4xl max-h-[88vh] overflow-y-auto p-6 space-y-5">
                            <div className="flex items-center justify-between gap-3">
                                <div>
                                    <h2 className="text-base font-semibold text-[var(--text-primary)] flex items-center gap-2">
                                        <Network size={18} className="text-[var(--primary)]" />
                                        {servicesDrawerServer.name} — 监听端口与 Docker 容器
                                    </h2>
                                    <p className="text-xs text-[var(--text-secondary)] font-mono mt-0.5">
                                        {servicesDrawerServer.username}@{servicesDrawerServer.host}:{servicesDrawerServer.port}
                                        {servicesDrawerServer.probedAt
                                            ? ` · 采集于 ${formatDbTimestamp(servicesDrawerServer.probedAt)}`
                                            : ''}
                                    </p>
                                </div>
                                <div className="flex items-center gap-2">
                                    <button
                                        type="button"
                                        className="gm-btn gm-btn-ghost text-xs"
                                        onClick={() => handleProbeOne(servicesDrawerServer)}
                                        disabled={Boolean(probingIds[servicesDrawerServer.id])}
                                    >
                                        <RefreshCw
                                            size={13}
                                            className={probingIds[servicesDrawerServer.id] ? 'animate-spin' : ''}
                                        />
                                        立即刷新
                                    </button>
                                    <button
                                        type="button"
                                        className="gm-btn gm-btn-ghost p-1"
                                        onClick={() => setServicesDrawerServer(null)}
                                    >
                                        <X size={16} />
                                    </button>
                                </div>
                            </div>

                            {!drawerServices ? (
                                <div className="text-xs text-[var(--text-secondary)] py-6 text-center">
                                    暂无端口与容器数据，请点击「立即刷新」执行一次探测。
                                </div>
                            ) : (
                                <>
                                    {/* 监听端口表 */}
                                    <div className="space-y-2">
                                        <h3 className="text-xs font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
                                            <Cpu size={14} /> 监听端口 ({drawerServices.ports.length})
                                        </h3>
                                        {drawerServices.ports.length === 0 ? (
                                            <div className="text-xs text-[var(--text-secondary)]">未检测到监听端口</div>
                                        ) : (
                                            <div className="overflow-x-auto border border-[var(--border-subtle)] rounded-lg">
                                                <table className="w-full text-xs">
                                                    <thead>
                                                        <tr className="bg-[var(--bg-elevated)] text-left text-[var(--text-secondary)]">
                                                            <th className="px-3 py-2">协议</th>
                                                            <th className="px-3 py-2">端口</th>
                                                            <th className="px-3 py-2">暴露面</th>
                                                            <th className="px-3 py-2">监听地址</th>
                                                            <th className="px-3 py-2">进程 / PID</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody className="divide-y divide-[var(--border-subtle)]">
                                                        {drawerServices.ports.map((p, idx) => {
                                                            const exp = EXPOSURE_STYLE[p.exposure] || EXPOSURE_STYLE.private;
                                                            return (
                                                                <tr key={`${p.proto}-${p.port}-${idx}`}>
                                                                    <td className="px-3 py-1.5 font-mono uppercase">{p.proto}</td>
                                                                    <td className="px-3 py-1.5 font-mono font-semibold">{p.port}</td>
                                                                    <td className="px-3 py-1.5">
                                                                        <span
                                                                            className="gm-badge text-[11px]"
                                                                            style={{ background: exp.background, color: exp.color }}
                                                                        >
                                                                            {exp.label}
                                                                        </span>
                                                                    </td>
                                                                    <td className="px-3 py-1.5 font-mono">{p.address}</td>
                                                                    <td className="px-3 py-1.5 font-mono">
                                                                        {p.process ? `${p.process}${p.pid ? ` (${p.pid})` : ''}` : '-'}
                                                                    </td>
                                                                </tr>
                                                            );
                                                        })}
                                                    </tbody>
                                                </table>
                                            </div>
                                        )}
                                    </div>

                                    {/* Docker 容器表 */}
                                    <div className="space-y-2">
                                        <h3 className="text-xs font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
                                            <Box size={14} /> Docker 容器 ({drawerServices.containers.length})
                                        </h3>
                                        {!drawerServices.dockerAvailable ? (
                                            <div className="text-xs text-[var(--text-secondary)] rounded-lg bg-[var(--bg-elevated)] px-3 py-2">
                                                {drawerServices.dockerReason || 'Docker 不可用'}
                                            </div>
                                        ) : drawerServices.containers.length === 0 ? (
                                            <div className="text-xs text-[var(--text-secondary)]">暂无容器实例</div>
                                        ) : (
                                            <div className="overflow-x-auto border border-[var(--border-subtle)] rounded-lg">
                                                <table className="w-full text-xs">
                                                    <thead>
                                                        <tr className="bg-[var(--bg-elevated)] text-left text-[var(--text-secondary)]">
                                                            <th className="px-3 py-2">名称</th>
                                                            <th className="px-3 py-2">镜像</th>
                                                            <th className="px-3 py-2">状态</th>
                                                            <th className="px-3 py-2">CPU / 内存</th>
                                                            <th className="px-3 py-2">端口映射</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody className="divide-y divide-[var(--border-subtle)]">
                                                        {drawerServices.containers.map(c => {
                                                            const restartCount = c.restartCount ?? c.restart_count;
                                                            const memoryUsage = c.memoryUsage ?? c.memory_usage;
                                                            const ports = Array.isArray(c.ports) ? c.ports : [];
                                                            return (
                                                                <tr key={c.id || c.name}>
                                                                    <td className="px-3 py-1.5 font-medium">
                                                                        <div>{c.name}</div>
                                                                        {c.health && (
                                                                            <span className="text-[10px] text-[var(--text-secondary)]">
                                                                                健康: {c.health}
                                                                            </span>
                                                                        )}
                                                                    </td>
                                                                    <td className="px-3 py-1.5 font-mono max-w-[200px] truncate">
                                                                        {c.image}
                                                                    </td>
                                                                    <td className="px-3 py-1.5">
                                                                        <span
                                                                            className="gm-badge text-[11px]"
                                                                            style={{
                                                                                background:
                                                                                    c.state === 'running'
                                                                                        ? 'var(--success-soft)'
                                                                                        : 'var(--danger-soft)',
                                                                                color:
                                                                                    c.state === 'running'
                                                                                        ? 'var(--success)'
                                                                                        : 'var(--danger)',
                                                                            }}
                                                                        >
                                                                            {c.state}
                                                                        </span>
                                                                        {restartCount > 0 && (
                                                                            <span className="ml-1 text-[10px] text-[var(--text-secondary)]">
                                                                                重启 {restartCount} 次
                                                                            </span>
                                                                        )}
                                                                    </td>
                                                                    <td className="px-3 py-1.5 font-mono">
                                                                        {c.cpu != null ? `${c.cpu}%` : '-'} / {memoryUsage || '-'}
                                                                    </td>
                                                                    <td className="px-3 py-1.5 font-mono">
                                                                        {ports.length === 0
                                                                            ? '-'
                                                                            : ports
                                                                                  .map(p => {
                                                                                      const hp = p.hostPort ?? p.host_port;
                                                                                      const cp = p.containerPort ?? p.container_port;
                                                                                      return hp ? `${hp}->${cp}/${p.proto}` : `${cp}/${p.proto}`;
                                                                                  })
                                                                                  .join(', ')}
                                                                    </td>
                                                                </tr>
                                                            );
                                                        })}
                                                    </tbody>
                                                </table>
                                            </div>
                                        )}
                                    </div>
                                </>
                            )}
                        </div>
                    </div>,
                )}

            {/* SFTP 文件管理弹窗 */}
            {sftpServer &&
                renderInBody(
                    <div className="gm-overlay" role="dialog" aria-modal="true" aria-label="SFTP 文件管理">
                        <div className="gm-modal w-full max-w-4xl max-h-[88vh] flex flex-col p-6 space-y-4">
                            <div className="flex items-center justify-between gap-2">
                                <div>
                                    <h2 className="text-base font-semibold text-[var(--text-primary)] flex items-center gap-2">
                                        <HardDrive size={18} className="text-[var(--primary)]" />
                                        SFTP 文件管理 — {sftpServer.name}
                                    </h2>
                                    <p className="text-xs font-mono text-[var(--text-secondary)]">
                                        {sftpServer.username}@{sftpServer.host}:{sftpServer.port}
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    className="gm-btn gm-btn-ghost p-1"
                                    onClick={() => setSftpServer(null)}
                                >
                                    <X size={16} />
                                </button>
                            </div>

                            {/* 路径与操作栏 */}
                            <div className="flex flex-wrap items-center gap-2">
                                <button
                                    type="button"
                                    className="gm-btn gm-btn-ghost text-xs"
                                    onClick={() => loadSftpDir(sftpServer, parentRemotePath(sftpPath))}
                                    disabled={sftpLoading || sftpBusy || sftpPath === '/'}
                                    title="上一级目录"
                                >
                                    <ArrowUp size={14} />
                                    上级
                                </button>
                                <form
                                    className="flex-1 flex items-center gap-1.5 min-w-[200px]"
                                    onSubmit={e => {
                                        e.preventDefault();
                                        loadSftpDir(sftpServer, sftpPathInput.trim() || '.');
                                    }}
                                >
                                    <input
                                        className="gm-input w-full font-mono text-xs"
                                        value={sftpPathInput}
                                        onChange={e => setSftpPathInput(e.target.value)}
                                        aria-label="远端路径"
                                    />
                                    <button type="submit" className="gm-btn gm-btn-ghost text-xs shrink-0">
                                        前往
                                    </button>
                                </form>
                                <button
                                    type="button"
                                    className="gm-btn gm-btn-ghost text-xs"
                                    onClick={() => loadSftpDir(sftpServer, sftpPath)}
                                    disabled={sftpLoading || sftpBusy}
                                >
                                    <RefreshCw size={14} className={sftpLoading ? 'animate-spin' : ''} />
                                    刷新
                                </button>
                                <button
                                    type="button"
                                    className="gm-btn gm-btn-ghost text-xs"
                                    onClick={() => setShowMkdirInput(v => !v)}
                                    disabled={sftpBusy}
                                >
                                    <Plus size={14} />
                                    新建目录
                                </button>
                                <button
                                    type="button"
                                    className="gm-btn gm-btn-primary text-xs"
                                    onClick={handleSftpUpload}
                                    disabled={sftpBusy || sftpLoading}
                                >
                                    <Upload size={14} />
                                    上传文件
                                </button>
                            </div>

                            {showMkdirInput && (
                                <form onSubmit={handleSftpMkdir} className="flex items-center gap-2">
                                    <input
                                        className="gm-input flex-1 text-xs font-mono"
                                        placeholder="输入新目录名称..."
                                        value={mkdirName}
                                        onChange={e => setMkdirName(e.target.value)}
                                        autoFocus
                                    />
                                    <button type="submit" className="gm-btn gm-btn-primary text-xs" disabled={sftpBusy}>
                                        创建
                                    </button>
                                    <button
                                        type="button"
                                        className="gm-btn gm-btn-ghost text-xs"
                                        onClick={() => {
                                            setShowMkdirInput(false);
                                            setMkdirName('');
                                        }}
                                    >
                                        取消
                                    </button>
                                </form>
                            )}

                            {/* 文件列表 */}
                            <div className="flex-1 overflow-y-auto border border-[var(--border-subtle)] rounded-lg">
                                {sftpLoading ? (
                                    <div className="p-8 text-center text-xs text-[var(--text-secondary)]">
                                        正在读取远端目录...
                                    </div>
                                ) : sftpEntries.length === 0 ? (
                                    <div className="p-8 text-center text-xs text-[var(--text-secondary)]">
                                        当前目录为空
                                    </div>
                                ) : (
                                    <table className="w-full text-xs">
                                        <thead>
                                            <tr className="bg-[var(--bg-elevated)] text-left text-[var(--text-secondary)]">
                                                <th className="px-3 py-2">名称</th>
                                                <th className="px-3 py-2">大小</th>
                                                <th className="px-3 py-2 text-right">操作</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-[var(--border-subtle)]">
                                            {sftpEntries.map(entry => (
                                                <tr key={entry.name} className="hover:bg-[var(--bg-hover)]">
                                                    <td className="px-3 py-2">
                                                        {entry.isDir ? (
                                                            <button
                                                                type="button"
                                                                className="flex items-center gap-2 font-mono text-[var(--primary)] hover:underline"
                                                                onClick={() =>
                                                                    loadSftpDir(
                                                                        sftpServer,
                                                                        joinRemotePath(sftpPath, entry.name),
                                                                    )
                                                                }
                                                            >
                                                                <Folder size={14} />
                                                                {entry.name}/
                                                            </button>
                                                        ) : (
                                                            <span className="flex items-center gap-2 font-mono text-[var(--text-primary)]">
                                                                <FileIcon size={14} className="text-[var(--text-muted)]" />
                                                                {entry.name}
                                                            </span>
                                                        )}
                                                    </td>
                                                    <td className="px-3 py-2 font-mono text-[var(--text-secondary)]">
                                                        {entry.isDir ? '-' : formatBytes(entry.size)}
                                                    </td>
                                                    <td className="px-3 py-2 text-right space-x-1.5">
                                                        {!entry.isDir && (
                                                            <button
                                                                type="button"
                                                                className="gm-btn gm-btn-ghost text-xs px-2 py-1"
                                                                onClick={() => handleSftpDownload(entry)}
                                                                disabled={sftpBusy}
                                                            >
                                                                <Download size={12} />
                                                                下载
                                                            </button>
                                                        )}
                                                        <button
                                                            type="button"
                                                            className="gm-btn gm-btn-ghost text-xs px-2 py-1 text-[var(--danger)]"
                                                            onClick={() => handleSftpRemove(entry)}
                                                            disabled={sftpBusy}
                                                        >
                                                            <Trash2 size={12} />
                                                            删除
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                )}
                            </div>
                            {sftpTruncated && (
                                <p className="text-[11px] text-[var(--warning)]">
                                    目录条目超过 10,000 项，仅显示前 10,000 项。
                                </p>
                            )}
                        </div>
                    </div>,
                )}
        </div>
    );
};

export default ServersView;
