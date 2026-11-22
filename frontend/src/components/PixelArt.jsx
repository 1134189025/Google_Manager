import React from 'react';

/**
 * 像素吉祥物（严格 16×16 整数网格 + crispEdges）
 *
 * - variant:
 *   - 'idle'    正常待机，会定期眨眼，四周飘浮几颗克制像素点
 *   - 'wave'    悬停/问候轻跳姿态
 *   - 'sleep'   休眠态（闭眼 + 小 z 像素），用于空态预览
 *   - 'loading' 像素加载呼吸态
 *   - 'badge'   侧栏黑白反色小徽标（无外围漂浮像素，保证 18-24px 下极高清晰度）
 */
export const PixelMascot = ({
    size = 48,
    variant = 'idle',
    className = '',
    title,
    ...rest
}) => {
    const isBadge = variant === 'badge';
    const isSleep = variant === 'sleep';
    const isWave = variant === 'wave';
    const isLoading = variant === 'loading';

    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 16 16"
            fill="none"
            shapeRendering="crispEdges"
            className={`gm-pixel-mascot ${isWave ? 'gm-pixel-mascot--wave' : 'gm-pixel-mascot-hop'} ${className}`}
            aria-hidden="true"
            {...rest}
        >
            {title && <title>{title}</title>}

            {/* 分离悬浮像素点（仅非 badge 尺寸显示） */}
            {!isBadge && (
                <g>
                    <rect
                        x="2"
                        y="3"
                        width="1"
                        height="1"
                        fill="currentColor"
                        opacity="0.48"
                        className="gm-pixel-float-a"
                    />
                    <rect
                        x="13"
                        y="2"
                        width="1"
                        height="1"
                        fill="currentColor"
                        opacity="0.65"
                        className="gm-pixel-float-b"
                    />
                    <rect
                        x="14"
                        y="6"
                        width="1"
                        height="1"
                        fill="var(--primary)"
                        opacity="0.85"
                        className="gm-pixel-float-a"
                    />
                    {!isSleep && (
                        <rect
                            x="1"
                            y="9"
                            width="1"
                            height="1"
                            fill="var(--primary)"
                            opacity="0.55"
                            className="gm-pixel-float-b"
                        />
                    )}
                </g>
            )}

            {/* 休眠小 z */}
            {isSleep && (
                <g className="gm-pixel-z" fill="currentColor" opacity="0.55">
                    <rect x="12" y="2" width="2" height="1" />
                    <rect x="13" y="3" width="1" height="1" />
                    <rect x="12" y="4" width="2" height="1" />
                </g>
            )}

            {/* 主体轮廓（像素小猫头 / 桌面伴侣轮廓） */}
            <g className="gm-pixel-body">
                {/* 左耳 & 右耳 */}
                <rect x="4" y="3" width="2" height="1" fill="currentColor" />
                <rect x="10" y="3" width="2" height="1" fill="currentColor" />
                <rect x="3" y="4" width="3" height="1" fill="currentColor" />
                <rect x="10" y="4" width="3" height="1" fill="currentColor" />

                {/* 头部主体 */}
                <rect x="3" y="5" width="10" height="6" fill="currentColor" />
                <rect x="4" y="11" width="8" height="1" fill="currentColor" />

                {/* 侧手 / 底座小脚 */}
                <rect x="2" y="7" width="1" height="2" fill="currentColor" opacity={isWave ? '1' : '0.82'} />
                <rect x="13" y={isWave ? '5' : '7'} width="1" height="2" fill="currentColor" opacity={isWave ? '1' : '0.82'} />
                <rect x="5" y="12" width="2" height="1" fill="currentColor" />
                <rect x="9" y="12" width="2" height="1" fill="currentColor" />

                {/* 眼睛（与背景反色挖空） */}
                {isSleep ? (
                    <g fill="var(--bg-canvas)">
                        <rect x="5" y="8" width="2" height="1" />
                        <rect x="9" y="8" width="2" height="1" />
                    </g>
                ) : (
                    <g
                        fill={isBadge ? 'var(--brand-badge-bg)' : 'var(--bg-canvas)'}
                        className={isBadge ? undefined : 'gm-pixel-eye'}
                    >
                        <rect x="5" y="7" width="2" height="2" />
                        <rect x="9" y="7" width="2" height="2" />
                    </g>
                )}

                {/* 鼻尖微点（仅大尺寸或 loading 展现细节） */}
                {!isBadge && !isSleep && (
                    <rect
                        x="7"
                        y="9"
                        width="2"
                        height="1"
                        fill={isLoading ? 'var(--primary)' : 'var(--bg-canvas)'}
                        opacity={isLoading ? '0.95' : '0.5'}
                    />
                )}
            </g>
        </svg>
    );
};

