import React, { createContext, forwardRef, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

/**
 * 液态玻璃边缘折射预设参数（严格对齐预览页）
 * - sidebar / sheet / panel: 绝对像素斜切边宽（bezel）与色散位移量（disp）
 * - cap / drop: 相对短边比例（rel: true）
 */
const LENS_PRESETS = {
    sidebar: { bezel: 18, disp: 16 },
    sheet: { bezel: 22, disp: 20 },
    panel: { bezel: 16, disp: 16 },
    cap: { bezel: 0.4, disp: 7, rel: true },
    drop: { bezel: 0.45, disp: 6, rel: true },
};

const SVG_NS = 'http://www.w3.org/2000/svg';

function safeMatchMedia(query) {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
        return null;
    }
    try {
        return window.matchMedia(query);
    } catch {
        return null;
    }
}

function detectChromium() {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
    return Boolean(window.chrome) || /Chrome\/|Edg\//.test(navigator.userAgent || '');
}

const mapCache = new Map();
let lensSeq = 0;

/**
 * 基于圆角矩形有符号距离场（SDF）生成半分辨率法线位移图（R=nx, G=ny）
 */
function buildLensMap(w, h, r, bezel) {
    const key = `${w}x${h}r${r}b${bezel}`;
    if (mapCache.has(key)) return mapCache.get(key);

    if (typeof document === 'undefined') return null;
    const k = 2;
    const mw = Math.max(2, Math.ceil(w / k));
    const mh = Math.max(2, Math.ceil(h / k));
    const canvas = document.createElement('canvas');
    canvas.width = mw;
    canvas.height = mh;

    let ctx;
    try {
        ctx = canvas.getContext('2d');
    } catch {
        return null;
    }
    if (!ctx || typeof ctx.createImageData !== 'function') return null;

    const img = ctx.createImageData(mw, mh);
    const d = img.data;
    const hw = w / 2;
    const hh = h / 2;

    for (let y = 0; y < mh; y += 1) {
        for (let x = 0; x < mw; x += 1) {
            const px = (x + 0.5) * k;
            const py = (y + 0.5) * k;
            const dx = px - hw;
            const dy = py - hh;
            const ax = Math.abs(dx) - (hw - r);
            const ay = Math.abs(dy) - (hh - r);
            const ox = Math.max(ax, 0);
            const oy = Math.max(ay, 0);
            const sd = Math.hypot(ox, oy) + Math.min(Math.max(ax, ay), 0) - r;
            const dist = Math.max(0, -sd);

            let R = 128;
            let G = 128;
            if (dist < bezel) {
                const u = 1 - dist / bezel;
                const mag = 1 - Math.sqrt(Math.max(0, 1 - u * u));
                let nx;
                let ny;
                if (ax > 0 && ay > 0) {
                    const len = Math.hypot(ox, oy) || 1;
                    nx = (ox / len) * Math.sign(dx);
                    ny = (oy / len) * Math.sign(dy);
                } else if (ax > ay) {
                    nx = Math.sign(dx);
                    ny = 0;
                } else {
                    nx = 0;
                    ny = Math.sign(dy);
                }
                R = Math.round(128 - nx * mag * 127);
                G = Math.round(128 - ny * mag * 127);
            }
            const idx = (y * mw + x) * 4;
            d[idx] = R;
            d[idx + 1] = G;
            d[idx + 2] = 128;
            d[idx + 3] = 255;
        }
    }

    try {
        ctx.putImageData(img, 0, 0);
        const url = canvas.toDataURL('image/png');
        if (!url || url === 'data:,') return null;
        if (mapCache.size > 60) mapCache.clear();
        mapCache.set(key, url);
        return url;
    } catch {
        return null;
    }
}

