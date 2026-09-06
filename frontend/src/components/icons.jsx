// Minimal inline SVG icon set — no external icon dependency.
// Icons use stroke="currentColor", size 18 by default.

function Icon({ size = 18, children, ...props }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export const Icons = {
  dashboard: (p) => (
    <Icon {...p}>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </Icon>
  ),
  users: (p) => (
    <Icon {...p}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </Icon>
  ),
  org: (p) => (
    <Icon {...p}>
      <rect x="4" y="4" width="16" height="6" rx="1.5" />
      <rect x="4" y="14" width="7" height="6" rx="1.5" />
      <rect x="13" y="14" width="7" height="6" rx="1.5" />
      <path d="M12 10v4" />
    </Icon>
  ),
  target: (p) => (
    <Icon {...p}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
    </Icon>
  ),
  award: (p) => (
    <Icon {...p}>
      <circle cx="12" cy="9" r="6" />
      <path d="M8.5 14.5 7 22l5-3 5 3-1.5-7.5" />
    </Icon>
  ),
  chart: (p) => (
    <Icon {...p}>
      <path d="M3 3v18h18" />
      <path d="M7 15v-3" />
      <path d="M11.5 15V8" />
      <path d="M16 15v-6" />
    </Icon>
  ),
  clipboard: (p) => (
    <Icon {...p}>
      <rect x="5" y="4" width="14" height="17" rx="2" />
      <path d="M9 4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1H9z" />
      <path d="M9 11h6" />
      <path d="M9 15h6" />
    </Icon>
  ),
  spark: (p) => (
    <Icon {...p}>
      <path d="M12 3v3" />
      <path d="M12 18v3" />
      <path d="M3 12h3" />
      <path d="M18 12h3" />
      <path d="M5.6 5.6l2.1 2.1" />
      <path d="M16.3 16.3l2.1 2.1" />
      <path d="M5.6 18.4l2.1-2.1" />
      <path d="M16.3 7.7l2.1-2.1" />
    </Icon>
  ),
  shield: (p) => (
    <Icon {...p}>
      <path d="M12 22s8-3.5 8-10V5l-8-3-8 3v7c0 6.5 8 10 8 10z" />
      <path d="m9 12 2 2 4-4" />
    </Icon>
  ),
  list: (p) => (
    <Icon {...p}>
      <path d="M8 6h13" />
      <path d="M8 12h13" />
      <path d="M8 18h13" />
      <path d="M3 6h.01" />
      <path d="M3 12h.01" />
      <path d="M3 18h.01" />
    </Icon>
  ),
  flag: (p) => (
    <Icon {...p}>
      <path d="M5 21V4" />
      <path d="M5 4h13l-2 4 2 4H5" />
    </Icon>
  ),
  user: (p) => (
    <Icon {...p}>
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </Icon>
  ),
  logout: (p) => (
    <Icon {...p}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="m16 17 5-5-5-5" />
      <path d="M21 12H9" />
    </Icon>
  ),
  chevronDown: (p) => (
    <Icon {...p}>
      <path d="m6 9 6 6 6-6" />
    </Icon>
  ),
  chevronLeft: (p) => (
    <Icon {...p}>
      <path d="m15 18-6-6 6-6" />
    </Icon>
  ),
  chevronRight: (p) => (
    <Icon {...p}>
      <path d="m9 18 6-6-6-6" />
    </Icon>
  ),
  chevronUp: (p) => (
    <Icon {...p}>
      <path d="m18 15-6-6-6 6" />
    </Icon>
  ),
  copy: (p) => (
    <Icon {...p}>
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </Icon>
  ),
  plus: (p) => (
    <Icon {...p}>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </Icon>
  ),
  close: (p) => (
    <Icon {...p}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </Icon>
  ),
  check: (p) => (
    <Icon {...p}>
      <path d="M20 6 9 17l-5-5" />
    </Icon>
  ),
  alert: (p) => (
    <Icon {...p}>
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </Icon>
  ),
  clock: (p) => (
    <Icon {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </Icon>
  ),
  briefcase: (p) => (
    <Icon {...p}>
      <rect x="2" y="7" width="20" height="14" rx="2" />
      <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
      <path d="M2 13h20" />
    </Icon>
  ),
  calendar: (p) => (
    <Icon {...p}>
      <rect x="3" y="4" width="18" height="17" rx="2" />
      <path d="M16 2v4" />
      <path d="M8 2v4" />
      <path d="M3 10h18" />
    </Icon>
  ),
  send: (p) => (
    <Icon {...p}>
      <path d="m22 2-7 20-4-9-9-4z" />
      <path d="M22 2 11 13" />
    </Icon>
  ),
  spinner: (p) => (
    <Icon {...p}>
      <path d="M21 12a9 9 0 1 1-6.2-8.56" />
    </Icon>
  ),
  arrowUp: (p) => (
    <Icon {...p}>
      <path d="M12 19V5" />
      <path d="m5 12 7-7 7 7" />
    </Icon>
  ),
  arrowDown: (p) => (
    <Icon {...p}>
      <path d="M12 5v14" />
      <path d="m19 12-7 7-7-7" />
    </Icon>
  ),
  edit: (p) => (
    <Icon {...p}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </Icon>
  ),
  external: (p) => (
    <Icon {...p}>
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
    </Icon>
  ),
  more: (p) => (
    <Icon {...p}>
      <circle cx="5" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1.2" fill="currentColor" stroke="none" />
    </Icon>
  ),
  eye: (p) => (
    <Icon {...p}>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
    </Icon>
  ),
  trash: (p) => (
    <Icon {...p}>
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </Icon>
  ),
  menu: (p) => (
    <Icon {...p}>
      <path d="M4 7h16" />
      <path d="M4 12h16" />
      <path d="M4 17h16" />
    </Icon>
  ),
  swap: (p) => (
    <Icon {...p}>
      <path d="M8 3 4 7l4 4" />
      <path d="M4 7h16" />
      <path d="m16 21 4-4-4-4" />
      <path d="M20 17H4" />
    </Icon>
  ),
  key: (p) => (
    <Icon {...p}>
      <circle cx="7.5" cy="15.5" r="4.5" />
      <path d="m10.8 12.2 8.7-8.7" />
      <path d="M16 7.5 19 10.5" />
      <path d="M12.5 12.5 15 15" />
    </Icon>
  ),
  lock: (p) => (
    <Icon {...p}>
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </Icon>
  ),
  search: (p) => (
    <Icon {...p}>
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.35-4.35" />
    </Icon>
  ),
  zoomIn: (p) => (
    <Icon {...p}>
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
      <line x1="11" y1="8" x2="11" y2="14" />
      <line x1="8" y1="11" x2="14" y2="11" />
    </Icon>
  ),
  zoomOut: (p) => (
    <Icon {...p}>
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
      <line x1="8" y1="11" x2="14" y2="11" />
    </Icon>
  ),
  refresh: (p) => (
    <Icon {...p}>
      <path d="M3 12a9 9 0 0 1 15.5-6.3L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-15.5 6.3L3 16" />
      <path d="M3 21v-5h5" />
    </Icon>
  ),
  filter: (p) => (
    <Icon {...p}>
      <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
    </Icon>
  ),
  maximize: (p) => (
    <Icon {...p}>
      <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
    </Icon>
  ),
  minimize: (p) => (
    <Icon {...p}>
      <path d="M4 14h6v6m10-10h-6V4m0 6 7-7M9 15l-7 7" />
    </Icon>
  ),

  // ── Org Chart tier icons ──────────────────────────────────────────────────

  /** Authority / Root – classical crown */
  crown: (p) => (
    <Icon {...p}>
      <path d="M3 19h18" />
      <path d="M3 19 6 8l6 5 6-5 3 11" />
      <circle cx="12" cy="5" r="1.5" fill="currentColor" stroke="none" />
    </Icon>
  ),

  /** Directorate – office building */
  building: (p) => (
    <Icon {...p}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M9 21V9h6v12" />
      <path d="M3 9h18" />
      <rect x="9" y="3" width="6" height="6" />
    </Icon>
  ),

  /** Department – stacked layers */
  layers: (p) => (
    <Icon {...p}>
      <path d="M12 2 2 7l10 5 10-5-10-5Z" />
      <path d="m2 12 10 5 10-5" />
      <path d="m2 17 10 5 10-5" />
    </Icon>
  ),

  /** Team / leaf – group of people */
  teamGroup: (p) => (
    <Icon {...p}>
      <circle cx="9" cy="7" r="3" />
      <path d="M3 21v-1a6 6 0 0 1 6-6" />
      <circle cx="16" cy="7" r="3" />
      <path d="M10 21v-1a6 6 0 0 1 6-6h2a6 6 0 0 1 6 6v1" />
    </Icon>
  ),

  /** People mode – single person avatar */
  personCircle: (p) => (
    <Icon {...p}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="9" r="3" />
      <path d="M6.2 19.4A6 6 0 0 1 12 15a6 6 0 0 1 5.8 4.4" />
    </Icon>
  ),

  /** Star – head/highlighted node accent */
  starFilled: (p) => (
    <Icon {...p} fill="currentColor" stroke="none">
      <path d="M12 2l2.9 6.2L22 9.3l-5 5 1.2 7-6.2-3.4L5.8 21.3l1.2-7-5-5 7.1-1.1z" />
    </Icon>
  ),
};