/**
 * MosMos 风格右半屏拜耳点阵古典拱门/穹顶氛围背景
 * 纯 SVG 整数网格点阵 + 渐变渐隐遮罩，零外部图片，不拦截鼠标事件
 */
export const PixelDitherBackdrop = () => (
    <div className="gm-dither-backdrop" aria-hidden="true">
        <svg
            viewBox="0 0 720 820"
            width="100%"
            height="100%"
            preserveAspectRatio="xMaxYMid slice"
            shapeRendering="crispEdges"
        >
            <defs>
                {/* 四级拜耳有序点阵图案，模拟版画光影 */}
                <pattern id="gm-bayer-ultra" width="3" height="3" patternUnits="userSpaceOnUse">
                    <rect x="0" y="0" width="1" height="1" fill="var(--dither-ink)" opacity="0.9" />
                    <rect x="1" y="2" width="1" height="1" fill="var(--dither-ink)" opacity="0.55" />
                    <rect x="2" y="1" width="1" height="1" fill="var(--dither-ink)" opacity="0.4" />
                </pattern>
                <pattern id="gm-bayer-dense" width="4" height="4" patternUnits="userSpaceOnUse">
                    <rect x="0" y="0" width="1" height="1" fill="var(--dither-ink)" />
                    <rect x="2" y="2" width="1" height="1" fill="var(--dither-ink)" />
                    <rect x="2" y="0" width="1" height="1" fill="var(--dither-ink)" opacity="0.45" />
                    <rect x="0" y="2" width="1" height="1" fill="var(--dither-ink)" opacity="0.45" />
                </pattern>
                <pattern id="gm-bayer-mid" width="6" height="6" patternUnits="userSpaceOnUse">
                    <rect x="0" y="0" width="1" height="1" fill="var(--dither-ink)" opacity="0.7" />
                    <rect x="3" y="3" width="1" height="1" fill="var(--dither-ink)" opacity="0.45" />
                    <rect x="3" y="0" width="1" height="1" fill="var(--dither-ink)" opacity="0.25" />
                </pattern>
                <pattern id="gm-bayer-sparse" width="8" height="8" patternUnits="userSpaceOnUse">
                    <rect x="1" y="1" width="1" height="1" fill="var(--dither-ink)" opacity="0.45" />
                    <rect x="5" y="5" width="1" height="1" fill="var(--dither-ink)" opacity="0.25" />
                </pattern>

                <radialGradient id="gm-arch-fade" cx="68%" cy="40%" r="60%">
                    <stop offset="0%" stopColor="white" stopOpacity="1" />
                    <stop offset="48%" stopColor="white" stopOpacity="0.62" />
                    <stop offset="82%" stopColor="white" stopOpacity="0.16" />
                    <stop offset="100%" stopColor="white" stopOpacity="0" />
                </radialGradient>
                <mask id="gm-arch-mask">
                    <rect width="720" height="820" fill="url(#gm-arch-fade)" />
                </mask>
            </defs>

            <g mask="url(#gm-arch-mask)">
                {/* 远景疏点阵空气感 */}
                <rect x="100" y="0" width="620" height="820" fill="url(#gm-bayer-sparse)" />

                {/* 拱顶藻井外环（多层渐深） */}
                <path
                    d="M170 760 V330 C170 155 295 45 450 45 C605 45 710 155 710 330 V760 H646 V340 C646 198 564 114 450 114 C336 114 234 198 234 340 V760 Z"
                    fill="url(#gm-bayer-ultra)"
                />
                <path
                    d="M244 760 V346 C244 214 334 132 450 132 C566 132 636 214 636 346 V760 H588 V356 C588 248 532 184 450 184 C368 184 292 248 292 356 V760 Z"
                    fill="url(#gm-bayer-dense)"
                />
                <path
                    d="M312 760 V370 C312 276 372 216 450 216 C528 216 574 276 574 370 V760 H538 V380 C538 308 502 260 450 260 C398 260 348 308 348 380 V760 Z"
                    fill="url(#gm-bayer-mid)"
                />

                {/* 藻井顶格装饰块 */}
                <rect x="376" y="72" width="32" height="18" fill="url(#gm-bayer-mid)" />
                <rect x="434" y="64" width="32" height="18" fill="url(#gm-bayer-mid)" />
                <rect x="492" y="72" width="32" height="18" fill="url(#gm-bayer-mid)" />
                <rect x="330" y="106" width="28" height="16" fill="url(#gm-bayer-mid)" />
                <rect x="542" y="106" width="28" height="16" fill="url(#gm-bayer-mid)" />

                {/* 柱头横檐与像素凹槽立柱 */}
                <rect x="150" y="328" width="102" height="10" fill="url(#gm-bayer-ultra)" />
                <rect x="628" y="328" width="92" height="10" fill="url(#gm-bayer-ultra)" />
                <rect x="192" y="352" width="4" height="340" fill="url(#gm-bayer-ultra)" />
                <rect x="210" y="352" width="4" height="340" fill="url(#gm-bayer-dense)" />
                <rect x="656" y="352" width="4" height="340" fill="url(#gm-bayer-ultra)" />
                <rect x="674" y="352" width="4" height="340" fill="url(#gm-bayer-dense)" />

                {/* 底部石阶基座 */}
                <rect x="140" y="704" width="580" height="14" fill="url(#gm-bayer-dense)" />
                <rect x="168" y="684" width="552" height="8" fill="url(#gm-bayer-mid)" />
            </g>
        </svg>
    </div>
);

