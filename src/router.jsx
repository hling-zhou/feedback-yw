import { createBrowserRouter, Navigate } from 'react-router-dom'

import RequireAuth from './components/auth/RequireAuth.jsx'
import AppShell from './components/AppShell.jsx'
import { InsightsProvider } from './context/InsightsContext.jsx'
import InsightWorkbench from './pages/InsightWorkbench.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Feedbacks from './pages/Feedbacks.jsx'
import Themes from './pages/Themes.jsx'
import Import from './pages/Import.jsx'
import Settings from './pages/Settings.jsx'
import TagManagement from './pages/TagManagement.jsx'
import Users from './pages/Users.jsx'
import Login from './pages/Login.jsx'

/** @type {import('react-router-dom').RouteObject[]} */
const routes = [
  { path: '/login', element: <Login /> },
  {
    path: '/',
    element: <RequireAuth />,
    children: [
      {
        element: (
          <InsightsProvider>
            <AppShell />
          </InsightsProvider>
        ),
        children: [
          { index: true, element: <Navigate to="/workbench" replace /> },
          { path: 'workbench', element: <InsightWorkbench /> },
          { path: 'workbench/analysis', element: <Themes /> },
          { path: 'dashboard', element: <Dashboard /> },
          { path: 'feedbacks', element: <Feedbacks /> },
          { path: 'themes', element: <Navigate to="/workbench/analysis" replace /> },
          { path: 'import', element: <Import /> },
          { path: 'settings', element: <Settings /> },
          { path: 'tags', element: <TagManagement /> },
          { path: 'users', element: <Users /> },
          { path: '*', element: <Navigate to="/workbench" replace /> },
        ],
      },
    ],
  },
]

export const appRouter = createBrowserRouter(routes)
