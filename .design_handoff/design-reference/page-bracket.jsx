// page-bracket.jsx — Ždrijeb tab (knockout bracket)

const BRACKET = {
  r1: [
    { home: 'FK Tresnjevka', away: 'NK Jarun', live: true },
    { home: 'NK Moslavina', away: 'FK Posavec' },
    { home: 'FK Brodosplit', away: 'NK Spansko' },
    { home: 'NK Vinkovci 91', away: 'NK Dugave' },
    { home: 'NK Sveta Nedjelja', away: 'NK Metalac' },
    { home: 'NK Borac', away: 'NK Slavonac' },
    { home: 'FK Sesvete', away: 'NK Krajina' },
    { home: 'FK Vukovar', away: 'FK Lika' },
  ],
};

const BracketCell = ({ home, away, homeScore, awayScore, live, winner }) => (
  <div style={{
    background: '#fff', border: `1px solid ${live ? T.red : T.border}`,
    borderRadius: 12, overflow: 'hidden',
    boxShadow: live ? `0 0 0 3px rgba(220,38,38,0.08)` : 'none',
    position: 'relative',
  }}>
    {live && (
      <div style={{
        position: 'absolute', top: -8, right: 10,
        background: T.red, color: '#fff', padding: '2px 8px',
        borderRadius: 99, fontSize: 9, fontWeight: 800, letterSpacing: '0.1em',
        display: 'inline-flex', alignItems: 'center', gap: 4,
      }}>
        <span style={{ width: 5, height: 5, borderRadius: 99, background: '#fff', animation: 'pulse 1.6s infinite' }}/>
        UŽIVO
      </div>
    )}
    {[{ name: home, score: homeScore, win: winner === 'home' }, { name: away, score: awayScore, win: winner === 'away' }].map((team, i) => (
      <div key={i} style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '12px 14px',
        borderTop: i === 1 ? `1px solid ${T.border}` : 'none',
        background: team.win ? T.surfaceTint : 'transparent',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            width: 6, height: 22, borderRadius: 2,
            background: team.win ? T.pitch : T.border,
          }}/>
          <span style={{ fontSize: 14, fontWeight: team.win ? 700 : 600, color: team.name ? T.ink : T.inkMute }}>
            {team.name || 'Pobjednik —'}
          </span>
        </div>
        <span style={{
          fontFamily: F.mono, fontSize: 18, fontWeight: 800,
          color: team.score !== undefined ? T.ink : T.inkMute,
          minWidth: 24, textAlign: 'center',
        }}>{team.score ?? '–'}</span>
      </div>
    ))}
    {(!homeScore && !awayScore && !live) && (
      <div style={{ padding: '8px 14px', borderTop: `1px solid ${T.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: T.surfaceTint2 }}>
        <button style={{
          background: 'none', border: 'none', color: T.pitch, fontSize: 12, fontWeight: 700,
          cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4,
        }}>
          Unesi rezultat
        </button>
        <button style={{
          background: 'none', border: 'none', color: T.red, fontSize: 12, fontWeight: 700,
          cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4,
        }}>
          <IconPlay size={9}/> Pokreni
        </button>
      </div>
    )}
    {live && (
      <div style={{ padding: '8px 14px', borderTop: `1px solid ${T.border}`, background: 'rgba(220,38,38,0.04)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontFamily: F.mono, fontSize: 10, color: T.red, fontWeight: 700, letterSpacing: '0.1em' }}>12:34 · 2. POLUVRIJEME</span>
        <a style={{ fontSize: 12, fontWeight: 700, color: T.pitch, cursor: 'pointer' }}>Otvori →</a>
      </div>
    )}
  </div>
);

// SVG bracket connector lines
const Connector = ({ from = 0, height = 100, color = T.border }) => (
  <svg width="40" height={height} style={{ display: 'block' }}>
    <path d={`M 0 ${from} L 20 ${from} L 20 ${height - from} L 0 ${height - from}`} stroke={color} strokeWidth="1.5" fill="none"/>
    <line x1="20" y1={height / 2} x2="40" y2={height / 2} stroke={color} strokeWidth="1.5"/>
  </svg>
);

const RoundLabel = ({ children, accent }) => (
  <div style={{
    display: 'inline-flex', alignItems: 'center', gap: 6,
    background: accent === 'final' ? '#fef3c7' : T.surfaceTint,
    color: accent === 'final' ? T.amber : T.pitch,
    padding: '6px 14px', borderRadius: 99,
    fontFamily: F.mono, fontSize: 11, fontWeight: 700, letterSpacing: '0.12em',
    textTransform: 'uppercase',
  }}>
    {accent === 'final' && <IconTrophy size={12}/>}
    {children}
  </div>
);

const BracketTabContent = () => (
  <>
    {/* Toolbar */}
    <div style={{
      background: '#fff', border: `1px solid ${T.border}`, borderRadius: 16,
      padding: '14px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      marginBottom: 20,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{
          width: 38, height: 38, borderRadius: 10, background: T.surfaceTint,
          color: T.pitch, display: 'grid', placeItems: 'center',
        }}>
          <IconBracket size={18}/>
        </div>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: T.ink }}>Eliminacija</div>
          <div style={{ fontSize: 12, color: T.inkMute }}>16 ekipa · 4 kola · 15 utakmica</div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <GhostButton icon={<IconShare size={14}/>}>Podijeli ždrijeb</GhostButton>
        <GhostButton danger icon={<IconEdit size={14}/>}>Ponovno generiraj</GhostButton>
      </div>
    </div>

    {/* Bracket */}
    <div style={{
      background: '#fff', border: `1px solid ${T.border}`, borderRadius: 16,
      padding: '24px 28px', overflowX: 'auto',
    }}>
      {/* Round headers */}
      <div style={{ display: 'grid', gridTemplateColumns: '280px 40px 280px 40px 280px 40px 280px', gap: 0, marginBottom: 20 }}>
        <RoundLabel>Osmina finala</RoundLabel>
        <div/>
        <RoundLabel>Četvrtfinale</RoundLabel>
        <div/>
        <RoundLabel>Polufinale</RoundLabel>
        <div/>
        <RoundLabel accent="final">Finale</RoundLabel>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '280px 40px 280px 40px 280px 40px 280px', gap: 0, alignItems: 'stretch' }}>
        {/* R1 — 8 matches */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {BRACKET.r1.map((m, i) => (
            <BracketCell key={i} home={m.home} away={m.away} live={m.live}/>
          ))}
        </div>
        {/* Connectors col */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} style={{ flex: 1, position: 'relative', minHeight: 230 }}>
              <Connector from={56} height={232}/>
            </div>
          ))}
        </div>

        {/* QF — 4 matches */}
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-around', gap: 36 }}>
          {Array.from({ length: 4 }).map((_, i) => (
            <BracketCell key={i} home={null} away={null}/>
          ))}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-around', gap: 36 }}>
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} style={{ flex: 1, position: 'relative', minHeight: 220 }}>
              <Connector from={56} height={232}/>
            </div>
          ))}
        </div>

        {/* SF — 2 matches */}
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-around', gap: 72 }}>
          {Array.from({ length: 2 }).map((_, i) => (
            <BracketCell key={i} home={null} away={null}/>
          ))}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <Connector from={120} height={400}/>
        </div>

        {/* F */}
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <div style={{
            background: 'linear-gradient(145deg, #fff8e6, #fef3c7)',
            border: `2px solid ${T.goal}`, borderRadius: 12, padding: 16, textAlign: 'center',
            boxShadow: '0 8px 24px rgba(245,185,33,0.15)',
          }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: T.amber, fontFamily: F.mono, fontSize: 10, fontWeight: 800, letterSpacing: '0.15em', marginBottom: 10 }}>
              <IconTrophy size={14}/> FINALE
            </div>
            <BracketCell home={null} away={null}/>
            <div style={{ marginTop: 12, fontFamily: F.mono, fontSize: 10, color: T.inkMute, letterSpacing: '0.1em' }}>NAGRADA 1. MJESTO · 5.000€</div>
          </div>
        </div>
      </div>
    </div>
  </>
);

const PageBracket = () => {
  const t = TOURNAMENTS[4];
  return (
    <PageShell active="Turniri">
      <BackLink/>
      <PageTitle title={t.name} status="draft" statusLabel="Nacrt"/>
      <TabBar tabs={DETAIL_TABS} active="Ždrijeb"/>
      <BracketTabContent/>
    </PageShell>
  );
};

window.PageBracket = PageBracket;
