import { RouterProvider } from 'react-router-dom'
import { ConfigProvider, App as AntdApp } from 'antd'
import zhCN from 'antd/locale/zh_CN'

import { AuthProvider } from './context/AuthContext.jsx'
import { appRouter } from './router.jsx'
import { appTheme } from './theme/appTheme.js'

export default function App() {
  return (
    <ConfigProvider locale={zhCN} theme={appTheme}>
      <AntdApp>
        <AuthProvider>
          <RouterProvider router={appRouter} />
        </AuthProvider>
      </AntdApp>
    </ConfigProvider>
  )
}
