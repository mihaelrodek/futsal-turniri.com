// page-map.jsx — Karta (map page)

const MAP_PINS = [
  { x: 0.55, y: 0.35, label: 'Futsal Kup Zagreb', when: 'Danas · UŽIVO', status: 'live', city: 'Zagreb', teams: 8 },
  { x: 0.62, y: 0.22, label: 'Zarovnica Open', when: 'Pet · 22. svi', status: 'upcoming', city: 'Lepoglava', teams: 6 },
  { x: 0.6, y: 0.26, label: 'Malonogometni Open', when: 'Ned · 21. lip', status: 'full', city: 'Varaždin', teams: 4 },
  { x: 0.32, y: 0.55, label: 'Ljetni Turnir Rijeka', when: 'Ned · 12. srp', status: 'full', city: 'Rijeka', teams: 6 },
  { x: 0.5, y: 0.32, label: 'Zagorski Grand Prix', when: 'Ned · 05. srp', status: 'full', city: 'Krapina', teams: 16 },
  { x: 0.4, y: 0.78, label: 'Futsal Spektakl Split', when: 'Ned · 02. kol', status: 'upcoming', city: 'Split', teams: 2 },
  { x: 0.78, y: 0.42, label: 'Futsal Liga Slavonije', when: 'Ned · 19. srp', status: 'full', city: 'Osijek', teams: 12 },
];

const MapSidebarItem = ({ pin, active }) => {
  const dot = { live: T.red, upcoming: T.pitchLight, soon: T.amber, full: T.inkMute }[pin.status];
  return (
    <div style={{
      padding: '14px 16px', borderRadius: 12,
      background: active ? T.surfaceTint : '#fff',
      border: `1px solid ${active ? T.pitchLight : T.border}`,
      display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer',
    }}>
      <div style={{
        width: 36, height: 36, borderRadius: 99, background: dot, opacity: 0.15,
        display: 'grid', placeItems: 'center', flexShrink: 0,
      }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill={dot}>
          <path d="M12 2C7.6 2 4 5.6 4 10c0 5.4 8 12 8 12s8-6.6 8-12c0-4.4-3.6-8-8-8zm0 11a3 3 0 1 1 0-6 3 3 0 0 1 0 6z"/>
        </svg>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: T.ink }}>{pin.label}</span>
          {pin.status === 'live' && (
            <span style={{
              fontFamily: F.mono, fontSize: 9, color: T.red, fontWeight: 800, letterSpacing: '0.1em',
              padding: '2px 6px', background: 'rgba(220,38,38,0.1)', borderRadius: 4,
              display: 'inline-flex', alignItems: 'center', gap: 4,
            }}>
              <span style={{ width: 4, height: 4, borderRadius: 99, background: T.red, animation: 'pulse 1.6s infinite' }}/>
              UŽIVO
            </span>
          )}
        </div>
        <div style={{ fontSize: 12, color: T.inkMute, marginTop: 1 }}>
          {pin.city} · {pin.when} · {pin.teams} ekipa
        </div>
      </div>
      <span style={{ color: T.inkMute }}><IconChev size={14}/></span>
    </div>
  );
};

const Pin = ({ x, y, pin, focus }) => {
  const c = { live: T.red, upcoming: T.pitchLight, soon: T.amber, full: T.inkMute }[pin.status];
  return (
    <g transform={`translate(${x * 1000}, ${y * 540})`} style={{ cursor: 'pointer' }}>
      {focus && <circle r="40" fill={c} opacity="0.12"/>}
      {focus && <circle r="26" fill={c} opacity="0.22"/>}
      {pin.status === 'live' && <circle r="22" fill={c} opacity="0.25" style={{ animation: 'pulse 1.6s infinite' }}/>}
      <path d="M 0 -22 C -10 -22 -18 -14 -18 -4 C -18 8 0 24 0 24 C 0 24 18 8 18 -4 C 18 -14 10 -22 0 -22 Z" fill={c} stroke="#fff" strokeWidth="2"/>
      <circle cy="-4" r="6" fill="#fff"/>
      {pin.status === 'live' && (
        <g transform="translate(15, -22)">
          <circle r="8" fill={T.red}/>
          <text textAnchor="middle" y="3" fontSize="9" fill="#fff" fontWeight="800">!</text>
        </g>
      )}
    </g>
  );
};

