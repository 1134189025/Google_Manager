import { useEffect, useState } from 'react';
import { X, FolderOpen, HardDrive, Eraser } from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import api from '../services/api';
import { formatBytes, describeClearCacheResult } from '../utils/browserUtils';

const EMPTY_FORM = { browserPath: '', profilesRoot: '' };

/**
 * 账号浏览器设置：浏览器程序、配置目录、占用统计与缓存清理
 *
 * firstRun 为 true 时是「首次打开浏览器前」的确认，保存后调用方会继续打开浏览器。
 * onClose(saved) 的参数表示是否已保存。
 */
const BrowserSettingsDialog = ({ isOpen, firstRun = false, onClose, onNotify }) => {
    const [settings, setSettings] = useState(null);
    const [form, setForm] = useState(EMPTY_FORM);
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);
    const [usage, setUsage] = useState(null);
    const [usageLoading, setUsageLoading] = useState(false);
    const [clearing, setClearing] = useState(false);

    useEffect(() => {
        if (!isOpen) return undefined;
        let cancelled = false;

        setSettings(null);
        setForm(EMPTY_FORM);
        setError('');
        setUsage(null);

        api.getBrowserSettings().then(result => {
            if (cancelled) return;
            if (!result.success) {
                setError(result.message || '读取浏览器设置失败');
                return;
            }
            setSettings(result.data);
            setForm({
                browserPath: result.data.browserPath || '',
                profilesRoot: result.data.profilesRoot || result.data.defaultProfilesRoot || '',
            });
        });

        return () => { cancelled = true; };
    }, [isOpen]);

    if (!isOpen) return null;

    const updateField = (field) => (event) => {
        const { value } = event.target;
        setForm(prev => ({ ...prev, [field]: value }));
    };

    const pickBrowser = async () => {
        try {
            const selected = await open({
                multiple: false,
                directory: false,
                filters: [{ name: '浏览器程序', extensions: ['exe'] }],
            });
            if (typeof selected === 'string') setForm(prev => ({ ...prev, browserPath: selected }));
        } catch (err) {
            console.error('选择浏览器程序失败:', err);
        }
    };

    const pickProfilesRoot = async () => {
        try {
            const selected = await open({
                multiple: false,
                directory: true,
                defaultPath: form.profilesRoot || undefined,
            });
            if (typeof selected === 'string') setForm(prev => ({ ...prev, profilesRoot: selected }));
        } catch (err) {
            console.error('选择配置目录失败:', err);
        }
    };

    const handleSave = async (event) => {
        event.preventDefault();
        setSaving(true);
        setError('');
        try {
            const result = await api.saveBrowserSettings({
                browserPath: form.browserPath.trim() || null,
                profilesRoot: form.profilesRoot.trim() || null,
            });
            if (!result.success) {
                setError(result.message || '保存浏览器设置失败');
                return;
            }
            onNotify?.('浏览器设置已保存');
            onClose(true);
        } finally {
            setSaving(false);
        }
    };

    const handleComputeUsage = async () => {
        setUsageLoading(true);
        try {
            const result = await api.getBrowserUsage();
            if (result.success) {
                setUsage(result.data);
            } else {
                onNotify?.(result.message || '统计占用失败', 'error');
            }
        } finally {
            setUsageLoading(false);
        }
    };

    const handleClearAll = async () => {
        if (!window.confirm('清理全部账号浏览器的缓存吗？\n不会影响登录状态；正在运行的浏览器会被跳过。')) return;
        setClearing(true);
        try {
            const result = await api.clearBrowserCache(null);
            if (!result.success) {
                onNotify?.(result.message || '清理缓存失败', 'error');
                return;
            }
            onNotify?.(describeClearCacheResult(result.data));
            if (usage) await handleComputeUsage();
        } finally {
            setClearing(false);
        }
    };

    const detectedText = settings?.detectedBrowserPath
        ? `自动检测到：${settings.detectedBrowserPath}`
        : '未检测到 Chrome 或 Edge，请手动指定浏览器程序';

    return (
        <div className="gm-overlay">
            <div className="gm-modal w-full max-w-2xl animate-in zoom-in-95 duration-200">
                <div className="gm-modal-header">
                    <h3 className="gm-title">{firstRun ? '首次使用：确认浏览器设置' : '账号浏览器设置'}</h3>
                    <button onClick={() => onClose(false)} className="gm-icon-btn" aria-label="关闭">
                        <X size={20} />
                    </button>
                </div>
                <form onSubmit={handleSave}>
                    <div className="gm-modal-body space-y-4">
                        {firstRun && (
                            <p className="text-sm gm-text-2">
                                每个账号会在配置目录下建一个独立的浏览器配置，用来保存登录状态。
                                每个配置刚创建时约 75 MB，日常使用后大约一两百 MB，请选一个空间充足的位置。
                            </p>
                        )}

                        <div>
                            <label htmlFor="gm-browser-path" className="block text-sm font-medium gm-text-2 mb-1">浏览器程序</label>
                            <div className="flex gap-2">
                                <input
                                    id="gm-browser-path"
                                    value={form.browserPath}
                                    onChange={updateField('browserPath')}
                                    placeholder="留空则自动检测（优先 Chrome，其次 Edge）"
                                    className="gm-input flex-1"
                                />
                                <button type="button" onClick={pickBrowser} className="gm-btn gm-btn-secondary" title="选择浏览器程序">
                                    <FolderOpen size={16} />
                                    <span>选择</span>
                                </button>
                            </div>
                            <p className="mt-1 text-xs gm-text-3">{settings ? detectedText : '正在读取设置…'}</p>
                        </div>

                        <div>
                            <label htmlFor="gm-profiles-root" className="block text-sm font-medium gm-text-2 mb-1">配置目录</label>
                            <div className="flex gap-2">
                                <input
                                    id="gm-profiles-root"
                                    value={form.profilesRoot}
                                    onChange={updateField('profilesRoot')}
                                    placeholder={settings?.defaultProfilesRoot || ''}
                                    className="gm-input flex-1"
                                />
                                <button type="button" onClick={pickProfilesRoot} className="gm-btn gm-btn-secondary" title="选择配置目录">
                                    <FolderOpen size={16} />
                                    <span>选择</span>
                                </button>
                            </div>
                            <p className="mt-1 text-xs gm-text-3">
                                留空使用默认位置{settings?.defaultProfilesRoot ? `：${settings.defaultProfilesRoot}` : ''}。修改目录不会迁移已有配置。
                            </p>
                        </div>

                        {!firstRun && (
                            <div className="flex flex-wrap items-center gap-2">
                                <button type="button" onClick={handleComputeUsage} disabled={usageLoading} className="gm-btn gm-btn-secondary gm-btn-sm">
                                    <HardDrive size={14} />
                                    <span>{usageLoading ? '统计中…' : '计算占用'}</span>
                                </button>
                                <button type="button" onClick={handleClearAll} disabled={clearing} className="gm-btn gm-btn-secondary gm-btn-sm">
                                    <Eraser size={14} />
                                    <span>{clearing ? '清理中…' : '清理全部缓存'}</span>
                                </button>
                                {usage && (
                                    <span className="text-sm gm-text-2">
                                        {usage.profiles} 个配置，共 {formatBytes(usage.totalBytes)}
                                    </span>
                                )}
                            </div>
                        )}

                        <p className="text-xs gm-text-3 leading-5">
                            配置目录不在数据库备份范围内。浏览器的登录 cookie 由 Windows 加密并绑定当前系统用户，
                            复制到其他电脑或重装系统后需要重新登录。
                        </p>

                        {error && <p className="text-sm" style={{ color: 'var(--danger)' }}>{error}</p>}
                    </div>
                    <div className="gm-modal-footer">
                        <button type="button" onClick={() => onClose(false)} className="gm-btn gm-btn-secondary flex-1">取消</button>
                        <button type="submit" disabled={saving || !settings} className="gm-btn gm-btn-primary flex-1">
                            {saving ? '保存中…' : firstRun ? '保存并打开浏览器' : '保存'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default BrowserSettingsDialog;