function upsertLensFilter(defs, id, w, h, url, scale) {
    if (!defs || !url) return false;
    let filter = defs.querySelector(`#${id}`);
    if (!filter) {
        filter = document.createElementNS(SVG_NS, 'filter');
        filter.id = id;
        defs.appendChild(filter);
    }
    filter.setAttribute('x', '0');
    filter.setAttribute('y', '0');
    filter.setAttribute('width', String(w));
    filter.setAttribute('height', String(h));
    filter.setAttribute('filterUnits', 'userSpaceOnUse');
    filter.setAttribute('primitiveUnits', 'userSpaceOnUse');
    filter.setAttribute('color-interpolation-filters', 'sRGB');

    const ch = (inName, s, keep, res) =>
        `<feDisplacementMap in="${inName}" in2="map" scale="${s}" xChannelSelector="R" yChannelSelector="G" result="d${res}"/>` +
        `<feColorMatrix in="d${res}" type="matrix" values="${keep}" result="${res}"/>`;

    filter.innerHTML =
        `<feImage href="${url}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="none" result="map"/>` +
        ch('SourceGraphic', scale, '1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0', 'r') +
        ch('SourceGraphic', scale * 0.96, '0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0', 'g') +
        ch('SourceGraphic', scale * 0.92, '0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0', 'b') +
        `<feComposite in="r" in2="g" operator="arithmetic" k2="1" k3="1" result="rg"/>` +
        `<feComposite in="rg" in2="b" operator="arithmetic" k2="1" k3="1"/>`;
    return true;
}

const LiquidGlassContext = createContext({
    navOpen: false,
    openNav: () => {},
    closeNav: () => {},
    toggleNav: () => {},
    scrolled: false,
    setScrolled: () => {},
    lensActive: false,
    refreshLenses: () => {},
});

export const useLiquidGlass = () => useContext(LiquidGlassContext);

/**
 * 全局液态玻璃引擎 Provider
 * - Chromium / WebView2: 挂载 SVG SDF 边缘折射滤镜（R/G/B 三通道微色散）
 * - macOS WKWebView / Firefox / 降低透明度模式: 自动优雅降级为纯磨砂毛玻璃
 * - 统一管理鼠标跟随高光 (--mx/--my)、窄屏抽屉状态与粘性工具栏滚动溶解态
 */
