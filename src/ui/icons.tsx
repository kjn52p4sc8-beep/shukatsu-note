import type { ReactNode } from 'react';

/** 線で描いた小さなアイコン。色は親の文字色に合わせる。 */
function Icon({ children, size = 22 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"
    >
      {children}
    </svg>
  );
}

export const MenuIcon = () => (
  <Icon>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </Icon>
);

export const BellIcon = () => (
  <Icon>
    <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z" />
    <path d="M10 20a2 2 0 0 0 4 0" />
  </Icon>
);

export const CalendarIcon = () => (
  <Icon>
    <rect x="4" y="5.5" width="16" height="14.5" rx="2.5" />
    <path d="M4 10h16M8.5 3.5v4M15.5 3.5v4" />
    <path d="M8.5 14h.01M12 14h.01M15.5 14h.01M8.5 17h.01M12 17h.01" />
  </Icon>
);

export const BuildingIcon = () => (
  <Icon>
    <path d="M5 20V6.5A1.5 1.5 0 0 1 6.5 5h7A1.5 1.5 0 0 1 15 6.5V20" />
    <path d="M15 11h3.5A1.5 1.5 0 0 1 20 12.5V20M3.5 20h17" />
    <path d="M8.5 9h.01M11.5 9h.01M8.5 12.5h.01M11.5 12.5h.01M8.5 16h.01M11.5 16h.01" />
  </Icon>
);

export const DocIcon = () => (
  <Icon>
    <path d="M7.5 3.5h6l4 4V19a1.5 1.5 0 0 1-1.5 1.5h-8.5A1.5 1.5 0 0 1 6 19V5a1.5 1.5 0 0 1 1.5-1.5z" />
    <path d="M13.5 3.5v4h4M9 12h6M9 15.5h6" />
  </Icon>
);

export const ChatIcon = () => (
  <Icon>
    <path d="M5.5 5h13A1.5 1.5 0 0 1 20 6.5v8a1.5 1.5 0 0 1-1.5 1.5H11l-4.5 3.5V16h-1A1.5 1.5 0 0 1 4 14.5v-8A1.5 1.5 0 0 1 5.5 5z" />
    <path d="M9 10.5h.01M12 10.5h.01M15 10.5h.01" />
  </Icon>
);

export const SearchIcon = () => (
  <Icon size={20}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="M16 16l4 4" />
  </Icon>
);

export const MailIcon = () => (
  <Icon>
    <rect x="3.5" y="5.5" width="17" height="13" rx="2.5" />
    <path d="M4.5 7.5l7.5 6 7.5-6" />
  </Icon>
);

export const TableIcon = () => (
  <Icon>
    <rect x="4" y="4.5" width="16" height="15" rx="2.5" />
    <path d="M4 9.5h16M4 14.5h16M10 9.5v10" />
  </Icon>
);

export const ChevronIcon = () => (
  <Icon size={20}>
    <path d="M9 5.5l6.5 6.5L9 18.5" />
  </Icon>
);
