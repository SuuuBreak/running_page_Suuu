import { useRef, type ReactNode } from 'react';

export function ArchivePageHead({
  eyebrow,
  title,
  description,
  aside,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  aside?: ReactNode;
}) {
  return (
    <div className="workspace-intro">
      <div>
        {eyebrow && (
          <p className="workspace-kicker">
            <i aria-hidden="true" />
            {eyebrow}
          </p>
        )}
        <h1 className="workspace-title">{title}</h1>
        {description && <p className="workspace-description">{description}</p>}
      </div>
      {aside && <div className="workspace-aside">{aside}</div>}
    </div>
  );
}
export function YearFilter({
  years,
  year,
  onChange,
}: {
  years: string[];
  year: string;
  onChange: (year: string) => void;
}) {
  return (
    <div className="year-picker" role="group" aria-label="选择统计年份">
      {[...years, 'all'].map((value) => (
        <button
          key={value}
          type="button"
          aria-pressed={year === value}
          onClick={() => onChange(value)}
        >
          {value === 'all' ? '全部年份' : value}
        </button>
      ))}
    </div>
  );
}
export function ArchiveMetrics({
  items,
}: {
  items: Array<{ label: string; value: string; unit?: string; note?: string }>;
}) {
  return (
    <div className="metrics-band archive-metrics">
      {items.map((item) => (
        <div key={item.label}>
          <span>
            {item.label}
            {item.note && <small>{item.note}</small>}
          </span>
          <strong key={item.value} className="motion-value">
            {item.value}
            {item.unit && <em>{item.unit}</em>}
          </strong>
        </div>
      ))}
    </div>
  );
}

export function ActivitySearch({
  value,
  onChange,
  label,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  className: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const clear = () => {
    input.current?.focus({ preventScroll: true });
    onChange('');
  };
  return (
    <div className={`archive-search ${className}`}>
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        aria-hidden="true"
      >
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="m16 16 4 4" />
      </svg>
      <input
        ref={input}
        type="search"
        name="q"
        autoComplete="off"
        placeholder="搜索日期、城市或活动…"
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (
            event.key === 'Escape' &&
            value &&
            !event.nativeEvent.isComposing
          ) {
            event.preventDefault();
            clear();
          }
        }}
      />
      {value && (
        <button
          type="button"
          className="archive-search-clear motion-glyph"
          aria-label="清除搜索"
          onClick={clear}
        >
          ×
        </button>
      )}
    </div>
  );
}
export function ArchiveFooter() {
  return (
    <footer className="journal-footer">
      <span>
        <span className="footer-logo" translate="no">
          Suuu.
        </span>{' '}
        跑步是日常，也是远方。
      </span>
      <span>
        每一次出发，都有迹可循。
        <a
          href="https://github.com/SuuuBreak/running_page_Suuu"
          target="_blank"
          rel="noreferrer"
        >
          项目源码 ↗
        </a>
      </span>
    </footer>
  );
}
