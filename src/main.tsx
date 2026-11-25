import React from 'react';
import ReactDOM from 'react-dom/client';
import {
  Outlet,
  RouterProvider,
  ScrollRestoration,
  createBrowserRouter,
  useNavigation,
} from 'react-router-dom';
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
import Header from '@/components/Header';
import '@/styles/journal.css';
import '@/styles/system.css';
import '@/styles/motion.css';

function AppFrame() {
  const { state } = useNavigation();
  const [pending, setPending] = React.useState(false);
  React.useEffect(() => {
    if (state === 'idle') {
      setPending(false);
      return;
    }
    const delay = window.setTimeout(() => setPending(true), 180);
    return () => window.clearTimeout(delay);
  }, [state]);

  return (
    <>
      <Header pending={pending} />
      <Outlet />
      <ScrollRestoration />
    </>
  );
}

if (USE_GOOGLE_ANALYTICS) {
  ReactGA.initialize(GOOGLE_ANALYTICS_TRACKING_ID);
}

const routes = createBrowserRouter(
  [
    {
      path: '/',
      element: <AppFrame />,
      children: [
        {
          index: true,
          element: withOptionalGAPageTracking(<Journal />),
        },
        {
          path: 'map',
          lazy: async () => {
            const { default: MapWorkspace } = await import('./pages');
            return { element: withOptionalGAPageTracking(<MapWorkspace />) };
          },
        },
        {
          path: 'summary',
          lazy: async () => {
            const { default: Summary } = await import('@/pages/total');
            return { element: withOptionalGAPageTracking(<Summary />) };
          },
        },
        {
          path: 'atlas',
          lazy: async () => {
            const { default: Atlas } = await import('@/pages/atlas');
            return { element: withOptionalGAPageTracking(<Atlas />) };
          },
        },
        { path: '*', element: withOptionalGAPageTracking(<NotFound />) },
      ].map((route) => ({
        ...route,
        errorElement: (
          <main id="main-content" className="journal-layout workspace-empty">
            <strong>这个页面暂时打不开</strong>
            <button
              className="workspace-button"
              onClick={() => location.reload()}
            >
              重新加载
            </button>
          </main>
        ),
      })),
    },
  ],
  { basename: import.meta.env.BASE_URL }
);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HelmetProvider>
      <RouterProvider
        router={routes}
        fallbackElement={
          <div className="route-loading" role="status">
            正在加载跑步档案…
          </div>
        }
      />
    </HelmetProvider>
  </React.StrictMode>
);
