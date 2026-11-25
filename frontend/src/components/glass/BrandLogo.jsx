import React, { useEffect, useState } from 'react';
import { BRAND_FILES, resolveBrandIconUrl } from '../../utils/brandIcons';

/**
 * 统一品牌 Logo 组件
 * 优先匹配 frontend/public/brands/ 下的内置 SVG/PNG 品牌图标，
 * 未命中或加载失败时优雅降级为首字母单色徽章（.logo.letter）。
 */
export const BrandLogo = ({
    brand,
    hints,
    name = '',
    size = 'md',
    className = '',
    alt = '',
}) => {
    const [failed, setFailed] = useState(false);

    let url = null;
    if (brand && typeof brand === 'string') {
        const directKey = brand.trim().toLowerCase();
        if (BRAND_FILES[directKey]) {
            url = `/brands/${BRAND_FILES[directKey]}`;
        }
    }
    if (!url) {
        const hintList = [
            ...(Array.isArray(hints) ? hints : hints ? [hints] : []),
            brand,
            name,
        ].filter(Boolean);
        url = resolveBrandIconUrl(hintList);
    }

    useEffect(() => {
        setFailed(false);
    }, [url]);

    const sizeClass = size === 'xs' ? 'xs' : size === 'sm' ? 'sm' : '';
    const px = size === 'xs' ? 14 : size === 'sm' ? 18 : 24;

    if (url && !failed) {
        return (
            <span className={`logo ${sizeClass} ${className}`.trim()} aria-hidden={alt ? undefined : 'true'}>
                <img
                    src={url}
                    alt={alt}
                    width={px}
                    height={px}
                    loading="lazy"
                    onError={() => setFailed(true)}
                />
            </span>
        );
    }

    const fallbackChar = String(name || brand || '?').trim().charAt(0).toUpperCase() || '?';
    return (
        <span className={`logo letter ${sizeClass} ${className}`.trim()} aria-hidden="true">
            {fallbackChar}
        </span>
    );
};

/**
 * 多品牌图标叠层栈（用于首页资产瓷砖、概览卡片等处）
 */
export const LogoStack = ({
    items = [],
    max = 4,
    size = 'xs',
    className = '',
}) => {
    const visible = items.filter(Boolean).slice(0, max);
    if (visible.length === 0) return null;

    return (
        <span className={`logo-stack ${className}`.trim()} aria-hidden="true">
            {visible.map((item, idx) => {
                if (typeof item === 'string') {
                    return <BrandLogo key={`${item}-${idx}`} brand={item} name={item} size={size} />;
                }
                return (
                    <BrandLogo
                        key={`${item.brand || item.name || idx}-${idx}`}
                        brand={item.brand}
                        hints={item.hints}
                        name={item.name}
                        size={size}
                    />
                );
            })}
        </span>
    );
};

export default BrandLogo;
