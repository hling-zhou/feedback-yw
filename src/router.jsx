import { createBrowserRouter, Navigate } from 'react-router-dom'

import RequireAuth from './components/auth/RequireAuth.jsx'
import AppShell from './components/AppShell.jsx'
import { InsightsProvider } from './context/InsightsContext.jsx'
import { UserTicketReviewProvider } from './context/UserTicketReviewContext.jsx'
import InsightWorkbench from './pages/InsightWorkbench.jsx'
import Feedbacks from './pages/Feedbacks.jsx'
import Themes from './pages/Themes.jsx'
import ImportHub from './pages/ImportHub.jsx'
import Settings from './pages/Settings.jsx'
import TagManagement from './pages/TagManagement.jsx'
import Users from './pages/Users.jsx'
import Actions from './pages/Actions.jsx'
import Login from './pages/Login.jsx'
import ChangePassword from './pages/ChangePassword.jsx'

/** @type {import('react-router-dom').RouteObject[]} */
const routes = [
  { path: '/login', element: <Login /> },
  { path: '/change-password', element: <ChangePassword /> },
  {
    path: '/',
    element: <RequireAuth />,
    children: [
      {
        element: (
          <InsightsProvider>
            <UserTicketReviewProvider>
              <AppShell />
            </UserTicketReviewProvider>
          </InsightsProvider>
        ),
        children: [
          { index: true, element: <Navigate to="/workbench" replace /> },
          { path: 'workbench', element: <InsightWorkbench /> },
          { path: 'workbench/analysis', element: <Themes /> },
          { path: 'dashboard', element: <Navigate to="/workbench" replace /> },
          { path: 'feedbacks', element: <Feedbacks /> },
          { path: 'actions', element: <Actions /> },
          { path: 'themes', element: <Navigate to="/workbench/analysis" replace /> },
          { path: 'import', element: <ImportHub /> },
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
