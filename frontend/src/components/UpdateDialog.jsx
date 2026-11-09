import { X, Download, RefreshCw } from 'lucide-react';
import { RELEASES_URL } from '../hooks/useAppUpdater';
import { renderInBody } from '../utils/portal';

const formatPercent = (progress) => `${Math.round((progress || 0) * 100)}%`;

/**
 * 在线更新弹窗：显示新版本号、更新说明与下载进度
 *
 * updater 为 useAppUpdater() 的返回值。
 */
const UpdateDialog = ({ updater }) => {
    if (!updater?.open) return null;

    const {
        status, version, currentVersion, notes, progress, error,
        install, dismiss, skipVersion, checkNow,
    } = updater;
    const busy = status === 'downloading' || status === 'installing';

    const title = {
        checking: '检查更新',
        upToDate: '检查更新',
        available: `发现新版本 v${version}`,
        downloading: `正在下载 v${version}`,
        installing: `正在安装 v${version}`,
        error: version ? `更新到 v${version}` : '检查更新',
    }[status] || '检查更新';

    return renderInBody(
        <div className="gm-overlay">
            <div className="gm-modal w-full max-w-lg animate-in zoom-in-95 duration-200" role="dialog" aria-label={title}>
                <div className="gm-modal-header">
                    <h3 className="gm-title">{title}</h3>
                    {!busy && (
                        <button type="button" onClick={dismiss} className="gm-icon-btn" aria-label="关闭">
                            <X size={20} />
                        </button>
                    )}
                </div>

                <div className="gm-modal-body space-y-3">
                    {status === 'checking' && <p className="text-sm gm-text-2">正在连接 GitHub 检查新版本…</p>}

                    {status === 'upToDate' && <p className="text-sm gm-text-2">当前已是最新版本。</p>}

                    {(status === 'available' || busy || (status === 'error' && version)) && (
                        <>
                            {currentVersion && (
                                <p className="text-sm gm-text-2">当前版本 v{currentVersion}，最新版本 v{version}。</p>
                            )}
                            {notes && (
                                <pre
                                    className="text-sm gm-text-2 whitespace-pre-wrap max-h-64 overflow-y-auto rounded-lg p-3"
                                    style={{ background: 'var(--bg-secondary)', fontFamily: 'inherit' }}
                                    aria-label="更新说明"
                                >
                                    {notes}
                                </pre>
                            )}
                        </>
                    )}

                    {busy && (
                        <div>
                            <div
                                className="h-2 rounded-full overflow-hidden"
                                style={{ background: 'var(--bg-tertiary)' }}
                                role="progressbar"
                                aria-valuemin={0}
                                aria-valuemax={100}
                                aria-valuenow={progress === null ? undefined : Math.round(progress * 100)}
                            >
                                <div
                                    className="h-full transition-all"
                                    style={{
                                        width: progress === null ? '100%' : formatPercent(progress),
                                        background: 'var(--gradient-primary)',
                                    }}
                                />
                            </div>
                            <p className="mt-2 text-xs gm-text-3">
                                {status === 'installing'
                                    ? '下载完成，正在安装，应用稍后会自动重启…'
                                    : progress === null ? '正在下载…' : `正在下载 ${formatPercent(progress)}`}
                            </p>
                        </div>
                    )}

                    {status === 'error' && (
                        <div className="space-y-2">
                            <p className="text-sm" style={{ color: 'var(--danger)' }}>{error}</p>
                            <p className="text-xs gm-text-3">
                                网络无法访问 GitHub 时，可以在能访问的环境下打开下面的地址，手动下载安装包：
                            </p>
                            <p className="text-xs gm-text-2 select-all break-all">{RELEASES_URL}</p>
                        </div>
                    )}

                    {status === 'available' && (
                        <p className="text-xs gm-text-3">更新前会自动备份一次数据库；安装完成后应用会自动重启。</p>
                    )}
                </div>

                <div className="gm-modal-footer">
                    {status === 'available' && (
                        <>
                            <button type="button" onClick={skipVersion} className="gm-btn gm-btn-secondary">跳过此版本</button>
                            <button type="button" onClick={dismiss} className="gm-btn gm-btn-secondary flex-1">稍后</button>
                            <button type="button" onClick={install} className="gm-btn gm-btn-primary flex-1">
                                <Download size={16} />
                                <span>立即更新</span>
                            </button>
                        </>
                    )}
                    {status === 'error' && (
                        <>
                            <button type="button" onClick={dismiss} className="gm-btn gm-btn-secondary flex-1">关闭</button>
                            <button type="button" onClick={version ? install : checkNow} className="gm-btn gm-btn-primary flex-1">
                                <RefreshCw size={16} />
                                <span>重试</span>
                            </button>
                        </>
                    )}
                    {(status === 'upToDate' || status === 'checking') && (
                        <button type="button" onClick={dismiss} className="gm-btn gm-btn-secondary flex-1">
                            {status === 'checking' ? '取消' : '好的'}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default UpdateDialog;