export const LiquidGlassProvider = ({ children }) => {
    const defsRef = useRef(null);
    const roRef = useRef(null);
    const watchedRef = useRef(new WeakSet());
    const [navOpen, setNavOpen] = useState(false);
    const [scrolled, setScrolled] = useState(false);
    const [lensActive, setLensActive] = useState(false);

    const openNav = useCallback(() => setNavOpen(true), []);
    const closeNav = useCallback(() => setNavOpen(false), []);
    const toggleNav = useCallback(() => setNavOpen(prev => !prev), []);

    const isLensEnabled = useCallback(() => {
        if (!detectChromium()) return false;
        const mql = safeMatchMedia('(prefers-reduced-transparency: reduce)');
        return !(mql && mql.matches);
    }, []);

    const updateLens = useCallback((el) => {
        if (!el || !(el instanceof Element)) return;
        if (!isLensEnabled()) {
            el.classList.remove('has-lens');
            return;
        }
        const defs = defsRef.current;
        if (!defs) return;

        const w = Math.round(el.offsetWidth || 0);
        const h = Math.round(el.offsetHeight || 0);
        if (w < 8 || h < 8) return;

        const preset = LENS_PRESETS[el.dataset.lens] || LENS_PRESETS.cap;
        const cs = typeof window.getComputedStyle === 'function' ? window.getComputedStyle(el) : null;
        const radius = Math.min(parseFloat(cs?.borderTopLeftRadius || '0') || 0, w / 2, h / 2);
        const minSide = Math.min(w, h);
        const bezel = Math.max(
            4,
            preset.rel ? minSide * preset.bezel : Math.min(preset.bezel, minSide / 2),
        );

        const url = buildLensMap(w, h, Math.round(radius), Math.round(bezel));
        if (!url) return;

        if (!el.dataset.lensId) {
            lensSeq += 1;
            el.dataset.lensId = `lens${lensSeq}`;
        }
        const id = el.dataset.lensId;
        if (upsertLensFilter(defs, id, w, h, url, preset.disp * 2)) {
            el.style.setProperty('--lens', `url(#${id})`);
            el.classList.add('has-lens');
        }
    }, [isLensEnabled]);

    const refreshLenses = useCallback((root = document) => {
        if (typeof document === 'undefined') return;
        const enabled = isLensEnabled();
        document.documentElement.classList.toggle('lens-on', enabled);
        setLensActive(enabled);

        const nodes = root.querySelectorAll ? root.querySelectorAll('.glass') : [];
        nodes.forEach((el) => {
            if (!el.dataset.lens) el.dataset.lens = 'cap';
            if (!watchedRef.current.has(el)) {
                watchedRef.current.add(el);
                roRef.current?.observe(el);
            }
            updateLens(el);
        });

        const defs = defsRef.current;
        if (defs) {
            defs.querySelectorAll('filter').forEach((filter) => {
                if (!document.querySelector(`[data-lens-id="${filter.id}"]`)) {
                    filter.remove();
                }
            });
        }
    }, [isLensEnabled, updateLens]);

    // 同步 body.nav-open 供 CSS 响应式抽屉使用
    useEffect(() => {
        if (typeof document === 'undefined') return undefined;
        document.body.classList.toggle('nav-open', navOpen);
        return () => document.body.classList.remove('nav-open');
    }, [navOpen]);

    // Escape 关闭窄屏导航抽屉
    useEffect(() => {
        if (!navOpen) return undefined;
        const onKeyDown = (event) => {
            if (event.key === 'Escape') {
                setNavOpen(false);
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [navOpen]);

    // 挂载 ResizeObserver、MutationObserver、透明度媒体查询与指针高光跟随
    useEffect(() => {
        if (typeof window === 'undefined' || typeof document === 'undefined') return undefined;

        const ro = typeof window.ResizeObserver === 'function'
            ? new window.ResizeObserver((entries) => {
                entries.forEach((entry) => updateLens(entry.target));
            })
            : null;
        roRef.current = ro;

        refreshLenses(document);

        let moRaf = 0;
        const scheduleRefresh = () => {
            if (moRaf) return;
            moRaf = window.requestAnimationFrame(() => {
                moRaf = 0;
                refreshLenses(document);
            });
        };

        const mo = typeof window.MutationObserver === 'function'
            ? new window.MutationObserver((mutations) => {
                for (const m of mutations) {
                    if (m.type === 'childList' && (m.addedNodes.length > 0 || m.removedNodes.length > 0)) {
                        scheduleRefresh();
                        break;
                    }
                }
            })
            : null;

        if (mo && document.body) {
            mo.observe(document.body, { childList: true, subtree: true });
        }

        const reduceTransparency = safeMatchMedia('(prefers-reduced-transparency: reduce)');
        const onTransparencyChange = () => refreshLenses(document);
        reduceTransparency?.addEventListener?.('change', onTransparencyChange);

        let hoverRaf = 0;
        const onPointerMove = (e) => {
            const target = e.target;
            if (!target || typeof target.closest !== 'function') return;
            const glassEl = target.closest('.glass');
            if (!glassEl || hoverRaf) return;
            hoverRaf = window.requestAnimationFrame(() => {
                hoverRaf = 0;
                const rect = glassEl.getBoundingClientRect();
                if (rect.width > 0 && rect.height > 0) {
                    glassEl.style.setProperty('--mx', `${((e.clientX - rect.left) / rect.width) * 100}%`);
                    glassEl.style.setProperty('--my', `${((e.clientY - rect.top) / rect.height) * 100}%`);
                }
            });
        };
        document.addEventListener('pointermove', onPointerMove, { passive: true });

        return () => {
            if (moRaf) window.cancelAnimationFrame(moRaf);
            if (hoverRaf) window.cancelAnimationFrame(hoverRaf);
            mo?.disconnect();
            ro?.disconnect();
            roRef.current = null;
            reduceTransparency?.removeEventListener?.('change', onTransparencyChange);
            document.removeEventListener('pointermove', onPointerMove);
            document.documentElement.classList.remove('lens-on');
        };
    }, [refreshLenses, updateLens]);

    const value = useMemo(() => ({
        navOpen,
        openNav,
        closeNav,
        toggleNav,
        scrolled,
        setScrolled,
        lensActive,
        refreshLenses,
    }), [navOpen, openNav, closeNav, toggleNav, scrolled, lensActive, refreshLenses]);

    return (
        <LiquidGlassContext.Provider value={value}>
            <svg
                width="0"
                height="0"
                style={{ position: 'absolute', pointerEvents: 'none' }}
                aria-hidden="true"
                focusable="false"
            >
                <defs id="lensDefs" ref={defsRef} />
            </svg>
            {children}
        </LiquidGlassContext.Provider>
    );
};

/**
 * 通用液态玻璃表面容器
 */
export const GlassSurface = forwardRef(({
    as: Component = 'div',
    lens = 'cap',
    className = '',
    children,
    ...rest
}, ref) => (
    <Component
        ref={ref}
        className={`glass ${className}`.trim()}
        data-lens={lens}
        {...rest}
    >
        {children}
    </Component>
));

GlassSurface.displayName = 'GlassSurface';
