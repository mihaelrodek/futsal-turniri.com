// theme.jsx — Pitch theme tokens + shared shell (nav, page wrapper, posters, tabs)

const T = {
  bg: '#f3f6f1',
  surface: '#ffffff',
  surfaceTint: '#eaf1e7',
  surfaceTint2: '#f7faf5',
  ink: '#0e1f15',
  inkSoft: '#3d4a42',
  inkMute: '#728176',
  border: '#dde5d8',
  borderStrong: '#c9d4c2',
  pitch: '#0b6b3a',
  pitchLight: '#3aa56b',
  pitchDeep: '#084a28',
  amber: '#d97706',
  red: '#dc2626',
  goal: '#f5b921',
  blue: '#2563eb',
  purple: '#7c3aed',
};

const F = {
  sans: `'Inter', system-ui, sans-serif`,
  mono: `'JetBrains Mono', monospace`,
  display: `'Bricolage Grotesque', 'Inter', sans-serif`,
};

// Pitch backdrop SVG — used in posters and hero decoration
const PitchBackdrop = ({ opacity = 0.1, variant = 'full' }) => (
  <svg viewBox="0 0 1200 240" preserveAspectRatio="xMidYMid slice" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity }}>
    <defs>
      <linearGradient id={`grass-${variant}`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={T.pitchLight}/>
        <stop offset="100%" stopColor={T.pitch}/>
      </linearGradient>
    </defs>
    <rect width="1200" height="240" fill={`url(#grass-${variant})`}/>
    {Array.from({length: 8}).map((_, i) => (
      <rect key={i} x={i*150} y="0" width="75" height="240" fill="rgba(255,255,255,0.04)"/>
    ))}
    <rect x="20" y="20" width="1160" height="200" fill="none" stroke="#fff" strokeWidth="2"/>
    <line x1="600" y1="20" x2="600" y2="220" stroke="#fff" strokeWidth="2"/>
    <circle cx="600" cy="120" r="50" fill="none" stroke="#fff" strokeWidth="2"/>
    <circle cx="600" cy="120" r="3" fill="#fff"/>
    <rect x="20" y="60" width="80" height="120" fill="none" stroke="#fff" strokeWidth="2"/>
    <rect x="1100" y="60" width="80" height="120" fill="none" stroke="#fff" strokeWidth="2"/>
  </svg>
);

