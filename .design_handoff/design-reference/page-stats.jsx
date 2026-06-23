// page-stats.jsx — Statistika tab (top scorers + team standings)

const SCORERS = [
  { rank: 1, num: 9, name: 'Petar Vidovic', team: 'NK Stari grad', teamColor: '#2563eb', goals: 7, matches: 3, assists: 2 },
  { rank: 2, num: 11, name: 'Karlo Tomic', team: 'NK Bregana', teamColor: '#dc2626', goals: 6, matches: 3, assists: 4 },
  { rank: 3, num: 7, name: 'Igor Galic', team: 'NK Bregana', teamColor: '#dc2626', goals: 5, matches: 3, assists: 1 },
  { rank: 4, num: 90, name: 'Stjepan Pavlovic', team: 'NK Borac', teamColor: '#dc2626', goals: 4, matches: 2, assists: 2 },
  { rank: 5, num: 14, name: 'Domagoj Krpan', team: 'FK Brodosplit', teamColor: '#7c3aed', goals: 4, matches: 2, assists: 0 },
  { rank: 6, num: 22, name: 'Luka Marinic', team: 'NK Jarun', teamColor: '#2563eb', goals: 3, matches: 2, assists: 3 },
];

const STANDINGS = [
  { rank: 1, team: 'NK Bregana', short: 'NB', color: '#dc2626', mp: 3, w: 3, d: 0, l: 0, gf: 12, ga: 4, pts: 9 },
  { rank: 2, team: 'NK Stari grad', short: 'SG', color: '#2563eb', mp: 3, w: 2, d: 1, l: 0, gf: 9, ga: 5, pts: 7 },
  { rank: 3, team: 'FK Brodosplit', short: 'FB', color: '#7c3aed', mp: 3, w: 2, d: 0, l: 1, gf: 8, ga: 6, pts: 6 },
  { rank: 4, team: 'NK Borac', short: 'NB', color: '#dc2626', mp: 3, w: 1, d: 1, l: 1, gf: 6, ga: 7, pts: 4 },
];

const ScorerRow = ({ p }) => {
  const medalColor = ['#f5c842', '#c0c5cc', '#cd8654'][p.rank - 1];
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '40px 50px 1fr auto 60px',
      alignItems: 'center', gap: 14, padding: '12px 16px',
      background: '#fff', border: `1px solid ${T.border}`, borderRadius: 12,
    }}>
      <div style={{
        width: 32, height: 32, borderRadius: 99,
        background: p.rank <= 3 ? `linear-gradient(145deg, ${medalColor}, ${medalColor}cc)` : T.surfaceTint,
        color: p.rank <= 3 ? '#fff' : T.ink,
        display: 'grid', placeItems: 'center',
        fontFamily: F.display, fontSize: 13, fontWeight: 800,
      }}>{p.rank}</div>
      <div style={{
        width: 42, height: 42, borderRadius: 10, background: T.ink, color: '#fff',
        display: 'grid', placeItems: 'center',
        fontFamily: F.display, fontWeight: 800, fontSize: 16, letterSpacing: '-0.02em',
      }}>{p.num}</div>
      <div>
        <div style={{ fontSize: 15, fontWeight: 700, color: T.ink }}>{p.name}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: p.teamColor }}/>
          <span style={{ fontSize: 12, color: T.inkMute }}>{p.team}</span>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 16, fontFamily: F.mono, fontSize: 12, color: T.inkMute }}>
        <span><span style={{ color: T.ink, fontWeight: 700 }}>{p.matches}</span> UTAK.</span>
        <span><span style={{ color: T.ink, fontWeight: 700 }}>{p.assists}</span> ASIST.</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
        <BallIcon size={14} color={T.pitch}/>
        <span style={{ fontSize: 22, fontWeight: 800, color: T.ink, letterSpacing: '-0.02em' }}>{p.goals}</span>
      </div>
    </div>
  );
};

const StandingsTable = () => (
  <div style={{ background: '#fff', border: `1px solid ${T.border}`, borderRadius: 12, overflow: 'hidden' }}>
    <div style={{
      display: 'grid', gridTemplateColumns: '40px 1fr 36px 36px 36px 36px 60px 50px',
      gap: 8, padding: '12px 16px', borderBottom: `1px solid ${T.border}`,
      background: T.surfaceTint2,
      fontFamily: F.mono, fontSize: 10, color: T.inkMute, letterSpacing: '0.1em', fontWeight: 700,
    }}>
      <span>#</span><span>EKIPA</span>
      <span style={{ textAlign: 'center' }}>UT</span>
      <span style={{ textAlign: 'center' }}>P</span>
      <span style={{ textAlign: 'center' }}>N</span>
      <span style={{ textAlign: 'center' }}>I</span>
      <span style={{ textAlign: 'center' }}>GOL</span>
      <span style={{ textAlign: 'center' }}>PTS</span>
    </div>
    {STANDINGS.map(s => (
      <div key={s.rank} style={{
        display: 'grid', gridTemplateColumns: '40px 1fr 36px 36px 36px 36px 60px 50px',
        gap: 8, padding: '12px 16px', alignItems: 'center',
        borderBottom: `1px solid ${T.border}`,
        background: s.rank === 1 ? T.surfaceTint : 'transparent',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 4, height: 22, borderRadius: 2, background: s.rank <= 2 ? T.pitch : s.rank <= 4 ? T.amber : T.border }}/>
          <span style={{ fontFamily: F.mono, fontSize: 13, fontWeight: 700, color: T.ink }}>{s.rank}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 28, height: 28, borderRadius: 7, background: `linear-gradient(135deg, ${s.color}, ${s.color}cc)`, color: '#fff', display: 'grid', placeItems: 'center', fontFamily: F.display, fontSize: 11, fontWeight: 800 }}>{s.short}</div>
          <span style={{ fontSize: 14, fontWeight: 700, color: T.ink }}>{s.team}</span>
        </div>
        <span style={{ textAlign: 'center', fontFamily: F.mono, fontSize: 13, color: T.ink }}>{s.mp}</span>
        <span style={{ textAlign: 'center', fontFamily: F.mono, fontSize: 13, color: T.pitch, fontWeight: 700 }}>{s.w}</span>
        <span style={{ textAlign: 'center', fontFamily: F.mono, fontSize: 13, color: T.inkSoft }}>{s.d}</span>
        <span style={{ textAlign: 'center', fontFamily: F.mono, fontSize: 13, color: T.red }}>{s.l}</span>
        <span style={{ textAlign: 'center', fontFamily: F.mono, fontSize: 13, color: T.ink }}>{s.gf}:{s.ga}</span>
        <span style={{ textAlign: 'center', fontSize: 16, fontWeight: 800, color: T.ink, letterSpacing: '-0.02em' }}>{s.pts}</span>
      </div>
    ))}
  </div>
);

