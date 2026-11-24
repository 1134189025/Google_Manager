import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    KeyRound,
    Folder,
    FolderPlus,
    Upload,
    Download,
    Eye,
    EyeOff,
    Copy,
    Plus,
    Search,
    Edit3,
    Trash2,
    ShieldCheck,
    X,
    ExternalLink,
} from 'lucide-react';
import api from '../services/api';
import { confirmDialog } from '../utils/dialogs';
import { renderInBody } from '../utils/portal';
import { resolveBrandIconUrl } from '../utils/brandIcons';
import { isTauriRuntime } from '../utils/tauriRuntime';
import {
    classifyCsvImportRows,
    exportVaultItemsToBrowserCsv,
    parseBrowserPasswordsCsv,
} from '../utils/passwordCsv';
import { localTodayDay } from '../utils/renewalUtils';

const KINDS = [
    { id: 'all', label: '全部类型' },
    { id: 'account', label: '网站账号' },
    { id: 'api', label: 'API Key' },
    { id: 'ssh', label: 'SSH 密钥' },
    { id: 'token', label: 'Token' },
    { id: 'password', label: '通用密码' },
];

const KIND_LABEL = {
    account: '网站账号',
    api: 'API Key',
    ssh: 'SSH 密钥',
    token: 'Token',
    password: '密码',
};

const EMPTY_FORM = {
    kind: 'account',
    name: '',
    url: '',
    username: '',
    secretValue: '',
    totpSecret: '',
    folderId: '',
    googleAccountId: '',
    tags: '',
    notes: '',
};