// Top navigation — used on every page
const PitchNav = ({ active = 'Turniri' }) => (
  <header style={{
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '18px 40px', background: '#fff', borderBottom: `1px solid ${T.border}`,
  }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{
        width: 40, height: 40, borderRadius: 12, background: T.pitch,
        display: 'grid', placeItems: 'center', position: 'relative', overflow: 'hidden',
      }}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" fill="#fff"/>
          <path d="M12 4 L15.5 6.5 L14.2 10.5 L9.8 10.5 L8.5 6.5 Z" fill={T.pitch}/>
          <path d="M14.2 10.5 L17.8 13 L16.4 17 L12 16.5 L12 12" fill="none" stroke={T.pitch} strokeWidth="1.4"/>
          <path d="M9.8 10.5 L6.2 13 L7.6 17 L12 16.5" fill="none" stroke={T.pitch} strokeWidth="1.4"/>
        </svg>
      </div>
      <div>
        <div style={{ fontWeight: 700, fontSize: 17, letterSpacing: '-0.01em', color: T.ink, lineHeight: 1.1 }}>Futsal Turniri</div>
        <div style={{ fontFamily: F.mono, fontSize: 10, color: T.inkMute, letterSpacing: '0.1em', marginTop: 1 }}>HRVATSKA · SEZONA 2026</div>
      </div>
    </div>
    <nav style={{ display: 'flex', alignItems: 'center', gap: 2, background: T.surfaceTint, padding: 4, borderRadius: 99 }}>
      {[
        { label: 'Turniri' },
        { label: 'Uživo', live: true },
        { label: 'Kreiraj turnir' },
        { label: 'Karta' },
      ].map(item => {
        const isActive = item.label === active;
        return (
          <a key={item.label} style={{
            padding: '8px 18px', borderRadius: 99, fontSize: 13, fontWeight: 600,
            color: isActive ? '#fff' : item.live ? T.red : T.ink,
            background: isActive ? T.pitch : 'transparent',
            display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer',
          }}>
            {item.live && <span style={{ width: 7, height: 7, borderRadius: 99, background: T.red, boxShadow: `0 0 6px ${T.red}`, animation: 'pulse 1.6s infinite' }}/>}
            {item.label}
          </a>
        );
      })}
    </nav>
    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
      <button style={{
        width: 38, height: 38, borderRadius: 99, border: `1px solid ${T.border}`,
        background: '#fff', display: 'grid', placeItems: 'center', cursor: 'pointer', color: T.inkSoft,
      }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
      </button>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 12px 4px 4px', background: T.surfaceTint, borderRadius: 99 }}>
        <div style={{ width: 30, height: 30, borderRadius: 99, background: `linear-gradient(135deg, ${T.pitchLight}, ${T.pitch})`, color: '#fff', display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 700, letterSpacing: '0.02em' }}>MR</div>
        <span style={{ fontSize: 13, fontWeight: 600, color: T.ink }}>Mihael Rodek</span>
      </div>
    </div>
  </header>
);

// Page shell — wraps a full screen
const PageShell = ({ active, children, contentMax = 1200, contentPad = 40 }) => (
  <div style={{ background: T.bg, minHeight: '100%', color: T.ink, fontFamily: F.sans }}>
    <style>{`@keyframes pulse { 0%, 100% { opacity: 1 } 50% { opacity: 0.4 } } @keyframes blink { 50% { opacity: 0.5 } }`}</style>
    <PitchNav active={active}/>
    <div style={{ maxWidth: contentMax, margin: '0 auto', padding: `28px ${contentPad}px 64px` }}>
      {children}
    </div>
  </div>
);

// Poster — either uses tournament's image OR shows styled empty-state
// Designed to feel like a poster, not a stock "no image" placeholder
const TournamentPoster = ({ t, height = 220, big = false }) => {
  if (t.poster) {
    // Styled "themed" poster placeholder — mimics what an uploaded poster would look like
    // (since we don't have real uploaded images). Designed to read as a poster.
    return (
      <div style={{
        position: 'relative', height, overflow: 'hidden',
        background: 'linear-gradient(135deg, #2d1410 0%, #0a0604 100%)',
        display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
        padding: big ? '24px' : '16px',
        color: '#fff',
      }}>
        {/* Cards illustration suggestive of the user's "Turnir u Beli" poster */}
        <div style={{ position: 'absolute', inset: 0, opacity: 0.4, background: 'radial-gradient(ellipse at 50% 30%, #c84a3a 0%, transparent 60%)' }}/>
        <div style={{ position: 'absolute', top: '40%', left: '50%', transform: 'translate(-50%, -50%)', display: 'flex', gap: -10 }}>
          {[-12, -6, 0, 6, 12].map((deg, i) => (
            <div key={i} style={{
              width: big ? 38 : 28, height: big ? 54 : 40,
              background: '#fff', border: '2px solid #2d1410', borderRadius: 4,
              transform: `rotate(${deg}deg) translateY(${Math.abs(deg)/2}px)`,
              marginLeft: i === 0 ? 0 : -10,
              display: 'grid', placeItems: 'center',
              color: ['#c84a3a','#0e1f15','#c84a3a','#0e1f15','#c84a3a'][i],
              fontFamily: F.display, fontSize: big ? 14 : 10, fontWeight: 800,
            }}>♥♠</div>
          ))}
        </div>
        <div style={{ position: 'relative', textAlign: 'center', zIndex: 1 }}>
          <div style={{ fontFamily: F.display, fontSize: big ? 30 : 22, fontWeight: 800, letterSpacing: '0.05em', lineHeight: 1 }}>TURNIR</div>
          <div style={{ fontFamily: F.display, fontSize: big ? 36 : 26, fontWeight: 800, color: '#f5c842', letterSpacing: '0.05em', lineHeight: 1, marginTop: -2 }}>U BELI</div>
        </div>
        <div style={{ position: 'relative', textAlign: 'center', zIndex: 1, fontFamily: F.mono, fontSize: big ? 11 : 9, color: 'rgba(255,255,255,0.7)', letterSpacing: '0.15em' }}>
          {t.dateShort} · {t.time} · {t.fee}€/PAR
        </div>
      </div>
    );
  }
  // No poster — styled empty state that still feels like part of the design
  // (uses pitch lines + initial mark instead of a blank gray box)
  const initials = t.name.split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
  return (
    <div style={{
      position: 'relative', height, overflow: 'hidden',
      background: `linear-gradient(135deg, ${T.pitch}, ${T.pitchDeep})`,
      display: 'grid', placeItems: 'center', color: '#fff',
    }}>
      <div style={{ position: 'absolute', inset: 0, opacity: 0.16 }}>
        <PitchBackdrop opacity={1} variant={t.id}/>
      </div>
      <div style={{ position: 'relative', textAlign: 'center' }}>
        <div style={{ fontFamily: F.display, fontWeight: 800, fontSize: big ? 72 : 52, letterSpacing: '-0.04em', lineHeight: 0.9, opacity: 0.9 }}>{initials}</div>
        <div style={{ fontFamily: F.mono, fontSize: big ? 11 : 10, color: 'rgba(255,255,255,0.65)', letterSpacing: '0.2em', marginTop: big ? 12 : 8 }}>
          ⊕ NEMA PLAKATA
        </div>
      </div>
    </div>
  );
};

// Status chip (uses pill style)
const StatusChip = ({ status, label, size = 'md' }) => {
  const config = {
    live:     { bg: T.red,        fg: '#fff', dot: '#fff', pulse: true },
    upcoming: { bg: '#fff',       fg: T.ink,  dot: T.pitchLight, border: T.border },
    soon:     { bg: '#fff',       fg: T.ink,  dot: T.amber,      border: T.border },
    full:     { bg: '#fff',       fg: T.ink,  dot: T.inkMute,    border: T.border },
    draft:    { bg: T.ink,        fg: '#fff', dot: T.goal },
    active:   { bg: T.pitch,      fg: '#fff', dot: '#fff' },
  }[status] || { bg: '#fff', fg: T.ink, dot: T.inkMute, border: T.border };
  const s = size === 'lg' ? { fontSize: 12, padding: '6px 14px' } : { fontSize: 10, padding: '4px 10px' };
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      background: config.bg, color: config.fg,
      border: config.border ? `1px solid ${config.border}` : 'none',
      padding: s.padding, borderRadius: 99,
      fontSize: s.fontSize, fontWeight: 700, letterSpacing: '0.04em',
    }}>
      <span style={{ width: 6, height: 6, borderRadius: 99, background: config.dot, animation: config.pulse ? 'pulse 1.6s infinite' : 'none' }}/>
      {label}
    </span>
  );
};

