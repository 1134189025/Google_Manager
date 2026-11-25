import React, { forwardRef, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import FluentIcon from './FluentIcon';
import { useLiquidGlass } from './LiquidGlassEngine';

/**
 * 液态水滴分段控件 (.seg.glass + .seg-drop)
 * - 自动测量选中按钮的宽度与左偏移，驱动水滴滑块弹性平移动画
 * - 选中态同时设置 aria-pressed="true" 与 active 类名，兼容全部交互及测试断言
 */
export const SegmentedControl = ({
    options = [],
    value,
    onChange,
    label,
    className = '',
    ...rest
}) => {
    const hostRef = useRef(null);
    const dropRef = useRef(null);
    const btnRefs = useRef(new Map());
    const mountedRef = useRef(false);
    const squishTimerRef = useRef(null);
    const [moving, setMoving] = useState(false);

    const placeDrop = useCallback((instant) => {
        const drop = dropRef.current;
        const activeBtn = btnRefs.current.get(value);
        if (!drop || !activeBtn) return;

        const w = activeBtn.offsetWidth;
        const left = activeBtn.offsetLeft;
        if (!w && !left) return;

        if (instant) {
            drop.style.transition = 'none';
            drop.style.width = `${w}px`;
            drop.style.setProperty('--dx', `${left}px`);
            // 强制回流后恢复过渡
            void drop.offsetWidth;
            drop.style.transition = '';
            return;
        }

        setMoving(false);
        void drop.offsetWidth;
        setMoving(true);
        drop.style.width = `${w}px`;
        drop.style.setProperty('--dx', `${left}px`);

        if (squishTimerRef.current) clearTimeout(squishTimerRef.current);
        squishTimerRef.current = setTimeout(() => {
            setMoving(false);
            squishTimerRef.current = null;
        }, 380);
    }, [value]);

    useLayoutEffect(() => {
        placeDrop(!mountedRef.current);
        mountedRef.current = true;
    }, [placeDrop, options.length]);

    useEffect(() => {
        const onResize = () => placeDrop(true);
        window.addEventListener('resize', onResize);
        return () => {
            window.removeEventListener('resize', onResize);
            if (squishTimerRef.current) clearTimeout(squishTimerRef.current);
        };
    }, [placeDrop]);

    return (
        <div
            ref={hostRef}
            className={`seg glass ${moving ? 'moving' : ''} ${className}`.trim()}
            role="group"
            aria-label={label}
            data-lens="cap"
            {...rest}
        >
            <span ref={dropRef} className="seg-drop glass" data-lens="drop" aria-hidden="true" />
            {options.map((opt) => {
                const selected = opt.value === value;
                return (
                    <button
                        key={String(opt.value)}
                        ref={(node) => {
                            if (node) btnRefs.current.set(opt.value, node);
                            else btnRefs.current.delete(opt.value);
                        }}
                        type="button"
                        aria-pressed={selected}
                        className={selected ? 'active' : ''}
                        onClick={() => onChange?.(opt.value)}
                        disabled={Boolean(opt.disabled)}
                        title={opt.title}
                    >
                        {opt.icon && (
                            typeof opt.icon === 'string'
                                ? <FluentIcon name={opt.icon} filled={selected} size={15} />
                                : opt.icon
                        )}
                        <span>{opt.label}</span>
                        {opt.count != null && (
                            <span className="text-[11px] opacity-70 tabular-nums">{opt.count}</span>
                        )}
                    </button>
                );
            })}
        </div>
    );
};

/**
 * 液态玻璃按钮 (.gbtn)
 */
export const GlassButton = forwardRef(({
    glass = false,
    pill = false,
    prominent = false,
    icon = false,
    lens = 'cap',
    className = '',
    type = 'button',
    children,
    ...rest
}, ref) => {
    const classes = [
        'gbtn',
        glass ? 'glass' : '',
        pill ? 'gpill' : '',
        prominent ? 'prominent' : '',
        icon ? 'icon' : '',
        className,
    ].filter(Boolean).join(' ');

    return (
        <button
            ref={ref}
            type={type}
            className={classes}
            data-lens={glass ? lens : undefined}
            {...rest}
        >
            {children}
        </button>
    );
});
GlassButton.displayName = 'GlassButton';

/**
 * 液态玻璃胶囊分组容器 (.cap.glass)
 */
export const GlassCapsule = forwardRef(({
    lens = 'cap',
    className = '',
    children,
    ...rest
}, ref) => (
    <div
        ref={ref}
        className={`cap glass ${className}`.trim()}
        data-lens={lens}
        {...rest}
    >
        {children}
    </div>
));
GlassCapsule.displayName = 'GlassCapsule';

/**
 * 液态玻璃胶囊搜索框 (.gsearch.glass)
 */
export const GlassSearch = forwardRef(({
    value = '',
    onChange,
    onClear,
    placeholder = '搜索…',
    ariaLabel = '搜索',
    className = '',
    id,
    shortcutHint,
    inputProps = {},
}, ref) => (
    <label className={`gsearch glass ${className}`.trim()} data-lens="cap">
        <FluentIcon name="search" />
        <input
            ref={ref}
            id={id}
            type="search"
            value={value}
            onChange={onChange}
            placeholder={placeholder}
            aria-label={ariaLabel}
            {...inputProps}
        />
        {value && onClear ? (
            <button
                type="button"
                className="gbtn icon"
                style={{ width: 22, height: 22, minWidth: 22 }}
                onClick={(e) => {
                    e.preventDefault();
                    onClear();
                }}
                aria-label="清空搜索"
                title="清空搜索"
            >
                <FluentIcon name="dismiss" size={13} />
            </button>
        ) : shortcutHint ? (
            <kbd className="gm-kbd">{shortcutHint}</kbd>
        ) : null}
    </label>
));
GlassSearch.displayName = 'GlassSearch';

/**
 * 页面顶部粘性工具栏 (.toolbar)
 * 随内容滚动自动呈现边缘柔和溶解过渡，窄屏自动显示侧栏抽屉入口。
 */
export const PageToolbar = ({
    title,
    subtitle,
    left,
    right,
    children,
    className = '',
}) => {
    const { openNav } = useLiquidGlass();

    return (
        <header className={`toolbar ${className}`.trim()}>
            <button
                className="gbtn glass gpill icon menu-btn"
                type="button"
                data-lens="cap"
                onClick={openNav}
                aria-label="打开导航"
                title="打开导航"
            >
                <FluentIcon name="panel" />
            </button>
            <div className="title">
                <h1>{title}</h1>
                {subtitle ? <span>{subtitle}</span> : null}
            </div>
            {left}
            <div className="grow" />
            {right || children}
        </header>
    );
};

/**
 * 2FA 环形倒计时指示器 (.ring)
 */
export const RingCountdown = ({
    remaining = 30,
    period = 30,
    size = 14,
    strokeWidth = 1.6,
    className = '',
}) => {
    const half = size / 2;
    const r = Math.max(1, half - strokeWidth);
    const c = 2 * Math.PI * r;
    const pct = Math.max(0, Math.min(1, Number(remaining) / Math.max(1, Number(period))));
    const low = Number(remaining) <= 5;

    return (
        <span
            className={`ring ${low ? 'low' : ''} ${className}`.trim()}
            style={{ width: size, height: size, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
            aria-hidden="true"
        >
            <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
                <circle
                    className="bg"
                    cx={half}
                    cy={half}
                    r={r}
                    style={{ strokeWidth }}
                />
                <circle
                    className="fg"
                    cx={half}
                    cy={half}
                    r={r}
                    strokeDasharray={c.toFixed(2)}
                    strokeDashoffset={(c * (1 - pct)).toFixed(2)}
                    style={{ strokeWidth }}
                />
            </svg>
        </span>
    );
};

/**
 * 语义状态圆点 (.status)
 */
export const StatusDot = ({ tone = '', className = '', children, ...rest }) => (
    <span className={`status ${tone} ${className}`.trim()} {...rest}>
        {children}
    </span>
);

/**
 * 轻量圆角标签 (.chip)
 */
export const Chip = ({ tone = '', className = '', children, ...rest }) => (
    <span className={`chip ${tone} ${className}`.trim()} {...rest}>
        {children}
    </span>
);

/**
 * Windows 11 系统设置风内嵌分组容器 (.group)
 */
export const InsetGroup = ({ className = '', children, ...rest }) => (
    <div className={`group ${className}`.trim()} {...rest}>
        {children}
    </div>
);

/**
 * 统一空状态组件 (.empty)
 */
export const EmptyState = ({
    icon = 'inbox',
    title,
    description,
    action,
    className = '',
}) => (
    <div className={`empty ${className}`.trim()}>
        {icon && (
            typeof icon === 'string'
                ? <FluentIcon name={icon} />
                : icon
        )}
        {title && <h3>{title}</h3>}
        {description && <p>{description}</p>}
        {action}
    </div>
);

/**
 * 胶囊开关 (.switch)
 */
export const ToggleSwitch = forwardRef(({ className = '', ...rest }, ref) => (
    <input
        ref={ref}
        type="checkbox"
        className={`switch ${className}`.trim()}
        {...rest}
    />
));
ToggleSwitch.displayName = 'ToggleSwitch';