const VaultView = ({ googleAccounts = [], onNotify, onCopy, onOverviewChanged }) => {
    const [folders, setFolders] = useState([]);
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [selectedFolder, setSelectedFolder] = useState('all'); // 'all' | 'none' | number
    const [selectedKind, setSelectedKind] = useState('all');
    const [revealedIds, setRevealedIds] = useState({});
    const [totpMap, setTotpMap] = useState({});

    // 条目弹窗
    const [modalOpen, setModalOpen] = useState(false);
    const [editingId, setEditingId] = useState(null);
    const [form, setForm] = useState(EMPTY_FORM);
    const [saving, setSaving] = useState(false);

    // 文件夹弹窗
    const [newFolderName, setNewFolderName] = useState('');
    const [addingFolder, setAddingFolder] = useState(false);

    // CSV 导入弹窗
    const [csvModalOpen, setCsvModalOpen] = useState(false);
    const [csvRows, setCsvRows] = useState([]);
    const [csvError, setCsvError] = useState('');
    const [importingCsv, setImportingCsv] = useState(false);

    const loadAll = useCallback(async () => {
        setLoading(true);
        try {
            const [fRes, iRes] = await Promise.all([
                api.getVaultFolders(),
                api.getVaultItems(),
            ]);
            if (fRes.success && Array.isArray(fRes.data)) setFolders(fRes.data);
            if (iRes.success && Array.isArray(iRes.data)) setItems(iRes.data);
        } catch (err) {
            onNotify?.(err instanceof Error ? err.message : '加载密钥库失败', 'error');
        } finally {
            setLoading(false);
        }
    }, [onNotify]);

    useEffect(() => {
        loadAll();
    }, [loadAll]);

    // 筛选条目
    const filteredItems = useMemo(() => {
        const q = search.trim().toLowerCase();
        return items.filter(item => {
            if (selectedFolder === 'none' && item.folderId != null) return false;
            if (typeof selectedFolder === 'number' && item.folderId !== selectedFolder) return false;
            if (selectedKind !== 'all' && item.kind !== selectedKind) return false;
            if (!q) return true;
            return [item.name, item.url, item.username, item.tags, item.notes, item.googleAccountEmail]
                .some(v => String(v ?? '').toLowerCase().includes(q));
        });
    }, [items, selectedFolder, selectedKind, search]);

    // 定时刷新可见条目的 TOTP 动态码
    const refreshTotpCodes = useCallback(async (list) => {
        const withTotp = list.filter(i => i.totpSecret && String(i.totpSecret).trim());
        if (withTotp.length === 0) return;
        const entries = await Promise.all(
            withTotp.slice(0, 40).map(async item => {
                try {
                    const res = await api.generateTotp?.(item.totpSecret);
                    if (res && res.code) return [item.id, res];
                } catch {
                    // 忽略无效 TOTP
                }
                return null;
            }),
        );
        const next = {};
        for (const pair of entries) {
            if (pair) next[pair[0]] = pair[1];
        }
        setTotpMap(next);
    }, []);

    useEffect(() => {
        refreshTotpCodes(filteredItems);
        const timer = setInterval(() => {
            setTotpMap(prev => {
                const updated = {};
                let needRefresh = false;
                for (const [id, val] of Object.entries(prev)) {
                    const rem = Number(val.remaining ?? 0) - 1;
                    if (rem <= 0) needRefresh = true;
                    updated[id] = { ...val, remaining: rem > 0 ? rem : 30 };
                }
                if (needRefresh) {
                    refreshTotpCodes(filteredItems);
                }
                return updated;
            });
        }, 1000);
        return () => clearInterval(timer);
    }, [filteredItems, refreshTotpCodes]);

    const handleCopyValue = (value, label) => {
        if (!value) return;
        if (onCopy) {
            onCopy(value, label);
        } else {
            navigator.clipboard?.writeText?.(value);
            onNotify?.(`已复制 ${label}`);
        }
    };

    const handleCreateFolder = async (e) => {
        e.preventDefault();
        const name = newFolderName.trim();
        if (!name) return;
        const res = await api.createVaultFolder({ name });
        if (res.success) {
            setNewFolderName('');
            setAddingFolder(false);
            onNotify?.(`已创建文件夹「${name}」`);
            await loadAll();
        } else {
            onNotify?.(res.message || '创建文件夹失败', 'error');
        }
    };

    const handleDeleteFolder = async (folder) => {
        const ok = await confirmDialog(`删除文件夹「${folder.name}」？其中条目会转为「未分组」，不会删除。`, {
            title: '删除文件夹',
            kind: 'warning',
            okLabel: '删除',
        });
        if (!ok) return;
        const res = await api.deleteVaultFolder(folder.id);
        if (res.success) {
            if (selectedFolder === folder.id) setSelectedFolder('all');
            onNotify?.('已删除文件夹');
            await loadAll();
        } else {
            onNotify?.(res.message || '删除文件夹失败', 'error');
        }
    };

    const openCreateModal = () => {
        setEditingId(null);
        setForm({
            ...EMPTY_FORM,
            folderId: typeof selectedFolder === 'number' ? String(selectedFolder) : '',
            kind: selectedKind !== 'all' ? selectedKind : 'account',
        });
        setModalOpen(true);
    };

    const openEditModal = (item) => {
        setEditingId(item.id);
        setForm({
            kind: item.kind || 'account',
            name: item.name || '',
            url: item.url || '',
            username: item.username || '',
            secretValue: item.secretValue || '',
            totpSecret: item.totpSecret || '',
            folderId: item.folderId != null ? String(item.folderId) : '',
            googleAccountId: item.googleAccountId != null ? String(item.googleAccountId) : '',
            tags: item.tags || '',
            notes: item.notes || '',
        });
        setModalOpen(true);
    };

    const handleSaveItem = async (e) => {
        e.preventDefault();
        if (!form.name.trim()) {
            onNotify?.('请填写名称', 'error');
            return;
        }
        setSaving(true);
        try {
            const payload = {
                kind: form.kind,
                name: form.name.trim(),
                url: form.url.trim() || null,
                username: form.username.trim() || null,
                secretValue: form.secretValue || null,
                totpSecret: form.totpSecret.replace(/\s+/g, '') || null,
                folderId: form.folderId ? Number(form.folderId) : null,
                googleAccountId: form.googleAccountId ? Number(form.googleAccountId) : null,
                tags: form.tags.trim() || null,
                notes: form.notes.trim() || null,
            };
            const res = editingId
                ? await api.updateVaultItem(editingId, payload)
                : await api.createVaultItem(payload);
            if (res.success) {
                onNotify?.(editingId ? '条目已更新' : '条目已创建');
                setModalOpen(false);
                await loadAll();
                onOverviewChanged?.();
            } else {
                onNotify?.(res.message || '保存失败', 'error');
            }
        } finally {
            setSaving(false);
        }
    };

    const handleDeleteItem = async (item) => {
        const ok = await confirmDialog(`确定永久删除「${item.name}」吗？`, {
            title: '删除密钥条目',
            kind: 'warning',
            okLabel: '删除',
        });
        if (!ok) return;
        const res = await api.deleteVaultItem(item.id);
        if (res.success) {
            onNotify?.('已删除条目');
            await loadAll();
            onOverviewChanged?.();
        } else {
            onNotify?.(res.message || '删除失败', 'error');
        }
    };

    // Chrome / Edge CSV 导入
    const handlePickCsvFile = async () => {
        setCsvError('');
        if (!isTauriRuntime()) return;
        try {
            const { open } = await import('@tauri-apps/plugin-dialog');
            const selected = await open({
                multiple: false,
                filters: [{ name: 'CSV 文件', extensions: ['csv'] }],
            });
            if (!selected || typeof selected !== 'string') return;
            const res = await api.readTextFile(selected);
            if (!res.success) {
                setCsvError(res.message || '读取 CSV 文件失败');
                return;
            }
            handleParseCsvText(res.data);
        } catch (err) {
            setCsvError(err instanceof Error ? err.message : '选择 CSV 失败');
        }
    };

    const handleParseCsvText = (text) => {
        setCsvError('');
        try {
            const parsed = parseBrowserPasswordsCsv(text);
            const classified = classifyCsvImportRows(parsed, items);
            setCsvRows(classified);
        } catch (err) {
            setCsvRows([]);
            setCsvError(err instanceof Error ? err.message : '解析 CSV 失败');
        }
    };

    const handleConfirmCsvImport = async () => {
        const selected = csvRows.filter(r => r.selected);
        if (selected.length === 0) {
            onNotify?.('请至少选择一条记录', 'error');
            return;
        }
        setImportingCsv(true);
        try {
            const payload = selected.map(r => ({
                kind: 'account',
                name: r.name,
                url: r.url || null,
                username: r.username || null,
                secretValue: r.password || null,
                folderId: typeof selectedFolder === 'number' ? selectedFolder : null,
                notes: r.notes || null,
            }));
            const res = await api.batchImportVaultItems(payload);
            if (res.success) {
                onNotify?.(`成功导入 ${res.data?.createdCount ?? selected.length} 条账号记录`);
                setCsvModalOpen(false);
                setCsvRows([]);
                await loadAll();
                onOverviewChanged?.();
            } else {
                onNotify?.(res.message || '导入失败', 'error');
            }
        } finally {
            setImportingCsv(false);
        }
    };

    const handleExportCsv = async () => {
        const ok = await confirmDialog(
            '导出的 CSV 文件将包含明文密码！请妥善保管并在导入目标浏览器后及时删除。确定继续导出吗？',
            {
                title: '明文导出确认',
                kind: 'warning',
                okLabel: '确认导出',
            },
        );
        if (!ok) return;
        const csv = exportVaultItemsToBrowserCsv(filteredItems);
        const filename = `googlemanager-passwords-${localTodayDay()}.csv`;

        if (isTauriRuntime()) {
            try {
                const { save } = await import('@tauri-apps/plugin-dialog');
                const path = await save({
                    defaultPath: filename,
                    filters: [{ name: 'CSV 文件', extensions: ['csv'] }],
                });
                if (!path) return;
                const res = await api.writeTextFile(path, csv);
                if (res.success) {
                    onNotify?.(`密码 CSV 已导出至 ${res.data}`);
                } else {
                    onNotify?.(res.message || '导出失败', 'error');
                }
            } catch (err) {
                onNotify?.(err instanceof Error ? err.message : '导出失败', 'error');
            }
            return;
        }

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
        onNotify?.('已生成 CSV 下载');
    };

    const folderMap = useMemo(
        () => Object.fromEntries(folders.map(f => [f.id, f.name])),
        [folders],
    );

    return (
        <div className="max-w-6xl mx-auto space-y-5 gm-view-enter">
            {/* 页头 */}
            <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                    <h1 className="gm-title flex items-center gap-2">
                        <KeyRound size={20} style={{ color: 'var(--primary)' }} />
                        <span>账号与密钥</span>
                    </h1>
                    <p className="gm-subtitle mt-1">
                        管理网站账号、API Key、SSH 密钥、Token 与动态验证码，支持关联谷歌账号与 Chrome/Edge CSV 迁移。
                    </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <button
                        type="button"
                        onClick={() => {
                            setCsvRows([]);
                            setCsvError('');
                            setCsvModalOpen(true);
                        }}
                        className="gm-btn gm-btn-ghost"
                    >
                        <Upload size={14} />
                        <span>导入 CSV</span>
                    </button>
                    <button
                        type="button"
                        onClick={handleExportCsv}
                        className="gm-btn gm-btn-ghost"
                    >
                        <Download size={14} />
                        <span>导出 CSV</span>
                    </button>
                    <button
                        type="button"
                        onClick={openCreateModal}
                        className="gm-btn gm-btn-primary"
                    >
                        <Plus size={14} />
                        <span>新建条目</span>
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
                {/* 左侧文件夹栏 */}
                <aside className="lg:col-span-3 gm-card p-3 space-y-2 h-fit" aria-label="密钥文件夹">
                    <div className="flex items-center justify-between px-2 py-1">
                        <span className="text-[12px] font-semibold gm-text-2">文件夹</span>
                        <button
                            type="button"
                            onClick={() => setAddingFolder(v => !v)}
                            className="gm-btn gm-btn-ghost p-1"
                            title="新建文件夹"
                            aria-label="新建文件夹"
                        >
                            <FolderPlus size={14} />
                        </button>
                    </div>

                    {addingFolder && (
                        <form onSubmit={handleCreateFolder} className="flex gap-1.5 px-1 pb-1">
                            <input
                                type="text"
                                className="gm-input flex-1 text-[12px]"
                                value={newFolderName}
                                onChange={(e) => setNewFolderName(e.target.value)}
                                placeholder="文件夹名称"
                                maxLength={60}
                                autoFocus
                            />
                            <button type="submit" className="gm-btn gm-btn-primary gm-btn-sm">
                                创建
                            </button>
                        </form>
                    )}

                    <div className="space-y-1">
                        <button
                            type="button"
                            onClick={() => setSelectedFolder('all')}
                            className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-[13px] transition-colors ${
                                selectedFolder === 'all'
                                    ? 'bg-[var(--primary-light)] text-[var(--primary)] font-medium'
                                    : 'gm-text-2 hover:bg-[var(--bg-hover)]'
                            }`}
                        >
                            <span className="flex items-center gap-2">
                                <Folder size={14} />
                                <span>全部条目</span>
                            </span>
                            <span className="font-mono text-[11px]">{items.length}</span>
                        </button>

                        <button
                            type="button"
                            onClick={() => setSelectedFolder('none')}
                            className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-[13px] transition-colors ${
                                selectedFolder === 'none'
                                    ? 'bg-[var(--primary-light)] text-[var(--primary)] font-medium'
                                    : 'gm-text-2 hover:bg-[var(--bg-hover)]'
                            }`}
                        >
                            <span className="flex items-center gap-2">
                                <Folder size={14} />
                                <span>未分组</span>
                            </span>
                            <span className="font-mono text-[11px]">
                                {items.filter(i => i.folderId == null).length}
                            </span>
                        </button>

                        {folders.map(f => (
                            <div
                                key={f.id}
                                className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg text-[13px] transition-colors ${
                                    selectedFolder === f.id
                                        ? 'bg-[var(--primary-light)] text-[var(--primary)] font-medium'
                                        : 'gm-text-2 hover:bg-[var(--bg-hover)]'
                                }`}
                            >
                                <button
                                    type="button"
                                    onClick={() => setSelectedFolder(f.id)}
                                    className="flex-1 flex items-center gap-2 text-left min-w-0"
                                >
                                    <Folder size={14} className="shrink-0" />
                                    <span className="truncate">{f.name}</span>
                                </button>
                                <span className="font-mono text-[11px] mx-1.5">
                                    {items.filter(i => i.folderId === f.id).length}
                                </span>
                                <button
                                    type="button"
                                    onClick={() => handleDeleteFolder(f)}
                                    className="p-1 opacity-60 hover:opacity-100 hover:text-[var(--danger)]"
                                    aria-label={`删除文件夹 ${f.name}`}
                                >
                                    <Trash2 size={12} />
                                </button>
                            </div>
                        ))}
                    </div>
                </aside>

                {/* 右侧列表区 */}
                <div className="lg:col-span-9 space-y-4">
                    <div className="flex flex-wrap items-center gap-3">
                        <div className="relative flex-1 min-w-[200px]">
                            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 gm-text-3" />
                            <input
                                type="text"
                                className="gm-input w-full pl-9"
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                placeholder="搜索名称、网址、用户名、标签或关联谷歌账号…"
                            />
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                            {KINDS.map(k => (
                                <button
                                    key={k.id}
                                    type="button"
                                    onClick={() => setSelectedKind(k.id)}
                                    className={`px-2.5 py-1.5 rounded-lg text-[12px] font-medium transition-colors ${
                                        selectedKind === k.id
                                            ? 'bg-[var(--primary-light)] text-[var(--primary)]'
                                            : 'gm-card gm-text-2 hover:text-[var(--text-primary)]'
                                    }`}
                                >
                                    {k.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {filteredItems.length === 0 ? (
                        <div className="gm-card p-10 text-center text-[13px] gm-text-3">
                            {loading ? '正在加载条目…' : '当前筛选下暂无条目，可点击「新建条目」或「导入 CSV」'}
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                            {filteredItems.map(item => {
                                const revealed = Boolean(revealedIds[item.id]);
                                const totp = totpMap[item.id];
                                const iconUrl = resolveBrandIconUrl([item.name, item.url]);
                                return (
                                    <div key={item.id} className="gm-card p-4 space-y-3">
                                        <div className="flex items-start justify-between gap-2">
                                            <div className="flex items-center gap-2.5 min-w-0">
                                                {iconUrl ? (
                                                    <img
                                                        src={iconUrl}
                                                        alt=""
                                                        className="w-7 h-7 rounded-md object-contain bg-white/10 p-1 shrink-0"
                                                    />
                                                ) : (
                                                    <div className="w-7 h-7 rounded-md bg-[var(--bg-elevated)] flex items-center justify-center shrink-0">
                                                        <KeyRound size={14} className="gm-text-3" />
                                                    </div>
                                                )}
                                                <div className="min-w-0">
                                                    <div className="flex items-center gap-2">
                                                        <h3 className="text-[14px] font-semibold gm-text-1 truncate">
                                                            {item.name}
                                                        </h3>
                                                        <span className="gm-chip">{KIND_LABEL[item.kind] || item.kind}</span>
                                                    </div>
                                                    {item.url && (
                                                        <div className="text-[11.5px] gm-text-3 truncate flex items-center gap-1">
                                                            <span className="truncate">{item.url}</span>
                                                            {item.url.startsWith('https://') && (
                                                                <button
                                                                    type="button"
                                                                    onClick={() => api.openExternalUrl?.(item.url)}
                                                                    className="hover:text-[var(--primary)] shrink-0"
                                                                    title="在浏览器打开"
                                                                >
                                                                    <ExternalLink size={11} />
                                                                </button>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-1 shrink-0">
                                                <button
                                                    type="button"
                                                    onClick={() => openEditModal(item)}
                                                    className="gm-btn gm-btn-ghost p-1.5"
                                                    aria-label={`编辑 ${item.name}`}
                                                >
                                                    <Edit3 size={13} />
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => handleDeleteItem(item)}
                                                    className="gm-btn gm-btn-ghost p-1.5 hover:text-[var(--danger)]"
                                                    aria-label={`删除 ${item.name}`}
                                                >
                                                    <Trash2 size={13} />
                                                </button>
                                            </div>
                                        </div>

                                        {item.username && (
                                            <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded bg-[var(--bg-elevated)] text-[12.5px]">
                                                <span className="gm-text-3 shrink-0">账号</span>
                                                <span className="font-mono gm-text-1 truncate flex-1 text-right">
                                                    {item.username}
                                                </span>
                                                <button
                                                    type="button"
                                                    onClick={() => handleCopyValue(item.username, '用户名')}
                                                    className="gm-text-3 hover:text-[var(--primary)] shrink-0"
                                                    title="复制用户名"
                                                >
                                                    <Copy size={12} />
                                                </button>
                                            </div>
                                        )}

                                        {item.secretValue && (
                                            <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded bg-[var(--bg-elevated)] text-[12.5px]">
                                                <span className="gm-text-3 shrink-0">密钥</span>
                                                <span className="font-mono gm-text-1 truncate flex-1 text-right">
                                                    {revealed ? item.secretValue : '••••••••••••'}
                                                </span>
                                                <button
                                                    type="button"
                                                    onClick={() =>
                                                        setRevealedIds(prev => ({ ...prev, [item.id]: !prev[item.id] }))
                                                    }
                                                    className="gm-text-3 hover:text-[var(--primary)] shrink-0"
                                                    aria-label={revealed ? `隐藏 ${item.name} 密钥` : `显示 ${item.name} 密钥`}
                                                >
                                                    {revealed ? <EyeOff size={12} /> : <Eye size={12} />}
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => handleCopyValue(item.secretValue, '密钥')}
                                                    className="gm-text-3 hover:text-[var(--primary)] shrink-0"
                                                    aria-label={`复制 ${item.name} 密钥`}
                                                >
                                                    <Copy size={12} />
                                                </button>
                                            </div>
                                        )}

                                        {item.totpSecret && (
                                            <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded bg-[var(--bg-elevated)] text-[12.5px]">
                                                <span className="flex items-center gap-1 gm-text-3">
                                                    <ShieldCheck size={12} style={{ color: 'var(--success)' }} />
                                                    <span>2FA</span>
                                                </span>
                                                <span className="font-mono font-semibold tracking-wider" style={{ color: 'var(--success)' }}>
                                                    {totp?.code || '------'}
                                                </span>
                                                <span className="font-mono text-[11px] gm-text-3">
                                                    {totp?.remaining ?? '--'}s
                                                </span>
                                                {totp?.code && (
                                                    <button
                                                        type="button"
                                                        onClick={() => handleCopyValue(totp.code, '2FA 验证码')}
                                                        className="gm-text-3 hover:text-[var(--primary)]"
                                                        title="复制验证码"
                                                    >
                                                        <Copy size={12} />
                                                    </button>
                                                )}
                                            </div>
                                        )}

                                        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                                            {item.folderId != null && folderMap[item.folderId] && (
                                                <span className="gm-chip">{folderMap[item.folderId]}</span>
                                            )}
                                            {item.googleAccountEmail && (
                                                <span className="gm-chip gm-chip-accent">
                                                    关联: {item.googleAccountEmail}
                                                </span>
                                            )}
                                            {item.tags && (
                                                <span className="gm-chip">{item.tags}</span>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>

            {/* 新建/编辑弹窗 */}
            {modalOpen && renderInBody(
                <div className="gm-overlay" role="dialog" aria-modal="true" aria-label={editingId ? '编辑密钥条目' : '新建密钥条目'}>
                    <div className="gm-panel w-full max-w-lg p-5 space-y-4 max-h-[90vh] overflow-y-auto">
                        <div className="flex items-center justify-between">
                            <h3 className="text-[15px] font-semibold gm-text-1">
                                {editingId ? '编辑条目' : '新建条目'}
                            </h3>
                            <button
                                type="button"
                                onClick={() => setModalOpen(false)}
                                className="gm-btn gm-btn-ghost p-1"
                                aria-label="关闭"
                            >
                                <X size={16} />
                            </button>
                        </div>

                        <form onSubmit={handleSaveItem} className="space-y-3">
                            <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-1">
                                    <label className="text-[12px] gm-text-2">类型</label>
                                    <select
                                        className="gm-input w-full"
                                        value={form.kind}
                                        onChange={(e) => setForm(prev => ({ ...prev, kind: e.target.value }))}
                                    >
                                        <option value="account">网站账号</option>
                                        <option value="api">API Key</option>
                                        <option value="ssh">SSH 密钥</option>
                                        <option value="token">Token</option>
                                        <option value="password">通用密码</option>
                                    </select>
                                </div>
                                <div className="space-y-1">
                                    <label className="text-[12px] gm-text-2">文件夹</label>
                                    <select
                                        className="gm-input w-full"
                                        value={form.folderId}
                                        onChange={(e) => setForm(prev => ({ ...prev, folderId: e.target.value }))}
                                    >
                                        <option value="">未分组</option>
                                        {folders.map(f => (
                                            <option key={f.id} value={f.id}>{f.name}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            <div className="space-y-1">
                                <label className="text-[12px] gm-text-2">名称 *</label>
                                <input
                                    type="text"
                                    className="gm-input w-full"
                                    value={form.name}
                                    onChange={(e) => setForm(prev => ({ ...prev, name: e.target.value }))}
                                    placeholder="例如：GitHub / OpenAI API Key"
                                    required
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-1">
                                    <label className="text-[12px] gm-text-2">登录网址</label>
                                    <input
                                        type="text"
                                        className="gm-input w-full"
                                        value={form.url}
                                        onChange={(e) => setForm(prev => ({ ...prev, url: e.target.value }))}
                                        placeholder="https://..."
                                    />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-[12px] gm-text-2">用户名 / ID</label>
                                    <input
                                        type="text"
                                        className="gm-input w-full"
                                        value={form.username}
                                        onChange={(e) => setForm(prev => ({ ...prev, username: e.target.value }))}
                                    />
                                </div>
                            </div>

                            <div className="space-y-1">
                                <label className="text-[12px] gm-text-2">密码 / 密钥 / 私钥内容</label>
                                <textarea
                                    rows={form.kind === 'ssh' ? 4 : 2}
                                    className="gm-input w-full font-mono text-[12px]"
                                    value={form.secretValue}
                                    onChange={(e) => setForm(prev => ({ ...prev, secretValue: e.target.value }))}
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-1">
                                    <label className="text-[12px] gm-text-2">2FA (TOTP) 密钥</label>
                                    <input
                                        type="text"
                                        className="gm-input w-full font-mono"
                                        value={form.totpSecret}
                                        onChange={(e) => setForm(prev => ({ ...prev, totpSecret: e.target.value }))}
                                        placeholder="Base32 密钥"
                                    />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-[12px] gm-text-2">关联谷歌账号</label>
                                    <select
                                        className="gm-input w-full"
                                        value={form.googleAccountId}
                                        onChange={(e) => setForm(prev => ({ ...prev, googleAccountId: e.target.value }))}
                                    >
                                        <option value="">不关联</option>
                                        {googleAccounts.map(acc => (
                                            <option key={acc.id} value={acc.id}>{acc.email}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            <div className="space-y-1">
                                <label className="text-[12px] gm-text-2">标签</label>
                                <input
                                    type="text"
                                    className="gm-input w-full"
                                    value={form.tags}
                                    onChange={(e) => setForm(prev => ({ ...prev, tags: e.target.value }))}
                                    placeholder="逗号分隔，例如：开发, 常用"
                                />
                            </div>

                            <div className="space-y-1">
                                <label className="text-[12px] gm-text-2">备注</label>
                                <textarea
                                    rows={2}
                                    className="gm-input w-full"
                                    value={form.notes}
                                    onChange={(e) => setForm(prev => ({ ...prev, notes: e.target.value }))}
                                />
                            </div>

                            <div className="flex justify-end gap-2 pt-2">
                                <button
                                    type="button"
                                    onClick={() => setModalOpen(false)}
                                    className="gm-btn gm-btn-ghost"
                                >
                                    取消
                                </button>
                                <button type="submit" disabled={saving} className="gm-btn gm-btn-primary">
                                    {saving ? '保存中…' : '保存'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>,
            )}

            {/* Chrome / Edge CSV 导入弹窗 */}
            {csvModalOpen && renderInBody(
                <div className="gm-overlay" role="dialog" aria-modal="true" aria-label="导入浏览器密码 CSV">
                    <div className="gm-panel w-full max-w-2xl p-5 space-y-4 max-h-[90vh] overflow-y-auto">
                        <div className="flex items-center justify-between">
                            <h3 className="text-[15px] font-semibold gm-text-1">导入 Chrome / Edge 密码 CSV</h3>
                            <button
                                type="button"
                                onClick={() => setCsvModalOpen(false)}
                                className="gm-btn gm-btn-ghost p-1"
                                aria-label="关闭"
                            >
                                <X size={16} />
                            </button>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                            {isTauriRuntime() && (
                                <button type="button" onClick={handlePickCsvFile} className="gm-btn gm-btn-secondary">
                                    <Upload size={14} />
                                    <span>选择 CSV 文件</span>
                                </button>
                            )}
                            <span className="text-[12px] gm-text-3">或在下方直接粘贴 CSV 文本（预览不显示明文密码）</span>
                        </div>

                        <textarea
                            rows={4}
                            className="gm-input w-full font-mono text-[12px]"
                            placeholder="name,url,username,password,note"
                            onChange={(e) => {
                                if (e.target.value.trim()) handleParseCsvText(e.target.value);
                                else {
                                    setCsvRows([]);
                                    setCsvError('');
                                }
                            }}
                        />

                        {csvError && (
                            <div className="p-2.5 rounded text-[12px]" style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}>
                                {csvError}
                            </div>
                        )}

                        {csvRows.length > 0 && (
                            <div className="space-y-2">
                                <div className="text-[12px] gm-text-2">
                                    共解析 {csvRows.length} 条 · 已勾选 {csvRows.filter(r => r.selected).length} 条
                                </div>
                                <div className="max-h-56 overflow-y-auto border border-[var(--border)] rounded-lg divide-y divide-[var(--border-light)]">
                                    {csvRows.map(row => (
                                        <label
                                            key={row.rowIndex}
                                            className="flex items-center gap-3 px-3 py-2 text-[12px] hover:bg-[var(--bg-hover)] cursor-pointer"
                                        >
                                            <input
                                                type="checkbox"
                                                className="gm-checkbox"
                                                checked={row.selected}
                                                onChange={() =>
                                                    setCsvRows(prev =>
                                                        prev.map(r =>
                                                            r.rowIndex === row.rowIndex ? { ...r, selected: !r.selected } : r,
                                                        ),
                                                    )
                                                }
                                            />
                                            <span className="font-medium gm-text-1 truncate w-32">{row.name}</span>
                                            <span className="gm-text-3 truncate flex-1">{row.username || row.url}</span>
                                            <span
                                                className="gm-chip shrink-0"
                                                style={
                                                    row.status === 'conflict'
                                                        ? { background: 'var(--warning-soft)', color: 'var(--warning)' }
                                                        : row.status === 'new'
                                                            ? { background: 'var(--success-soft)', color: 'var(--success)' }
                                                            : undefined
                                                }
                                            >
                                                {row.status === 'new' ? '新增' : row.status === 'conflict' ? '密码不同' : '已存在'}
                                            </span>
                                        </label>
                                    ))}
                                </div>
                            </div>
                        )}

                        <div className="flex justify-end gap-2 pt-2">
                            <button type="button" onClick={() => setCsvModalOpen(false)} className="gm-btn gm-btn-ghost">
                                取消
                            </button>
                            <button
                                type="button"
                                disabled={importingCsv || csvRows.filter(r => r.selected).length === 0}
                                onClick={handleConfirmCsvImport}
                                className="gm-btn gm-btn-primary"
                            >
                                {importingCsv ? '导入中…' : `导入选中 (${csvRows.filter(r => r.selected).length})`}
                            </button>
                        </div>
                    </div>
                </div>,
            )}
        </div>
    );
};

export default VaultView;
