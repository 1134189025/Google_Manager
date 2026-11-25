import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'

// 1. od-layout 结构原语 + Tailwind Preflight
import './styles/base.css'
// 2. Liquid Glass + Mica 设计令牌、动效与核心材质样式
import './styles/theme.css'
import './styles/motion.css'
import './styles/liquid-glass.css'
// 3. 应用布局与全业务组件样式
import './styles/layout.css'
import './styles/components.css'
// 4. Tailwind components & utilities 后置引入，确保 utilities 可做局部微调
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>,
)
