// page-live.jsx — Multiple live matches grid + upcoming schedule

const LIVE_MATCHES = [
  {
    tournament: 'Futsal Kup Zagreb 2026', round: 'Četvrtfinale · 3/8',
    home: { name: 'NK Bregana', short: 'NB', color: '#dc2626', score: 2 },
    away: { name: 'NK Stari grad', short: 'SG', color: '#2563eb', score: 1 },
    clock: "12:34", half: '1. POL.', watching: 247,
    events: [
      { side: 'h', min: "1'", name: 'K. Tomic', kind: 'goal' },
      { side: 'a', min: "4'", name: 'P. Vidovic', kind: 'goal' },
      { side: 'h', min: "6'", name: 'I. Galic', kind: 'goal' },
      { side: 'h', min: "11'", name: 'M. Pavlovic', kind: 'yellow' },
    ],
    venue: 'Dvorana Trešnjevka',
  },
  {
    tournament: 'Zagorski Futsal Grand Prix', round: 'Osmina finala · 5/8',
    home: { name: 'FK Brodosplit', short: 'FB', color: '#7c3aed', score: 3 },
    away: { name: 'NK Metalac', short: 'NM', color: '#f59e0b', score: 3 },
    clock: "17:08", half: '2. POL.', watching: 184,
    events: [
      { side: 'h', min: "3'", name: 'D. Krpan', kind: 'goal' },
      { side: 'a', min: "8'", name: 'A. Tomic', kind: 'goal' },
      { side: 'a', min: "14'", name: 'L. Vukic', kind: 'goal' },
      { side: 'h', min: "15'", name: 'D. Krpan', kind: 'goal' },
      { side: 'h', min: "16'", name: 'S. Babic', kind: 'goal' },
      { side: 'a', min: "17'", name: 'A. Tomic', kind: 'goal' },
    ],
    venue: 'Sportski centar Krapina',
  },
  {
    tournament: 'Ljetni Turnir Rijeka 2026', round: 'Grupa B · 4/6',
    home: { name: 'NK Jarun', short: 'NJ', color: '#0ea5e9', score: 0 },
    away: { name: 'NK Spansko', short: 'NS', color: '#f43f5e', score: 1 },
    clock: "08:12", half: '1. POL.', watching: 92,
    events: [
      { side: 'a', min: "5'", name: 'V. Vidovic', kind: 'goal' },
      { side: 'h', min: "7'", name: 'L. Bozic', kind: 'yellow' },
    ],
    venue: 'Dvorana Zamet',
  },
  {
    tournament: 'Futsal Liga Slavonije', round: 'Polufinale · 1/2',
    home: { name: 'NK Vinkovci 91', short: 'NV', color: '#10b981', score: 5 },
    away: { name: 'FK Sesvete', short: 'FS', color: '#0ea5e9', score: 2 },
    clock: "19:45", half: '2. POL.', watching: 156,
    events: [
      { side: 'h', min: "2'", name: 'L. Marinic', kind: 'goal' },
      { side: 'h', min: "7'", name: 'L. Marinic', kind: 'goal' },
      { side: 'a', min: "9'", name: 'M. Tonjic', kind: 'goal' },
      { side: 'h', min: "12'", name: 'I. Galic', kind: 'goal' },
      { side: 'a', min: "15'", name: 'F. Loncar', kind: 'goal' },
      { side: 'h', min: "18'", name: 'A. Djukic', kind: 'goal' },
      { side: 'h', min: "19'", name: 'L. Marinic', kind: 'goal' },
    ],
    venue: 'Gradski vrt, Osijek',
  },
];

const UPCOMING_TODAY = [
  { time: '21:00', home: 'NK Borac', away: 'NK Slavonac', tournament: 'Zagorski Futsal Grand Prix', round: 'Osmina finala' },
  { time: '21:40', home: 'FK Sesvete', away: 'NK Krajina', tournament: 'Zagorski Futsal Grand Prix', round: 'Osmina finala' },
  { time: '22:00', home: 'NK Bregana', away: '—', tournament: 'Futsal Kup Zagreb 2026', round: 'Polufinale', note: 'Pobjednik QF1' },
];

