// Small line glyphs used to give each welfare project a recognisable emblem.
const PATHS = {
  water: <path d="M12 3c3.6 4.4 6 7.5 6 10.5A6 6 0 0 1 6 13.5C6 10.5 8.4 7.4 12 3Z" />,
  book: <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5v-15ZM4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5" />,
  health: <path d="M12 21s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 8.2a4.3 4.3 0 0 1 7.5 2.6C19.5 16.4 12 21 12 21ZM12 11v4M10 13h4" />,
  road: <path d="M8 3 5 21M16 3l3 18M12 4v3M12 10v4M12 17v3" />,
  home: <path d="M3 11.5 12 4l9 7.5M5.5 10v10h13V10M10 20v-5h4v5" />,
  light: <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z" />,
  food: <path d="M6 3v7a3 3 0 0 0 3 3v8M9 3v7M12 3v7M17 3c-2 2-3 4.5-3 7.5h3V21" />,
  leaf: <path d="M5 19C5 9 11 4 20 4c0 9-5 15-14 15M5 19c3-5 6-8 11-10" />,
};

export function Glyph({ name = "leaf", size = 26 }) {
  return (
    <svg className="glyph" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {PATHS[name] || PATHS.leaf}
    </svg>
  );
}

// Navigation / UI icons (24px grid, 1.7 stroke) so every platform renders the same shapes.
const ICONS = {
  home: <path d="M3 11.5 12 4l9 7.5M5.5 10v10h13V10M10 20v-5h4v5" />,
  dashboard: <path d="M4 4h7v8H4zM13 4h7v5h-7zM13 11h7v9h-7zM4 14h7v6H4z" />,
  projects: <path d="M12 21V11M12 11c0-4 2.5-6.5 7-7 0 4.5-2.5 7-7 7ZM12 14c0-3-2-5-6-5.5 0 3.5 2 5.5 6 5.5Z" />,
  announcements: <path d="M4 10v4h3l7 4V6l-7 4H4ZM17 9a4 4 0 0 1 0 6" />,
  report: <path d="M5 20V10M12 20V4M19 20v-7M3 20h18" />,
  donate: <path d="M12 20.5s-7.5-4.7-7.5-10.3A4.3 4.3 0 0 1 12 7.6a4.3 4.3 0 0 1 7.5 2.6c0 5.6-7.5 10.3-7.5 10.3Z" />,
  profile: <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4.5 20.5a7.5 7.5 0 0 1 15 0" />,
  admin: <path d="M12 3 5 6v5.5c0 4.2 2.9 7.7 7 9 4.1-1.3 7-4.8 7-9V6l-7-3ZM9 12l2 2 4-4" />,
  signin: <path d="M14 4h5a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-5M10 8l-4 4 4 4M6 12h10" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  lock: <path d="M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3" />,
  trash: <path d="M4 7h16M9 7V4h6v3M6.5 7l.8 13h9.4l.8-13M10 11v6M14 11v6" />,
  edit: <path d="M4 20h4L19 9l-4-4L4 16v4ZM13.5 6.5l4 4" />,
  eye: <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12ZM12 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" />,
  eyeoff: <path d="M3 3l18 18M10.6 6a9.8 9.8 0 0 1 1.4-.1c6 0 9.5 6.1 9.5 6.1a16 16 0 0 1-3 3.7M6.6 7.7A16 16 0 0 0 2.5 12S6 18.1 12 18.1c1.3 0 2.5-.3 3.5-.8M9.9 9.9a2.5 2.5 0 0 0 3.2 3.2" />,
  mail: <path d="M3.5 6.5h17v11h-17zM3.5 7l8.5 6.5L20.5 7" />,
  mailopen: <path d="M3.5 10 12 4l8.5 6v8.5h-17V10ZM3.5 10l8.5 6 8.5-6" />,
  hourglass: <path d="M7 3h10M7 21h10M8 3c0 5 8 5 8 9s-8 4-8 9M16 3c0 5-8 5-8 9" />,
  alert: <path d="M12 4 2.8 19.5h18.4L12 4ZM12 10v4.5M12 17.2v.1" />,
};

export function Icon({ name, size = 18 }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[name] || ICONS.home}
    </svg>
  );
}
