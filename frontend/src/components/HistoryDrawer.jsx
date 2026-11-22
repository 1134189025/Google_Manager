import React, { useState, useEffect } from 'react';
import {
    X, Clock, Key, Mail, Shield, History, ArrowRight, ChevronDown, ChevronUp,
    AtSign, Phone, Calendar, Globe, Tag, FileText, ToggleRight,
} from 'lucide-react';
import api from '../services/api';
import { formatDbTimestamp } from '../utils/timeUtils';
import { renderInBody } from '../utils/portal';
import { PixelLoader } from './PixelArt';

// 旧数据库可能残留已下线字段的历史记录，渲染时静默跳过
const LEGACY_HIDDEN_FIELDS = ['sold_status'];

/**
 * 历史记录抽屉组件（统一 MosMos 暗黑极简浮层质感）
 */
const HistoryDrawer = ({ isOpen, onClose, account }) => {
    const [history, setHistory] = useState([]);
    const [loading, setLoading] = useState(false);
    const [expandedFields, setExpandedFields] = useState({});

    const fieldNames = {
        email: { name: '邮箱', icon: AtSign },
        recovery: { name: '恢复邮箱', icon: Mail },
        phone: { name: '手机号', icon: Phone },
        status: { name: '状态', icon: ToggleRight },
        group_name: { name: '标签', icon: Tag },
        remark: { name: '备注', icon: FileText },
        reg_year: { name: '注册年份', icon: Calendar },
        country: { name: '国家', icon: Globe },
        password: { name: '密码', icon: Key },
        secret: { name: '2FA密钥', icon: Shield },
    };

    const formatValue = (fieldKey, value) => {
        if (fieldKey === 'status') {
            if (value === 'pro') return 'Pro';
            if (value === 'inactive') return '普通';
        }
        return value;
    };

    useEffect(() => {
        if (isOpen && account) {
            loadHistory();
            setExpandedFields(Object.fromEntries(Object.keys(fieldNames).map(field => [field, true])));
        }
    }, [isOpen, account]);

    const loadHistory = async () => {
        setLoading(true);
        try {
            const result = await api.getAccountHistory(account.id);
            if (result.success) {
                setHistory(result.data);
            }
        } catch (err) {
            console.error('加载历史记录失败:', err);
        } finally {
            setLoading(false);
        }
    };

    const toggleField = (field) => {
        setExpandedFields(prev => ({ ...prev, [field]: !prev[field] }));
    };

    const groupedHistory = history.reduce((acc, item) => {
        if (LEGACY_HIDDEN_FIELDS.includes(item.fieldName)) {
            return acc;
        }
        if (!acc[item.fieldName]) {
            acc[item.fieldName] = [];
        }
        acc[item.fieldName].push(item);
        return acc;
    }, {});

    const visibleCount = history.filter(
        (item) => fieldNames[item.fieldName] && !LEGACY_HIDDEN_FIELDS.includes(item.fieldName)
    ).length;

    const formatTime = (timeStr) => {
        if (!timeStr) return '';
        const parts = formatDbTimestamp(timeStr).split(' ');
        return {
            date: parts[0] || '',
            time: parts[1] || ''
        };
    };

    if (!isOpen) return null;

    return renderInBody(
        <>
            <div
                className="gm-overlay"
                style={{ zIndex: 40 }}
                onClick={onClose}
            />

            <div className="gm-drawer fixed right-0 top-0 h-full w-full max-w-[420px] sm:w-[420px] z-50 flex flex-col">
                {/* 极简暗黑头部 */}
                <div className="px-5 py-4 flex items-center justify-between border-b shrink-0" style={{ borderColor: 'var(--border-light)' }}>
                    <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-lg flex items-center justify-center gm-solid">
                            <History size={18} style={{ color: 'var(--primary)' }} />
                        </div>
                        <div>
                            <h2 className="font-semibold text-base gm-text-1 leading-tight">修改历史</h2>
                            <p className="text-xs gm-text-3 mt-0.5">查看账号信息变更记录</p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="gm-icon-btn"
                        style={{ width: 30, height: 30 }}
                        aria-label="关闭修改历史"
                    >
                        <X size={16} />
                    </button>
                </div>

                {/* 账号信息条 */}
                {account && (
                    <div className="mx-4 mt-3 px-3.5 py-2.5 gm-solid shrink-0">
                        <p className="text-[11px] font-medium gm-text-3">当前账号</p>
                        <p className="text-sm font-semibold truncate gm-text-1 mt-0.5">{account.email}</p>
                    </div>
                )}

                {/* 历史记录内容 */}
                <div className="p-4 overflow-y-auto flex-1 min-h-0">
                    {loading ? (
                        <div className="flex items-center justify-center py-20">
                            <PixelLoader label="正在加载记录..." />
                        </div>
                    ) : visibleCount === 0 ? (
                        <div className="gm-empty">
                            <div className="w-14 h-14 mx-auto mb-3 rounded-xl flex items-center justify-center gm-solid">
                                <History size={24} className="opacity-40" />
                            </div>
                            <p className="font-medium text-sm gm-text-2 mb-1">暂无修改记录</p>
                            <p className="text-xs gm-text-3 leading-relaxed">
                                修改邮箱、手机号、标签、备注等信息后<br />会在这里显示历史记录（密码与 2FA 密钥不记录）
                            </p>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {Object.entries(fieldNames).map(([fieldKey, fieldInfo]) => {
                                const records = groupedHistory[fieldKey] || [];
                                if (records.length === 0) return null;

                                const FieldIcon = fieldInfo.icon;
                                const isExpanded = expandedFields[fieldKey];

                                return (
                                    <div key={fieldKey} className="gm-card overflow-hidden">
                                        <button
                                            onClick={() => toggleField(fieldKey)}
                                            className="w-full flex items-center justify-between px-3.5 py-3 transition-colors hover:bg-[color:var(--bg-hover)]"
                                        >
                                            <div className="flex items-center gap-2.5">
                                                <div className="w-7 h-7 rounded-md flex items-center justify-center gm-solid">
                                                    <FieldIcon size={14} style={{ color: 'var(--primary)' }} />
                                                </div>
                                                <span className="font-semibold text-xs gm-text-1">
                                                    {fieldInfo.name}修改记录
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <span className="gm-chip font-mono">
                                                    {records.length}次
                                                </span>
                                                {isExpanded
                                                    ? <ChevronUp size={15} className="gm-text-3" />
                                                    : <ChevronDown size={15} className="gm-text-3" />}
                                            </div>
                                        </button>

                                        {isExpanded && (
                                            <div className="px-3.5 pb-3.5 space-y-2.5 border-t" style={{ borderColor: 'var(--border-light)' }}>
                                                {records.map((record) => {
                                                    const { date, time } = formatTime(record.changedAt);
                                                    return (
                                                        <div key={record.id} className="mt-2.5 p-3 gm-solid">
                                                            <div className="flex items-center gap-2 text-[11px] font-mono mb-2.5 gm-text-3">
                                                                <Clock size={11} />
                                                                <span>{date}</span>
                                                                <span className="px-1.5 py-0.5 rounded" style={{ background: 'var(--bg-hover)' }}>{time}</span>
                                                            </div>

                                                            <div className="flex items-center gap-2">
                                                                <div
                                                                    className="flex-1 min-w-0 p-2.5 rounded-md border"
                                                                    style={{ background: 'var(--danger-soft)', borderColor: 'rgba(248, 113, 113, 0.28)' }}
                                                                >
                                                                    <p className="text-[10px] font-semibold mb-1" style={{ color: 'var(--danger)' }}>修改前</p>
                                                                    <p className="text-xs font-mono break-all gm-text-1">
                                                                        {formatValue(fieldKey, record.oldValue) || <span className="italic opacity-50">(空)</span>}
                                                                    </p>
                                                                </div>

                                                                <ArrowRight size={13} className="gm-text-3 shrink-0" />

                                                                <div
                                                                    className="flex-1 min-w-0 p-2.5 rounded-md border"
                                                                    style={{ background: 'var(--success-soft)', borderColor: 'rgba(52, 211, 153, 0.28)' }}
                                                                >
                                                                    <p className="text-[10px] font-semibold mb-1" style={{ color: 'var(--success)' }}>修改后</p>
                                                                    <p className="text-xs font-mono break-all gm-text-1">
                                                                        {formatValue(fieldKey, record.newValue) || <span className="italic opacity-50">(空)</span>}
                                                                    </p>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* 底部信息 */}
                <div
                    className="px-4 py-3 shrink-0 border-t"
                    style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border-light)' }}
                >
                    <p className="text-xs text-center font-mono gm-text-3">
                        共 {visibleCount} 条修改记录
                    </p>
                </div>
            </div>
        </>
    );
};

export default HistoryDrawer;