const TeamBadge = ({ team, size = 36 }) => (
  <div style={{
    width: size, height: size, borderRadius: size / 4,
    background: `linear-gradient(145deg, ${team.color}, ${team.color}cc)`,
    color: '#fff', display: 'grid', placeItems: 'center',
    fontFamily: F.display, fontSize: size * 0.36, fontWeight: 800, letterSpacing: '-0.02em',
    flexShrink: 0,
  }}>{team.short}</div>
);

const EventChip = ({ event }) => {
  const isGoal = event.kind === 'goal';
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 5,
      padding: '3px 8px', borderRadius: 99,
      background: isGoal ? 'rgba(245,185,33,0.12)' : 'rgba(220,38,38,0.1)',
      color: isGoal ? T.amber : T.red,
      fontSize: 11, fontWeight: 600,
    }}>
      <span style={{ fontFamily: F.mono, fontWeight: 700 }}>{event.min}</span>
      {isGoal ? <BallIcon size={10} color={T.amber}/> :
        <span style={{ width: 7, height: 9, background: T.amber, borderRadius: 1 }}/>}
      <span>{event.name}</span>
    </div>
  );
};

const LiveMatchCard = ({ match, featured = false }) => (
  <article style={{
    background: '#fff', borderRadius: 16, overflow: 'hidden',
    border: `1px solid ${T.border}`,
    boxShadow: featured ? `0 0 0 3px rgba(220,38,38,0.06)` : 'none',
    display: 'flex', flexDirection: 'column',
  }}>
    {/* Top — tournament + live badge */}
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '10px 16px', background: T.surfaceTint2,
      borderBottom: `1px solid ${T.border}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 5,
          background: T.red, color: '#fff', padding: '2px 8px', borderRadius: 99,
          fontFamily: F.mono, fontSize: 9, fontWeight: 800, letterSpacing: '0.1em',
        }}>
          <span style={{ width: 5, height: 5, borderRadius: 99, background: '#fff', animation: 'pulse 1.6s infinite' }}/>
          UŽIVO
        </span>
        <span style={{ fontSize: 12, fontWeight: 600, color: T.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {match.tournament}
        </span>
        <span style={{ fontFamily: F.mono, fontSize: 10, color: T.inkMute, letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>
          · {match.round}
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontFamily: F.mono, fontSize: 10, color: T.inkMute, letterSpacing: '0.05em', flexShrink: 0 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <IconUsers size={10}/> {match.watching}
        </span>
        <span>· {match.venue}</span>
      </div>
    </div>

    {/* Scoreboard */}
    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 16, padding: '20px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'flex-end' }}>
        <span style={{ fontSize: 16, fontWeight: 700, color: T.ink, textAlign: 'right' }}>{match.home.name}</span>
        <TeamBadge team={match.home} size={44}/>
      </div>
      <div style={{ textAlign: 'center', padding: '0 4px' }}>
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          background: 'rgba(245,185,33,0.15)', color: T.amber,
          padding: '2px 8px', borderRadius: 99,
          fontFamily: F.mono, fontSize: 9, fontWeight: 800, letterSpacing: '0.12em',
          marginBottom: 4,
        }}>
          <IconClock size={10}/> {match.clock} · {match.half}
        </div>
        <div style={{
          fontFamily: F.mono, fontSize: 42, fontWeight: 800, color: T.ink,
          letterSpacing: '-0.04em', lineHeight: 1,
        }}>
          {match.home.score}<span style={{ color: T.borderStrong, padding: '0 10px' }}>:</span>{match.away.score}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <TeamBadge team={match.away} size={44}/>
        <span style={{ fontSize: 16, fontWeight: 700, color: T.ink }}>{match.away.name}</span>
      </div>
    </div>

    {/* Mini event ticker */}
    <div style={{
      padding: '10px 16px', background: T.surfaceTint2,
      borderTop: `1px solid ${T.border}`,
      display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
      minHeight: 44,
    }}>
      {match.events.slice(-5).map((e, i) => <EventChip key={i} event={e}/>)}
      {match.events.length > 5 && (
        <span style={{ fontFamily: F.mono, fontSize: 10, color: T.inkMute }}>+{match.events.length - 5}</span>
      )}
    </div>

    {/* Footer action */}
    <div style={{
      padding: '10px 16px', borderTop: `1px solid ${T.border}`,
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    }}>
      <div style={{ display: 'flex', gap: 14, fontFamily: F.mono, fontSize: 10, color: T.inkMute, letterSpacing: '0.05em' }}>
        <span><span style={{ color: T.ink, fontWeight: 700 }}>{match.events.filter(e => e.kind === 'goal').length}</span> GOLOVA</span>
        <span><span style={{ color: T.ink, fontWeight: 700 }}>{match.events.filter(e => e.kind === 'yellow').length}</span> KARTONA</span>
      </div>
      <button style={{
        padding: '6px 14px', borderRadius: 99, border: 'none',
        background: T.pitch, color: '#fff',
        fontSize: 12, fontWeight: 700, cursor: 'pointer',
        display: 'inline-flex', alignItems: 'center', gap: 5,
      }}>
        <IconPlay size={9}/> Prati uživo
      </button>
    </div>
  </article>
);

const FilterChips = ({ tabs, active }) => (
  <div style={{ display: 'flex', gap: 8 }}>
    {tabs.map(tab => (
      <button key={tab.label} style={{
        display: 'inline-flex', alignItems: 'center', gap: 7, padding: '8px 16px',
        borderRadius: 99, border: 'none',
        background: tab.label === active ? T.ink : '#fff',
        color: tab.label === active ? '#fff' : T.inkSoft,
        fontSize: 13, fontWeight: 600, cursor: 'pointer',
        boxShadow: tab.label === active ? 'none' : `inset 0 0 0 1px ${T.border}`,
      }}>
        {tab.dot && <span style={{ width: 7, height: 7, borderRadius: 99, background: tab.dot, animation: tab.dot === T.red ? 'pulse 1.6s infinite' : 'none' }}/>}
        {tab.label}
        <span style={{ color: tab.label === active ? 'rgba(255,255,255,0.6)' : T.inkMute, fontWeight: 700 }}>{tab.count}</span>
      </button>
    ))}
  </div>
);

const PageLive = () => (
  <PageShell active="Uživo">
    {/* Header */}
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 20 }}>
      <div>
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          fontFamily: F.mono, fontSize: 11, color: T.red, letterSpacing: '0.2em', fontWeight: 700,
        }}>
          <span style={{ width: 8, height: 8, borderRadius: 99, background: T.red, animation: 'pulse 1.6s infinite' }}/>
          UŽIVO SADA
        </div>
        <h1 style={{ fontSize: 32, fontWeight: 800, margin: '6px 0 0', letterSpacing: '-0.025em' }}>
          {LIVE_MATCHES.length} utakmice u tijeku
        </h1>
        <p style={{ fontSize: 13, color: T.inkMute, margin: '4px 0 0' }}>
          Prati sve utakmice paralelno · 3 nadolaze danas
        </p>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <GhostButton icon={<IconShare size={14}/>}>Podijeli</GhostButton>
        <GhostButton icon={<IconCalendar size={14}/>}>Cijeli raspored</GhostButton>
      </div>
    </div>

    {/* Filter chips */}
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
      <FilterChips
        active="Uživo"
        tabs={[
          { label: 'Sve', count: 16 },
          { label: 'Uživo', count: LIVE_MATCHES.length, dot: T.red },
          { label: 'Nadolaze danas', count: 3, dot: T.amber },
          { label: 'Završene danas', count: 4, dot: T.inkMute },
        ]}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontFamily: F.mono, fontSize: 10, color: T.inkMute, letterSpacing: '0.1em' }}>SORTIRAJ</span>
        <button style={{
          padding: '7px 12px', borderRadius: 99,
          background: '#fff', border: `1px solid ${T.border}`, color: T.ink,
          fontSize: 12, fontWeight: 600, cursor: 'pointer',
          display: 'inline-flex', alignItems: 'center', gap: 6,
        }}>
          Najnoviji događaj <IconChev size={12}/>
        </button>
      </div>
    </div>

    {/* Live matches grid */}
    <section style={{ marginBottom: 36 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 18 }}>
        {LIVE_MATCHES.map((m, i) => (
          <LiveMatchCard key={i} match={m} featured={i === 0}/>
        ))}
      </div>
    </section>

    {/* Upcoming today + side panel */}
    <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 24 }}>
      <SectionCard
        icon={<IconClock size={16}/>}
        title="Nadolazeće utakmice danas"
        subtitle="Sljedeće 3 utakmice u rasporedu"
        action={<a style={{ fontSize: 13, color: T.pitch, fontWeight: 600, cursor: 'pointer' }}>Sve nadolazeće →</a>}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {UPCOMING_TODAY.map((u, i) => (
            <div key={i} style={{
              display: 'grid', gridTemplateColumns: '60px 1fr auto auto',
              alignItems: 'center', gap: 14, padding: '12px 14px',
              background: T.surfaceTint2, border: `1px solid ${T.border}`, borderRadius: 12,
            }}>
              <div style={{
                fontFamily: F.mono, fontSize: 18, fontWeight: 800,
                color: T.ink, letterSpacing: '-0.02em', textAlign: 'center',
              }}>{u.time}</div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: T.ink }}>
                  {u.home} <span style={{ color: T.inkMute, fontWeight: 500, padding: '0 6px' }}>vs</span> {u.away}
                  {u.note && (
                    <span style={{
                      marginLeft: 8, fontFamily: F.mono, fontSize: 9, color: T.amber, fontWeight: 800,
                      background: 'rgba(245,185,33,0.12)', padding: '2px 6px', borderRadius: 4, letterSpacing: '0.05em',
                    }}>
                      {u.note.toUpperCase()}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 12, color: T.inkMute, marginTop: 2 }}>
                  {u.tournament} · {u.round}
                </div>
              </div>
              <button style={{
                padding: '6px 12px', borderRadius: 99,
                background: '#fff', border: `1px solid ${T.border}`,
                color: T.ink, fontSize: 11, fontWeight: 600, cursor: 'pointer',
              }}>
                Podsjeti me
              </button>
              <span style={{ color: T.inkMute }}><IconChev size={14}/></span>
            </div>
          ))}
        </div>
      </SectionCard>

      <SectionCard icon={<BallIcon size={16} color={T.pitch}/>} title="Strijelci dana" subtitle="Najbolji preko svih utakmica">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[
            { num: 11, name: 'L. Marinic', team: 'NK Vinkovci 91', tc: '#10b981', g: 3 },
            { num: 14, name: 'D. Krpan', team: 'FK Brodosplit', tc: '#7c3aed', g: 2 },
            { num: 7, name: 'A. Tomic', team: 'NK Metalac', tc: '#f59e0b', g: 2 },
            { num: 9, name: 'I. Galic', team: 'NK Bregana', tc: '#dc2626', g: 2 },
          ].map(p => (
            <div key={p.num + p.name} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', background: T.surfaceTint2, borderRadius: 10 }}>
              <div style={{ width: 32, height: 32, borderRadius: 8, background: T.ink, color: '#fff', display: 'grid', placeItems: 'center', fontFamily: F.display, fontWeight: 800, fontSize: 12 }}>{p.num}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: T.ink }}>{p.name}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 1 }}>
                  <span style={{ width: 6, height: 6, borderRadius: 2, background: p.tc }}/>
                  <span style={{ fontSize: 11, color: T.inkMute }}>{p.team}</span>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <BallIcon size={11} color={T.pitch}/>
                <span style={{ fontSize: 14, fontWeight: 800, color: T.ink }}>{p.g}</span>
              </div>
            </div>
          ))}
        </div>
      </SectionCard>
    </div>
  </PageShell>
);

window.PageLive = PageLive;
