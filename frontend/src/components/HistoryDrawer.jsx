import React, { useState, useEffect } from 'react';
import {
    X, Clock, Key, Mail, Shield, History, ArrowRight, ChevronDown, ChevronUp,
    AtSign, Phone, Calendar, Globe, Tag, FileText, ToggleRight,
} from 'lucide-react';
import api from '../services/api';
import { formatDbTimestamp } from '../utils/timeUtils';

// 旧数据库可能残留已下线字段的历史记录，渲染时静默跳过
const LEGACY_HIDDEN_FIELDS = ['sold_status'];

/**
 * 历史记录抽屉组件
 * 显示账号的修改历史
 */
const HistoryDrawer = ({ isOpen, onClose, account }) => {
    const [history, setHistory] = useState([]);
    const [loading, setLoading] = useState(false);
    const [expandedFields, setExpandedFields] = useState({});

    // 字段名称映射（图标渐变统一走主题令牌）
    // 与后端 TRACKED_FIELDS 及 toggle_status 写入的字段一致；
    // password / secret 现已不记录历史，保留映射只为显示旧库里的历史记录
    const fieldNames = {
        email: { name: '邮箱', icon: AtSign, gradient: 'var(--gradient-primary)' },
        recovery: { name: '恢复邮箱', icon: Mail, gradient: 'var(--gradient-danger)' },
        phone: { name: '手机号', icon: Phone, gradient: 'var(--gradient-success)' },
        status: { name: '状态', icon: ToggleRight, gradient: 'var(--gradient-primary)' },
        group_name: { name: '标签', icon: Tag, gradient: 'var(--gradient-success)' },
        remark: { name: '备注', icon: FileText, gradient: 'var(--gradient-danger)' },
        reg_year: { name: '注册年份', icon: Calendar, gradient: 'var(--gradient-primary)' },
        country: { name: '国家', icon: Globe, gradient: 'var(--gradient-success)' },
        password: { name: '密码', icon: Key, gradient: 'var(--gradient-success)' },
        secret: { name: '2FA密钥', icon: Shield, gradient: 'var(--gradient-primary)' },
    };

    // status 存的是 pro / inactive，按表格里的叫法显示
    const formatValue = (fieldKey, value) => {
        if (fieldKey === 'status') {
            if (value === 'pro') return 'Pro';
            if (value === 'inactive') return '普通';
        }
        return value;
    };

    // 加载历史记录
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

    // 切换字段展开状态
    const toggleField = (field) => {
        setExpandedFields(prev => ({ ...prev, [field]: !prev[field] }));
    };

    // 按字段分组历史记录（跳过已下线字段，避免旧数据渲染报错）
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

    // 可见记录条数：只统计实际会渲染的字段（排除已下线字段与未映射字段），
    // 避免出现「底部显示条数、正文却是空白」的情况。
    const visibleCount = history.filter(
        (item) => fieldNames[item.fieldName] && !LEGACY_HIDDEN_FIELDS.includes(item.fieldName)
    ).length;

    // 格式化时间显示（数据库存的是 UTC，换算成本机时间）
    const formatTime = (timeStr) => {
        if (!timeStr) return '';
        const parts = formatDbTimestamp(timeStr).split(' ');
        return {
            date: parts[0] || '',
            time: parts[1] || ''
        };
    };

    if (!isOpen) return null;

    return (
        <>
            {/* 遮罩层（z-index 保持在抽屉之下） */}
            <div
                className="gm-overlay"
                style={{ zIndex: 40 }}
                onClick={onClose}
            />

            {/* 抽屉面板 */}
            <div
                className="fixed right-0 top-0 h-full w-full max-w-[420px] sm:w-[420px] z-50 transform transition-all duration-300 ease-out"
                style={{ background: 'var(--bg-secondary)', borderLeft: '1px solid var(--border)', boxShadow: 'var(--shadow-lg)' }}
            >
                {/* 头部 - 渐变背景 */}
                <div className="p-5" style={{ background: 'var(--gradient-primary)', color: '#ffffff' }}>
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="p-2 rounded-xl" style={{ background: 'rgba(255, 255, 255, 0.2)' }}>
                                <History size={22} />
                            </div>
                            <div>
                                <h2 className="font-bold text-lg">修改历史</h2>
                                <p className="text-sm" style={{ color: 'rgba(255, 255, 255, 0.7)' }}>查看账号信息变更记录</p>
                            </div>
                        </div>
                        <button
                            onClick={onClose}
                            className="gm-icon-btn"
                            style={{ background: 'rgba(255, 255, 255, 0.18)', borderColor: 'rgba(255, 255, 255, 0.3)', color: '#ffffff' }}
                        >
                            <X size={20} />
                        </button>
                    </div>
                </div>

                {/* 账号信息卡片 */}
                {account && (
                    <div className="gm-card mx-4 -mt-4 p-4">
                        <p className="text-xs font-medium gm-text-3 mb-1">当前账号</p>
                        <p className="font-bold truncate gm-text-1">{account.email}</p>
                    </div>
                )}

                {/* 历史记录内容 */}
                <div className="p-4 overflow-y-auto h-[calc(100%-200px)]">
                    {loading ? (
                        <div className="flex items-center justify-center py-20">
                            <div className="relative">
                                <div
                                    className="animate-spin rounded-full h-12 w-12 border-4"
                                    style={{ borderColor: 'var(--border)', borderTopColor: 'var(--primary)' }}
                                ></div>
                                <History
                                    className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
                                    size={20}
                                    style={{ color: 'var(--primary)' }}
                                />
                            </div>
                        </div>
                    ) : visibleCount === 0 ? (
                        <div className="gm-empty">
                            <div className="w-20 h-20 mx-auto mb-4 rounded-full flex items-center justify-center gm-solid">
                                <History size={32} className="opacity-40" />
                            </div>
                            <p className="font-medium mb-1">暂无修改记录</p>
                            <p className="text-sm">修改邮箱、手机号、标签、备注等信息后<br />会在这里显示历史记录（密码与 2FA 密钥不记录）</p>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {Object.entries(fieldNames).map(([fieldKey, fieldInfo]) => {
                                const records = groupedHistory[fieldKey] || [];
                                if (records.length === 0) return null;

                                const FieldIcon = fieldInfo.icon;
                                const isExpanded = expandedFields[fieldKey];

                                return (
                                    <div key={fieldKey} className="gm-card overflow-hidden">
                                        {/* 字段标题 - 可点击折叠 */}
                                        <button
                                            onClick={() => toggleField(fieldKey)}
                                            className="w-full flex items-center justify-between p-4 transition-colors hover:bg-[color:var(--bg-hover)]"
                                        >
                                            <div className="flex items-center gap-3">
                                                <div className="p-2 rounded-xl shadow-lg" style={{ background: fieldInfo.gradient, color: '#ffffff' }}>
                                                    <FieldIcon size={16} />
                                                </div>
                                                <span className="font-bold gm-text-1">
                                                    {fieldInfo.name}修改记录
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <span className="gm-chip font-bold">
                                                    {records.length}次
                                                </span>
                                                {isExpanded ? <ChevronUp size={18} className="gm-text-3" /> : <ChevronDown size={18} className="gm-text-3" />}
                                            </div>
                                        </button>

                                        {/* 记录列表 */}
                                        {isExpanded && (
                                            <div className="px-4 pb-4 space-y-3 border-t" style={{ borderColor: 'var(--border-light)' }}>
                                                {records.map((record) => {
                                                    const { date, time } = formatTime(record.changedAt);
                                                    return (
                                                        <div
                                                            key={record.id}
                                                            className="mt-3 p-4 rounded-xl gm-solid"
                                                        >
                                                            {/* 时间标签 */}
                                                            <div className="flex items-center gap-2 text-xs mb-3 gm-text-2">
                                                                <Clock size={12} />
                                                                <span className="font-medium">{date}</span>
                                                                <span className="px-1.5 py-0.5 rounded" style={{ background: 'var(--bg-hover)' }}>{time}</span>
                                                            </div>

                                                            {/* 修改内容 - 优化显示 */}
                                                            <div className="flex items-center gap-3">
                                                                {/* 旧值 */}
                                                                <div className="flex-1 p-3 rounded-xl gm-solid" style={{ borderColor: 'var(--danger)' }}>
                                                                    <p className="text-[10px] font-medium mb-1" style={{ color: 'var(--danger)' }}>修改前</p>
                                                                    <p className="text-sm font-mono break-all gm-text-2">
                                                                        {formatValue(fieldKey, record.oldValue) || <span className="italic opacity-50">(空)</span>}
                                                                    </p>
                                                                </div>

                                                                {/* 箭头 */}
                                                                <div className="p-2 rounded-full gm-solid">
                                                                    <ArrowRight size={14} className="gm-text-3" />
                                                                </div>

                                                                {/* 新值 */}
                                                                <div className="flex-1 p-3 rounded-xl gm-solid" style={{ borderColor: 'var(--success)' }}>
                                                                    <p className="text-[10px] font-medium mb-1" style={{ color: 'var(--success)' }}>修改后</p>
                                                                    <p className="text-sm font-mono break-all gm-text-2">
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
                    className="absolute bottom-0 left-0 right-0 p-4 backdrop-blur-sm"
                    style={{ background: 'var(--bg-secondary)', borderTop: '1px solid var(--border)' }}
                >
                    <p className="text-xs text-center gm-text-3">
                        共 {visibleCount} 条修改记录
                    </p>
                </div>
            </div>
        </>
    );
};

export default HistoryDrawer;