/**
 * 2FA 像素格倒计时微条（默认 6 格映射 30 秒，剩余 <= 5 秒转为警告态）
 */
export const PixelCountdownBar = ({ expiry = 30, period = 30, segments = 6 }) => {
    const safeExpiry = Math.max(0, Math.min(period, Number(expiry) || 0));
    const filled = Math.ceil((safeExpiry / period) * segments);
    const urgent = safeExpiry > 0 && safeExpiry <= 5;

    return (
        <span
            className={`gm-totp-bar ${urgent ? 'is-urgent' : ''}`}
            aria-hidden="true"
        >
            {Array.from({ length: segments }).map((_, idx) => (
                <span
                    key={idx}
                    className={`gm-totp-bar-seg ${idx < filled ? 'is-on' : ''}`}
                />
            ))}
        </span>
    );
};

/**
 * 像素步进加载条（用于表格加载与异步等待）
 */
export const PixelLoader = ({ blocks = 6, label = '加载中...' }) => (
    <div className="gm-pixel-loader" role="status" aria-label={label}>
        <div className="gm-pixel-loader-track" aria-hidden="true">
            {Array.from({ length: blocks }).map((_, idx) => (
                <span
                    key={idx}
                    className="gm-pixel-loader-cell"
                    style={{ animationDelay: `${idx * 110}ms` }}
                />
            ))}
        </div>
        {label && <span className="gm-pixel-loader-label">{label}</span>}
    </div>
);

/**
 * 分格像素进度条（支持确定百分比与不定进度状态，兼容 progressbar ARIA 角色）
 */
export const PixelProgress = ({ progress = null, segments = 20 }) => {
    const isIndeterminate = progress === null || progress === undefined;
    const clamped = isIndeterminate ? 0 : Math.max(0, Math.min(1, Number(progress) || 0));
    const percent = isIndeterminate ? undefined : Math.round(clamped * 100);
    const activeCount = isIndeterminate ? 0 : Math.round(clamped * segments);

    return (
        <div
            className={`gm-pixel-progress ${isIndeterminate ? 'is-indeterminate' : ''}`}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
        >
            {Array.from({ length: segments }).map((_, idx) => {
                const filled = isIndeterminate || idx < activeCount;
                return (
                    <span
                        key={idx}
                        className={`gm-pixel-progress-seg ${filled ? 'is-filled' : ''}`}
                        style={isIndeterminate ? { animationDelay: `${(idx % 6) * 120}ms` } : undefined}
                    />
                );
            })}
        </div>
    );
};

export default PixelMascot;
