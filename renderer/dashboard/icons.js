// Original inline SVG icon set (16px grid, stroke style).

const s = (paths, { w = 16, h = 16, sw = 1.6 } = {}) =>
  `<svg width="${w}" height="${h}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;

export const icons = {
  home: s('<rect x="2" y="2" width="5" height="5" rx="1.2"/><rect x="9" y="2" width="5" height="5" rx="1.2"/><rect x="2" y="9" width="5" height="5" rx="1.2"/><rect x="9" y="9" width="5" height="5" rx="1.2"/>'),
  book: s('<path d="M3 2.8h7.5a2 2 0 0 1 2 2v8.4H5a2 2 0 0 0-2 2z"/><path d="M3 13.2a2 2 0 0 1 2-2h7.5"/><path d="M6 5.5h4"/>'),
  scissors: s('<circle cx="4" cy="4.5" r="2"/><circle cx="4" cy="11.5" r="2"/><path d="M5.7 5.6 14 13M5.7 10.4 14 3"/>'),
  type: s('<path d="M2.5 4.5V3h11v1.5"/><path d="M8 3v10"/><path d="M5.5 13h5"/>'),
  mic: s('<rect x="6" y="1.8" width="4" height="7.4" rx="2"/><path d="M3.5 7.5a4.5 4.5 0 0 0 9 0"/><path d="M8 12v2.2"/>'),
  gear: s('<circle cx="8" cy="8" r="2.2"/><path d="M8 1.8v1.9M8 12.3v1.9M1.8 8h1.9M12.3 8h1.9M3.6 3.6l1.35 1.35M11.05 11.05l1.35 1.35M12.4 3.6l-1.35 1.35M4.95 11.05 3.6 12.4"/>'),
  help: s('<circle cx="8" cy="8" r="6.2"/><path d="M6.2 6.2a1.8 1.8 0 1 1 2.7 1.6c-.6.35-.9.7-.9 1.4"/><circle cx="8" cy="11.3" r="0.5" fill="currentColor" stroke="none"/>'),
  search: s('<circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 3 3"/>'),
  sort: s('<path d="M5 3v10M5 13l-2.2-2.2M5 13l2.2-2.2"/><path d="M11 13V3M11 3 8.8 5.2M11 3l2.2 2.2"/>'),
  refresh: s('<path d="M13 8a5 5 0 1 1-1.5-3.6"/><path d="M13 2.5V4.9h-2.4"/>'),
  close: s('<path d="m4 4 8 8M12 4l-8 8"/>'),
  copy: s('<rect x="5.5" y="5.5" width="8" height="8" rx="1.6"/><path d="M10.5 3.5v-.4A1.6 1.6 0 0 0 8.9 1.5H4.1a1.6 1.6 0 0 0-1.6 1.6v4.8a1.6 1.6 0 0 0 1.6 1.6h.4"/>'),
  trash: s('<path d="M2.5 4h11"/><path d="M5.5 4V2.8c0-.7.6-1.3 1.3-1.3h2.4c.7 0 1.3.6 1.3 1.3V4"/><path d="M4 4v8.7c0 .7.6 1.3 1.3 1.3h5.4c.7 0 1.3-.6 1.3-1.3V4"/><path d="M6.5 7v4M9.5 7v4"/>'),
  play: s('<path d="M5 3.2v9.6l7.5-4.8z" fill="currentColor" stroke="none"/>'),
  pencil: s('<path d="m9.8 2.8 3.4 3.4L6 13.4l-3.9.5.5-3.9z"/><path d="m8.6 4 3.4 3.4"/>'),
  star: s('<path d="m8 1.8 1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6z"/>'),
  starFill: s('<path d="m8 1.8 1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6z" fill="currentColor"/>'),
  plus: s('<path d="M8 3v10M3 8h10"/>'),
  spark: s('<path d="M8 1.5 9.3 6 14 7.3 9.3 8.7 8 13.3 6.7 8.7 2 7.3 6.7 6z" fill="currentColor" stroke="none"/>'),
  wave: s('<path d="M1.5 8h1.2M4.4 5v6M7.3 2.8v10.4M10.2 5.5v5M13.1 7v2"/>', { sw: 1.8 }),
  sliders: s('<path d="M2 4.5h7M12.5 4.5H14"/><circle cx="10.5" cy="4.5" r="1.7"/><path d="M2 11.5h1.5M7 11.5h7"/><circle cx="5" cy="11.5" r="1.7"/>'),
  display: s('<rect x="1.8" y="2.5" width="12.4" height="8.5" rx="1.4"/><path d="M6 13.5h4"/>'),
  flask: s('<path d="M6.2 1.8h3.6M7 1.8v4L3.2 12a1.6 1.6 0 0 0 1.4 2.4h6.8a1.6 1.6 0 0 0 1.4-2.4L9 5.8v-4"/><path d="M5 9.5h6"/>'),
  user: s('<circle cx="8" cy="5.2" r="2.7"/><path d="M2.8 14a5.2 5.2 0 0 1 10.4 0"/>'),
  info: s('<circle cx="8" cy="8" r="6.2"/><path d="M8 7.2v4"/><circle cx="8" cy="4.9" r="0.5" fill="currentColor" stroke="none"/>'),
  check: s('<path d="m3 8.5 3.2 3.2L13 5"/>'),
  cloudOff: s('<path d="M4.5 12.5h6.9a3.1 3.1 0 0 0 .6-6.1 4.5 4.5 0 0 0-8.3-1.5A3.6 3.6 0 0 0 4.5 12.5z"/><path d="m2.5 2.5 11 11"/>'),
  undo: s('<path d="M3 6.5h6.5a3.5 3.5 0 0 1 0 7H6"/><path d="M5.8 3.7 3 6.5l2.8 2.8"/>'),
  people: s('<circle cx="5.5" cy="5.5" r="2.3"/><path d="M1.8 13.4a3.7 3.7 0 0 1 7.4 0"/><circle cx="11" cy="5" r="1.9"/><path d="M10.2 9.3a3.4 3.4 0 0 1 4 3.4"/>'),
  notepad: s('<rect x="3" y="2" width="10" height="12.5" rx="1.6"/><path d="M5.6 5.5h4.8M5.6 8h4.8M5.6 10.5h3"/>'),
  sparkleSearch: s('<circle cx="6.8" cy="6.8" r="4.2"/><path d="m10 10 3.4 3.4"/><path d="M6.8 4.4l.5 1.4 1.4.5-1.4.5-.5 1.4-.5-1.4-1.4-.5 1.4-.5z" fill="currentColor" stroke="none"/>'),

  // Google Calendar mark, for the connect affordance. Calendars reach Sotto
  // through macOS Calendar, which is where most people's Google account lives.
  gcal: `<svg viewBox="0 0 48 48" width="22" height="22" aria-hidden="true">
    <rect x="10" y="10" width="28" height="28" fill="#fff"/>
    <path d="M10 10h28v5H10z" fill="#ea4335"/>
    <path d="M33 10h5v28h-5z" fill="#fbbc04"/>
    <path d="M10 33h28v5H10z" fill="#34a853"/>
    <path d="M10 10h5v28h-5z" fill="#1967d2"/>
    <rect x="15" y="15" width="18" height="18" fill="#fff"/>
    <text x="24" y="30" font-size="14" font-weight="700" fill="#1967d2"
      text-anchor="middle" font-family="Helvetica,Arial,sans-serif">31</text>
  </svg>`,
};