// Tab bar — used on tournament detail screens
const TabBar = ({ tabs, active, onChange }) => (
  <div style={{
    display: 'flex', gap: 2, background: '#fff', padding: 6, borderRadius: 99,
    border: `1px solid ${T.border}`, marginBottom: 24,
  }}>
    {tabs.map(t => {
      const isActive = t === active;
      return (
        <button key={t} onClick={() => onChange?.(t)} style={{
          flex: 1, padding: '10px 18px', borderRadius: 99, border: 'none',
          background: isActive ? T.pitch : 'transparent',
          color: isActive ? '#fff' : T.ink,
          fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: F.sans,
        }}>
          {t}
        </button>
      );
    })}
  </div>
);

// Section card — base container used across the design
const SectionCard = ({ title, subtitle, icon, action, children, padding = '20px 24px' }) => (
  <div style={{
    background: '#fff', borderRadius: 16, border: `1px solid ${T.border}`,
    overflow: 'hidden',
  }}>
    {(title || icon) && (
      <div style={{
        padding: '16px 24px',
        borderBottom: children ? `1px solid ${T.border}` : 'none',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {icon && (
            <div style={{
              width: 38, height: 38, borderRadius: 10, background: T.surfaceTint,
              color: T.pitch, display: 'grid', placeItems: 'center',
            }}>{icon}</div>
          )}
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: T.ink, letterSpacing: '-0.01em' }}>{title}</div>
            {subtitle && <div style={{ fontSize: 13, color: T.inkMute, marginTop: 2 }}>{subtitle}</div>}
          </div>
        </div>
        {action}
      </div>
    )}
    {children && <div style={{ padding }}>{children}</div>}
  </div>
);

