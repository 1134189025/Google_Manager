import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
    BrandLogo,
    CountdownBar,
    FluentIcon,
    LiquidGlassProvider,
    LogoStack,
    PageToolbar,
    RingCountdown,
    SegmentedControl,
} from '../components/glass';

describe('Liquid Glass 可复用组件库', () => {
    it('FluentIcon 支持常规/实心路径切换与别名解析，未知图标安全返回 null', () => {
        const { container, rerender } = render(<FluentIcon name="home" />);
        const regularPath = container.querySelector('svg path')?.getAttribute('d');
        expect(regularPath).toBeTruthy();

        rerender(<FluentIcon name="home" filled />);
        const filledPath = container.querySelector('svg path')?.getAttribute('d');
        expect(filledPath).toBeTruthy();
        expect(filledPath).not.toBe(regularPath);

        rerender(<FluentIcon name="gear" />);
        expect(container.querySelector('svg path')).not.toBeNull();

        rerender(<FluentIcon name="browser" />);
        const browserSvg = container.querySelector('svg');
        expect(browserSvg).not.toBeNull();
        expect(browserSvg.getAttribute('stroke')).toBe('currentColor');
        expect(browserSvg.querySelectorAll('path').length).toBe(5);

        rerender(<FluentIcon name="non-existent-icon" />);
        expect(container.querySelector('svg')).toBeNull();
    });

    it('BrandLogo 优先匹配内置品牌图标，未命中时优雅降级为首字母徽章', () => {
        const { container } = render(
            <div>
                <BrandLogo name="OpenAI" hints={['openai']} />
                <BrandLogo name="CustomLab" />
                <LogoStack items={['openai', 'claude', 'gemini', 'grok', 'visa']} max={3} />
            </div>,
        );

        const imgs = container.querySelectorAll('img');
        expect(imgs[0]?.getAttribute('src')).toBe('/brands/openai.svg');

        const letter = container.querySelector('.logo.letter');
        expect(letter).not.toBeNull();
        expect(letter.textContent).toBe('C');

        const stackLogos = container.querySelectorAll('.logo-stack .logo');
        expect(stackLogos.length).toBe(3);
    });

    it('SegmentedControl 正确同步 aria-pressed 与 active 类名并触发切换回调', () => {
        const onChange = vi.fn();
        render(
            <SegmentedControl
                label="周期"
                value="month"
                onChange={onChange}
                options={[
                    { value: 'month', label: '月付' },
                    { value: 'year', label: '年付' },
                ]}
            />,
        );

        const monthBtn = screen.getByRole('button', { name: '月付' });
        const yearBtn = screen.getByRole('button', { name: '年付' });
        expect(monthBtn).toHaveAttribute('aria-pressed', 'true');
        expect(monthBtn).toHaveClass('active');
        expect(yearBtn).toHaveAttribute('aria-pressed', 'false');

        fireEvent.click(yearBtn);
        expect(onChange).toHaveBeenCalledWith('year');
    });

    it('RingCountdown 使用无冲突 .gm-ring 且在剩余时间 <= 5 秒时切换为低剩余样式', () => {
        const { container, rerender } = render(<RingCountdown remaining={18} />);
        expect(container.querySelector('.gm-ring')).not.toHaveClass('low');

        rerender(<RingCountdown remaining={4} />);
        expect(container.querySelector('.gm-ring')).toHaveClass('low');
    });

    it('CountdownBar 按剩余秒数渲染进度宽度与预警状态', () => {
        const { container, rerender } = render(<CountdownBar remaining={15} period={30} />);
        const bar = container.querySelector('.otp-bar');
        expect(bar).not.toBeNull();
        expect(bar.querySelector('span').style.width).toBe('50%');
        expect(bar).not.toHaveClass('low');
        expect(bar).not.toHaveClass('crit');

        rerender(<CountdownBar remaining={8} period={30} />);
        expect(container.querySelector('.otp-bar')).toHaveClass('low');

        rerender(<CountdownBar remaining={3} period={30} />);
        expect(container.querySelector('.otp-bar')).toHaveClass('crit');
    });

    it('LiquidGlassProvider 与 PageToolbar 在 jsdom 中安全挂载并支持窄屏导航抽屉开关', () => {
        render(
            <LiquidGlassProvider>
                <PageToolbar title="测试页" subtitle="副标题" />
            </LiquidGlassProvider>,
        );

        expect(document.getElementById('lensDefs')).not.toBeNull();
        expect(screen.getByRole('heading', { name: '测试页' })).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: '打开导航' }));
        expect(document.body.classList.contains('nav-open')).toBe(true);

        fireEvent.keyDown(window, { key: 'Escape' });
        expect(document.body.classList.contains('nav-open')).toBe(false);
    });
});
