import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'

// 主题与组件样式先行引入，Tailwind（含 utilities）最后引入，
// 以符合 base < components < utilities 的层叠预期：
// gm-* 组件类提供默认外观，utilities 可在具体元素上覆盖它。
import './styles/theme.css'
import './styles/layout.css'
import './styles/components.css'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>,
)