// Back link
const BackLink = ({ to = 'Natrag na popis' }) => (
  <a style={{
    display: 'inline-flex', alignItems: 'center', gap: 8,
    color: T.inkSoft, fontSize: 14, fontWeight: 500, cursor: 'pointer',
    marginBottom: 16,
  }}>
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 12H5M12 19l-7-7 7-7"/>
    </svg>
    {to}
  </a>
);

// Page title row
const PageTitle = ({ title, status, statusLabel, action }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 24, gap: 24 }}>
    <div>
      <h1 style={{ fontSize: 34, fontWeight: 800, margin: 0, letterSpacing: '-0.025em', color: T.ink, lineHeight: 1.1 }}>{title}</h1>
    </div>
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      {status && <StatusChip status={status} label={statusLabel} size="lg"/>}
      {action}
    </div>
  </div>
);

// Big primary button
const PrimaryButton = ({ children, icon, onClick, full }) => (
  <button onClick={onClick} style={{
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
    background: T.pitch, color: '#fff', border: 'none',
    padding: '12px 22px', borderRadius: 12,
    fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: F.sans,
    width: full ? '100%' : 'auto',
  }}>
    {icon}{children}
  </button>
);

const GhostButton = ({ children, icon, onClick, full, danger }) => (
  <button onClick={onClick} style={{
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
    background: '#fff', color: danger ? T.red : T.ink, border: `1px solid ${danger ? '#f4cdcd' : T.border}`,
    padding: '12px 22px', borderRadius: 12,
    fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: F.sans,
    width: full ? '100%' : 'auto',
  }}>
    {icon}{children}
  </button>
);

// Extra icons
const IconTrophy = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>
  </svg>
);
const IconShare = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
  </svg>
);
const IconEdit = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="m18.5 2.5 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
  </svg>
);
const IconTrash = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
  </svg>
);
const IconInfo = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>
  </svg>
);
const IconUsers2 = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
  </svg>
);
const IconTarget = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>
  </svg>
);
const IconBracket = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 3v18M18 3v18M6 8h4v8H6zM14 11h4v2h-4z"/>
  </svg>
);
const IconWhistle = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12a7 7 0 1 1-12.1-4.8L12 4l9.0 4z"/><circle cx="14" cy="12" r="2"/>
  </svg>
);
const IconExternal = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
  </svg>
);
const IconPlay = ({ size = 12 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
);
const IconLocate = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="2" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="22" y2="12"/><line x1="12" y1="2" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="22"/><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/>
  </svg>
);
const IconGift = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/><line x1="12" y1="22" x2="12" y2="7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/>
  </svg>
);
const IconUser = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
  </svg>
);
const IconSettings = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>
  </svg>
);

Object.assign(window, {
  T, F, PitchBackdrop, PitchNav, PageShell,
  TournamentPoster, StatusChip, TabBar, SectionCard,
  BackLink, PageTitle, PrimaryButton, GhostButton,
  IconTrophy, IconShare, IconEdit, IconTrash, IconInfo, IconUsers2,
  IconTarget, IconBracket, IconWhistle, IconExternal, IconPlay, IconLocate,
  IconGift, IconUser, IconSettings,
});
