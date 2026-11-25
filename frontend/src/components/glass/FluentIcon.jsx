import React from 'react';
import { FLUENT_ICONS, FLUENT_ICON_ALIAS } from './fluentIconsData';

/**
 * 检查图标名称是否存在于 Fluent UI 图标集中
 */
export function hasFluentIcon(name) {
    if (!name) return false;
    const key = FLUENT_ICONS[name] ? name : FLUENT_ICON_ALIAS[name];
    return Boolean(key && FLUENT_ICONS[key]);
}

/**
 * Microsoft Fluent UI System Icons (20x20, Regular + Filled)
 * 严格对应预览页的图标体系：常态使用 Regular 线框，选中态使用 Filled 实心。
 */
const FluentIcon = ({
    name,
    filled = false,
    size,
    className = '',
    style,
    ...rest
}) => {
    const key = FLUENT_ICONS[name] ? name : FLUENT_ICON_ALIAS[name];
    const def = key ? FLUENT_ICONS[key] : null;
    if (!def) return null;

    const paths = (filled && def.f) || def.r || def.f || [];
    const mergedStyle = size != null
        ? {
            '--od-icon-size': typeof size === 'number' ? `${size}px` : size,
            ...style,
        }
        : style;

    return (
        <svg
            className={`od-icon ${className}`.trim()}
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
            focusable="false"
            style={mergedStyle}
            {...rest}
        >
            {paths.map((d, idx) => (
                <path key={idx} d={d} />
            ))}
        </svg>
    );
};

export default FluentIcon;
