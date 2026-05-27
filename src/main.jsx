import React from 'react'
import ReactDOM from 'react-dom/client'
import 'antd/dist/reset.css'
import App from './App.jsx'
import './index.css'
import { getLocalIdbAdapter } from './storage/index.js'

// 预初始化本机 IndexedDB，供首次登录迁移至共享库时使用
getLocalIdbAdapter()
  .init()
  .catch((err) => console.warn('[local storage] init failed:', err))

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
