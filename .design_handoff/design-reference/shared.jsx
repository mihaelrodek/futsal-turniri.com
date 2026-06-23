// Shared tournament data (from screenshots) — preserve Croatian copy
const TOURNAMENTS = [
  { id: 't1', name: 'Zarovnica open', status: 'upcoming', statusLabel: 'Nadolazeći', date: 'pet, 22. svi', dateShort: '22 SVI', day: 'PET', time: '19:15', fee: 30, teams: 6, max: 22, location: 'Žarovnica, Lepoglava', poster: true },
  { id: 't2', name: 'Aaa', status: 'soon', statusLabel: 'Za 6 dana', date: 'ned, 31. svi', dateShort: '31 SVI', day: 'NED', time: '20:43', fee: 30, teams: 0, max: 22, location: 'Aa' },
  { id: 't3', name: 'Futsal Kup Zagreb 2026', status: 'live', statusLabel: 'UŽIVO', date: 'ned, 14. lip', dateShort: '14 LIP', day: 'NED', time: '09:00', fee: 200, teams: 8, max: 8, location: 'Dvorana Tresnjevka, Zagreb' },
  { id: 't4', name: 'Malonogometni Open Varazdin', status: 'full', statusLabel: 'Mjesta puna', date: 'ned, 21. lip', dateShort: '21 LIP', day: 'NED', time: '10:00', fee: 100, teams: 4, max: 4, location: 'Sportska dvorana Varazdin' },
  { id: 't5', name: 'Zagorski Futsal Grand Prix', status: 'full', statusLabel: 'Mjesta puna', date: 'ned, 05. srp', dateShort: '05 SRP', day: 'NED', time: '09:00', fee: 300, teams: 16, max: 16, location: 'Sportski centar Krapina' },
  { id: 't6', name: 'Ljetni Turnir Rijeka 2026', status: 'full', statusLabel: 'Mjesta puna', date: 'ned, 12. srp', dateShort: '12 SRP', day: 'NED', time: '10:00', fee: 150, teams: 6, max: 6, location: 'Dvorana Zamet, Rijeka' },
  { id: 't7', name: 'Futsal Liga Slavonije', status: 'full', statusLabel: 'Mjesta puna', date: 'ned, 19. srp', dateShort: '19 SRP', day: 'NED', time: '09:00', fee: 250, teams: 12, max: 12, location: 'Gradski vrt, Osijek' },
  { id: 't8', name: 'Futsal Spektakl Split 2026', status: 'upcoming', statusLabel: 'Nadolazeći', date: 'ned, 02. kol', dateShort: '02 KOL', day: 'NED', time: '10:00', fee: 350, teams: 2, max: 16, location: 'Spaladium Arena, Split' },
];

// Soccer ball SVG (pentagon/hexagon pattern) — used as small icon
const BallIcon = ({ size = 16, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <path d="M12 4 L15.5 6.5 L14 10.5 L10 10.5 L8.5 6.5 Z" fill={color} fillOpacity="0.9" stroke="none"/>
    <path d="M14 10.5 L17.5 13 L16 17 L12 16.5 L12 12.5 Z" />
    <path d="M10 10.5 L6.5 13 L8 17 L12 16.5" />
    <path d="M15.5 6.5 L19 9 L17.5 13" />
    <path d="M8.5 6.5 L5 9 L6.5 13" />
  </svg>
);

// Pitch line SVG (decorative half-pitch / center circle)
const PitchLines = ({ color = 'rgba(255,255,255,0.08)', strokeWidth = 1.5 }) => (
  <svg viewBox="0 0 800 400" preserveAspectRatio="xMidYMid slice" style={{ width: '100%', height: '100%', display: 'block' }}>
    <rect x="0.5" y="0.5" width="799" height="399" fill="none" stroke={color} strokeWidth={strokeWidth} />
    <line x1="400" y1="0" x2="400" y2="400" stroke={color} strokeWidth={strokeWidth} />
    <circle cx="400" cy="200" r="60" fill="none" stroke={color} strokeWidth={strokeWidth} />
    <circle cx="400" cy="200" r="2.5" fill={color} />
    <rect x="0" y="120" width="80" height="160" fill="none" stroke={color} strokeWidth={strokeWidth} />
    <rect x="0" y="160" width="30" height="80" fill="none" stroke={color} strokeWidth={strokeWidth} />
    <rect x="720" y="120" width="80" height="160" fill="none" stroke={color} strokeWidth={strokeWidth} />
    <rect x="770" y="160" width="30" height="80" fill="none" stroke={color} strokeWidth={strokeWidth} />
    <path d="M 80 170 A 40 40 0 0 1 80 230" fill="none" stroke={color} strokeWidth={strokeWidth} />
    <path d="M 720 170 A 40 40 0 0 0 720 230" fill="none" stroke={color} strokeWidth={strokeWidth} />
  </svg>
);

// Goal net SVG pattern — for backgrounds
const GoalNet = ({ color = 'rgba(255,255,255,0.06)' }) => (
  <svg width="100%" height="100%" style={{ position: 'absolute', inset: 0 }}>
    <defs>
      <pattern id="netpattern" x="0" y="0" width="14" height="14" patternUnits="userSpaceOnUse">
        <path d="M 7 0 L 14 7 L 7 14 L 0 7 Z" fill="none" stroke={color} strokeWidth="0.7"/>
      </pattern>
    </defs>
    <rect width="100%" height="100%" fill="url(#netpattern)" />
  </svg>
);

// Small inline icons
const IconClock = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>
  </svg>
);
const IconUsers = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
  </svg>
);
const IconEuro = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 10h12"/><path d="M4 14h9"/><path d="M19 6.5A7 7 0 0 0 8 12a7 7 0 0 0 11 5.5"/>
  </svg>
);
const IconPin = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>
  </svg>
);
const IconSearch = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>
  </svg>
);
const IconFilter = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 5h18M6 12h12M10 19h4"/>
  </svg>
);
const IconPlus = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 5v14M5 12h14"/>
  </svg>
);
const IconChev = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m9 18 6-6-6-6"/>
  </svg>
);
const IconCalendar = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18"/>
  </svg>
);

Object.assign(window, {
  TOURNAMENTS, BallIcon, PitchLines, GoalNet,
  IconClock, IconUsers, IconEuro, IconPin, IconSearch, IconFilter, IconPlus, IconChev, IconCalendar
});
