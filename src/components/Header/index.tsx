import { NavLink, Link, useSearchParams } from 'react-router-dom';
import { useTheme } from '@/hooks/useTheme';

const Header = () => {
  const { theme, setTheme } = useTheme();
  const [params] = useSearchParams();
  const shared = new URLSearchParams();
  for (const key of ['year', 'month', 'run']) {
    const value = params.get(key);
    if (value) shared.set(key, value);
  }
  const destination = (pathname: string) => ({
    pathname,
    search: shared.toString(),
  });
  return (
    <header className="site-header">
      <a className="skip-link" href="#main-content">
        跳至主要内容
      </a>
      <Link
        className="site-brand"
        to={destination('/')}
        aria-label="Suuu 跑步档案首页"
      >
        <svg
          className="brand-symbol"
          width="36"
          height="36"
          viewBox="0 0 36 36"
          aria-hidden="true"
        >
          <path
            d="M7 28 18 7h11L18 28H7Zm0-12h12M17 22h12"
            fill="none"
            stroke="currentColor"
            strokeWidth="3.5"
          />
          <path
            d="M2 2h6M2 2v6M34 34h-6M34 34v-6"
            fill="none"
            stroke="currentColor"
          />
        </svg>
        <span translate="no">
          Suuu<span className="brand-slash">/</span>
          <small>跑步档案</small>
        </span>
      </Link>
      <nav className="header-nav" aria-label="主导航">
        <NavLink to={destination('/')} end>
          跑步记录
        </NavLink>
        <NavLink to={destination('/summary')}>数据总览</NavLink>
        <NavLink to={destination('/map')}>交互地图</NavLink>
        <NavLink to={destination('/atlas')}>足迹图册</NavLink>
      </nav>
      <div className="header-tools">
        <span className="header-note">保持奔跑</span>
        <button
          className="theme-toggle"
          type="button"
          aria-label={theme === 'dark' ? '切换为浅色模式' : '切换为深色模式'}
          title={theme === 'dark' ? '切换为浅色模式' : '切换为深色模式'}
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden="true"
          >
            {theme === 'dark' ? (
              <>
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" />
              </>
            ) : (
              <path d="M20.5 14A8.5 8.5 0 0 1 10 3.5 8.5 8.5 0 1 0 20.5 14Z" />
            )}
          </svg>
        </button>
      </div>
    </header>
  );
};
export default Header;