const StatsTabContent = ({ hasData = true }) => {
  if (!hasData) {
    return (
      <SectionCard icon={<IconTarget size={16}/>} title="Najbolji strijelci" subtitle="Lista strijelaca po broju postignutih golova">
        <div style={{ padding: '48px 24px', textAlign: 'center', position: 'relative' }}>
          <div style={{
            display: 'inline-grid', placeItems: 'center', width: 56, height: 56, borderRadius: 99,
            background: T.surfaceTint, color: T.pitch, marginBottom: 12,
          }}>
            <BallIcon size={28} color={T.pitch}/>
          </div>
          <div style={{ fontSize: 18, fontWeight: 700, color: T.ink }}>Još nema golova</div>
          <div style={{ fontSize: 14, color: T.inkMute, marginTop: 4 }}>
            Statistika strijelaca prikazat će se čim padne prvi gol na turniru.
          </div>
        </div>
      </SectionCard>
    );
  }
  return (
    <>
      {/* Headline stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
        {[
          { label: 'UTAKMICA', val: '6', sub: 'odigrano od 16', color: T.pitch, icon: <IconWhistle size={14}/> },
          { label: 'GOLOVA', val: '35', sub: 'prosjek 5.8 / utak.', color: T.goal, icon: <BallIcon size={14}/> },
          { label: 'NAJVIŠE U UTAK.', val: '8', sub: 'NK Bregana 8:2', color: T.red, icon: <IconTrophy size={14}/> },
          { label: 'NAJBRŽI GOL', val: '12"', sub: 'P. Vidovic · 4. kolo', color: T.amber, icon: <IconClock size={14}/> },
        ].map(s => (
          <div key={s.label} style={{
            background: '#fff', border: `1px solid ${T.border}`, borderRadius: 12,
            padding: '14px 18px', position: 'relative', overflow: 'hidden',
          }}>
            <div style={{ position: 'absolute', top: 0, left: 0, width: 3, height: '100%', background: s.color }}/>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: T.inkMute, fontSize: 10, fontWeight: 700, fontFamily: F.mono, letterSpacing: '0.1em' }}>
              {s.icon} {s.label}
            </div>
            <div style={{ fontSize: 26, fontWeight: 800, color: T.ink, letterSpacing: '-0.025em', marginTop: 4 }}>{s.val}</div>
            <div style={{ fontSize: 12, color: T.inkMute, marginTop: 2 }}>{s.sub}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr', gap: 20 }}>
        <SectionCard
          icon={<BallIcon size={16} color={T.pitch}/>}
          title="Najbolji strijelci"
          subtitle="Lista strijelaca po broju postignutih golova"
          action={<a style={{ fontSize: 13, color: T.pitch, fontWeight: 600 }}>Cijela lista →</a>}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {SCORERS.map(p => <ScorerRow key={p.num} p={p}/>)}
          </div>
        </SectionCard>

        <SectionCard
          icon={<IconTrophy size={16}/>}
          title="Tablica grupa"
          subtitle="Bodovi · pobjede · golovi"
        >
          <StandingsTable/>
          <div style={{ marginTop: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: T.surfaceTint, borderRadius: 10 }}>
            <span style={{ fontSize: 12, color: T.inkMute }}>
              <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: T.pitch, marginRight: 6 }}/>
              Prolaze · 
              <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: T.amber, marginRight: 6, marginLeft: 12 }}/>
              Doigravanje
            </span>
            <span style={{ fontFamily: F.mono, fontSize: 11, color: T.inkMute, letterSpacing: '0.1em' }}>SKUPINA A · 4 EKIPE</span>
          </div>
        </SectionCard>
      </div>
    </>
  );
};

const PageStats = () => {
  const t = TOURNAMENTS[2]; // Futsal Kup Zagreb 2026 — has live match
  return (
    <PageShell active="Turniri">
      <BackLink/>
      <PageTitle title={t.name} status="active" statusLabel="U tijeku"/>
      <TabBar tabs={DETAIL_TABS} active="Statistika"/>
      <StatsTabContent/>
    </PageShell>
  );
};

const PageStatsEmpty = () => {
  const t = TOURNAMENTS[4]; // Zagorski — empty state
  return (
    <PageShell active="Turniri">
      <BackLink/>
      <PageTitle title={t.name} status="draft" statusLabel="Nacrt"/>
      <TabBar tabs={DETAIL_TABS} active="Statistika"/>
      <StatsTabContent hasData={false}/>
    </PageShell>
  );
};

window.PageStats = PageStats;
window.PageStatsEmpty = PageStatsEmpty;
