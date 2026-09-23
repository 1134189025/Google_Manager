/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            // 字体统一走 CSS 变量（系统字体栈）
            fontFamily: {
                sans: ['var(--font-sans)'],
                mono: ['var(--font-mono)'],
            },
            colors: {
                // 主题色令牌
                token: {
                    primary: 'var(--primary)',
                    accent: 'var(--accent)',
                    success: 'var(--success)',
                    danger: 'var(--danger)',
                    warning: 'var(--warning)',
                },
            },
            // 自定义动画
            animation: {
                'bounce': 'bounce 1s ease-in-out infinite',
            }
        },
    },
    plugins: [],
}