const PageMap = () => {
  const focusPin = MAP_PINS[0];
  return (
    <PageShell active="Karta" contentMax={1280}>
      {/* Header bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 20 }}>
        <div>
          <div style={{ fontFamily: F.mono, fontSize: 11, color: T.pitch, letterSpacing: '0.2em', fontWeight: 700 }}>
            KARTA · 7 LOKACIJA U HRVATSKOJ
          </div>
          <h1 style={{ fontSize: 30, fontWeight: 800, margin: '6px 0 0', letterSpacing: '-0.025em' }}>Sve ture na karti</h1>
          <p style={{ fontSize: 13, color: T.inkMute, margin: '4px 0 0' }}>
            3 turnira nemaju koordinate · backfill se može pokrenuti iz postavki.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <GhostButton icon={<IconLocate size={14}/>}>Moja lokacija</GhostButton>
          <PrimaryButton icon={<IconFilter size={14}/>}>Filteri</PrimaryButton>
        </div>
      </div>

      {/* Filter bar */}
      <div style={{
        background: '#fff', border: `1px solid ${T.border}`, borderRadius: 16,
        padding: '14px 20px', marginBottom: 20,
        display: 'flex', alignItems: 'center', gap: 24, justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flex: 1, maxWidth: 600 }}>
          <span style={{ fontFamily: F.mono, fontSize: 11, color: T.inkMute, letterSpacing: '0.1em', fontWeight: 700, whiteSpace: 'nowrap' }}>U KRUGU OD</span>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ position: 'relative', flex: 1, height: 6, background: T.surfaceTint, borderRadius: 99 }}>
              <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: '45%', background: T.pitch, borderRadius: 99 }}/>
              <div style={{ position: 'absolute', left: '45%', top: '50%', transform: 'translate(-50%, -50%)', width: 18, height: 18, borderRadius: 99, background: '#fff', border: `2px solid ${T.pitch}`, boxShadow: '0 2px 6px rgba(11,107,58,0.25)' }}/>
            </div>
            <span style={{ fontFamily: F.mono, fontSize: 13, fontWeight: 700, color: T.ink, minWidth: 50 }}>45 km</span>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          {[
            { label: 'Danas', color: T.pitchLight },
            { label: 'Tjedan', color: T.amber },
            { label: 'Kasnije', color: T.red },
          ].map(l => (
            <label key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <span style={{ width: 12, height: 12, borderRadius: 99, background: l.color }}/>
              <span style={{ fontSize: 13, color: T.ink, fontWeight: 600 }}>{l.label}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Main split */}
      <div style={{ display: 'grid', gridTemplateColumns: '340px 1fr', gap: 20 }}>
        {/* Sidebar */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <h3 style={{ fontFamily: F.mono, fontSize: 11, color: T.inkMute, letterSpacing: '0.1em', fontWeight: 700, margin: 0 }}>
              VIDLJIVE TURE <span style={{ color: T.ink, marginLeft: 4 }}>(7)</span>
            </h3>
            <a style={{ fontSize: 12, color: T.pitch, fontWeight: 600, cursor: 'pointer' }}>Sortiraj ↓</a>
          </div>
          {MAP_PINS.map((p, i) => <MapSidebarItem key={i} pin={p} active={i === 0}/>)}
        </div>

        {/* Map */}
        <div style={{
          position: 'relative', borderRadius: 16, overflow: 'hidden',
          border: `1px solid ${T.border}`, background: '#eef3eb', minHeight: 600,
        }}>
          {/* Map controls */}
          <div style={{
            position: 'absolute', top: 14, left: 14, zIndex: 2,
            background: '#fff', borderRadius: 10, border: `1px solid ${T.border}`, padding: 2,
            display: 'flex', flexDirection: 'column',
          }}>
            {['+', '−'].map((s, i) => (
              <button key={s} style={{
                width: 36, height: 36, border: 'none', background: '#fff',
                borderBottom: i === 0 ? `1px solid ${T.border}` : 'none',
                fontSize: 18, fontWeight: 700, color: T.ink, cursor: 'pointer',
              }}>{s}</button>
            ))}
          </div>
          {/* Focused tournament card overlay */}
          <div style={{
            position: 'absolute', top: 14, right: 14, zIndex: 2,
            background: '#fff', borderRadius: 14, border: `1px solid ${T.border}`,
            padding: 14, width: 260, boxShadow: '0 10px 28px rgba(14,31,21,0.12)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <span style={{
                fontFamily: F.mono, fontSize: 10, color: T.red, fontWeight: 800, letterSpacing: '0.1em',
                display: 'inline-flex', alignItems: 'center', gap: 4,
              }}>
                <span style={{ width: 6, height: 6, borderRadius: 99, background: T.red, animation: 'pulse 1.6s infinite' }}/>
                UŽIVO
              </span>
              <span style={{ fontSize: 11, color: T.inkMute }}>Zagreb · 5 km</span>
            </div>
            <div style={{ fontSize: 16, fontWeight: 700, color: T.ink, marginTop: 6 }}>{focusPin.label}</div>
            <div style={{ display: 'flex', gap: 8, marginTop: 4, fontFamily: F.mono, fontSize: 11, color: T.inkMute, letterSpacing: '0.05em' }}>
              <span>NK Bregana 2 : 1 NK Stari grad</span>
            </div>
            <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
              <button style={{
                flex: 1, padding: '8px 12px', borderRadius: 8, border: 'none',
                background: T.pitch, color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer',
              }}>
                Prati →
              </button>
              <button style={{
                padding: '8px 12px', borderRadius: 8, border: `1px solid ${T.border}`,
                background: '#fff', color: T.ink, fontSize: 12, fontWeight: 600, cursor: 'pointer',
              }}>
                Ruta
              </button>
            </div>
          </div>

          {/* Stylized map SVG */}
          <svg viewBox="0 0 1000 540" preserveAspectRatio="xMidYMid slice" style={{ display: 'block', width: '100%', height: '100%' }}>
            <defs>
              <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                <path d="M 40 0 L 0 0 0 40" fill="none" stroke={T.border} strokeWidth="0.5"/>
              </pattern>
            </defs>
            <rect width="1000" height="540" fill="url(#grid)"/>
            {/* Sea on left */}
            <path d="M 0 0 Q 80 100, 160 200 Q 200 300, 140 400 Q 80 480, 0 540 L 0 0 Z" fill="#cfe0d8" opacity="0.6"/>
            {/* Roads */}
            <path d="M 50 350 Q 220 280, 380 320 T 700 250 T 950 300" stroke="#fff" strokeWidth="10" fill="none"/>
            <path d="M 50 350 Q 220 280, 380 320 T 700 250 T 950 300" stroke={T.pitchLight} strokeWidth="2" strokeDasharray="6 6" fill="none" opacity="0.4"/>
            <path d="M 200 0 L 280 120 L 250 280 L 380 320" stroke="#fff" strokeWidth="6" fill="none"/>
            <path d="M 560 0 L 540 200 L 600 380 L 480 540" stroke="#fff" strokeWidth="6" fill="none"/>
            <path d="M 780 540 L 720 380 L 800 220" stroke="#fff" strokeWidth="6" fill="none"/>
            {/* Green areas */}
            <ellipse cx="500" cy="180" rx="130" ry="50" fill={T.pitchLight} opacity="0.15"/>
            <ellipse cx="780" cy="420" rx="100" ry="60" fill={T.pitchLight} opacity="0.15"/>
            <ellipse cx="320" cy="450" rx="80" ry="40" fill={T.pitchLight} opacity="0.15"/>
            {/* City labels */}
            <g fontFamily={F.mono} fontSize="9" fill={T.inkMute} letterSpacing="0.15em" fontWeight="700">
              <text x="560" y="220">ZAGREB</text>
              <text x="640" y="135">VARAŽDIN</text>
              <text x="340" y="320">RIJEKA</text>
              <text x="420" y="455">SPLIT</text>
              <text x="800" y="245">OSIJEK</text>
              <text x="520" y="180">KRAPINA</text>
            </g>
            {/* Pins */}
            {MAP_PINS.map((p, i) => (
              <Pin key={i} x={p.x} y={p.y} pin={p} focus={i === 0}/>
            ))}
          </svg>
          {/* Attribution */}
          <div style={{
            position: 'absolute', bottom: 8, right: 14,
            fontFamily: F.mono, fontSize: 9, color: T.inkMute, letterSpacing: '0.1em',
            background: 'rgba(255,255,255,0.85)', padding: '3px 8px', borderRadius: 4,
          }}>
            ⊕ OpenStreetMap · CARTO
          </div>
        </div>
      </div>
    </PageShell>
  );
};

window.PageMap = PageMap;
