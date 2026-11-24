import type { ReactNode } from 'react';

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
          <strong>
            {item.value}
            {item.unit && <em>{item.unit}</em>}
          </strong>
        </div>
      ))}
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
