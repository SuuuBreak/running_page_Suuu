import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider, createBrowserRouter } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import NotFound from './pages/404';
import ReactGA from 'react-ga4';
import {
  GOOGLE_ANALYTICS_TRACKING_ID,
  USE_GOOGLE_ANALYTICS,
} from './utils/const';
import '@/styles/index.css';
import { withOptionalGAPageTracking } from './utils/trackRoute';
import Journal from '@/pages/journal';
import '@/styles/journal.css';
import '@/styles/system.css';

const Index = React.lazy(() => import('./pages'));
const HomePage = React.lazy(() => import('@/pages/total'));
const Atlas = React.lazy(() => import('@/pages/atlas'));

if (USE_GOOGLE_ANALYTICS) {
  ReactGA.initialize(GOOGLE_ANALYTICS_TRACKING_ID);
}

const routes = createBrowserRouter(
  [
    {
      path: '/',
      element: withOptionalGAPageTracking(<Journal />),
    },
    {
      path: 'map',
      element: withOptionalGAPageTracking(<Index />),
    },
    {
      path: 'summary',
      element: withOptionalGAPageTracking(<HomePage />),
    },
    {
      path: 'atlas',
      element: withOptionalGAPageTracking(<Atlas />),
    },
    {
      path: '*',
      element: withOptionalGAPageTracking(<NotFound />),
    },
  ],
  { basename: import.meta.env.BASE_URL }
);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HelmetProvider>
      <React.Suspense
        fallback={
          <div className="route-loading" role="status">
            正在加载跑步档案…
          </div>
        }
      >
        <RouterProvider router={routes} />
      </React.Suspense>
    </HelmetProvider>
  </React.StrictMode>
);
