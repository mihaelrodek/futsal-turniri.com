// page-teams.jsx — Ekipe tab (teams + selected team roster)

const TEAMS = [
  { id: 'nb', short: 'NB', name: 'NK Borac', color: '#dc2626', selected: true, players: 7 },
  { id: 'nj', short: 'NJ', name: 'NK Jarun', color: '#2563eb', players: 6 },
  { id: 'fb', short: 'FB', name: 'FK Brodosplit', color: '#7c3aed', players: 8 },
  { id: 'nm', short: 'NM', name: 'NK Metalac', color: '#f59e0b', players: 5 },
  { id: 'nv', short: 'NV', name: 'NK Vinkovci 91', color: '#10b981', players: 7 },
  { id: 'ft', short: 'FT', name: 'FK Tresnjevka', color: '#ef4444', players: 6 },
  { id: 'nd', short: 'ND', name: 'NK Dugave', color: '#06b6d4', players: 4 },
  { id: 'fp', short: 'FP', name: 'FK Posavec', color: '#8b5cf6', players: 7 },
  { id: 'nmo', short: 'NM', name: 'NK Moslavina', color: '#84cc16', players: 6 },
  { id: 'ns', short: 'NS', name: 'NK Spansko', color: '#f43f5e', players: 8 },
  { id: 'fs', short: 'FS', name: 'FK Sesvete', color: '#0ea5e9', players: 5 },
  { id: 'nk', short: 'NK', name: 'NK Krajina', color: '#a855f7', players: 7 },
];

const PLAYERS = [
  { num: 55, name: 'Luka Bozic', captain: true, role: 'Vratar', goals: 0 },
  { num: 90, name: 'Stjepan Pavlovic', role: 'Pivot', goals: 3 },
  { num: 81, name: 'Leon Soric', role: 'Krilo', goals: 1 },
  { num: 83, name: 'Vedran Vidovic', role: 'Krilo', goals: 0 },
  { num: 47, name: 'Marko Kovac', role: 'Fiksni', goals: 2 },
  { num: 94, name: 'Filip Loncar', role: 'Krilo', goals: 0 },
  { num: 39, name: 'Ante Djukic', role: 'Fiksni', goals: 1 },
];

const TeamListItem = ({ team }) => (
  <div style={{
    display: 'flex', alignItems: 'center', gap: 12,
    padding: '12px 16px', borderRadius: 12,
    background: team.selected ? T.surfaceTint : '#fff',
    border: `1px solid ${team.selected ? T.pitchLight : T.border}`,
    cursor: 'pointer', position: 'relative',
  }}>
    <div style={{
      width: 40, height: 40, borderRadius: 10,
      background: `linear-gradient(135deg, ${team.color}, ${team.color}cc)`,
      color: '#fff', display: 'grid', placeItems: 'center',
      fontFamily: F.display, fontSize: 14, fontWeight: 800,
      flexShrink: 0,
    }}>{team.short}</div>
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: T.ink }}>{team.name}</div>
      <div style={{ fontSize: 12, color: T.inkMute, marginTop: 1 }}>{team.players} igrača</div>
    </div>
    {team.selected ? (
      <button style={{
        width: 30, height: 30, borderRadius: 99, border: 'none',
        background: 'rgba(220,38,38,0.1)', color: T.red,
        display: 'grid', placeItems: 'center', cursor: 'pointer',
      }}>
        <IconTrash size={14}/>
      </button>
    ) : (
      <span style={{ color: T.inkMute }}><IconChev size={16}/></span>
    )}
  </div>
);

const PlayerRow = ({ player, isCaptain = false }) => (
  <div style={{
    display: 'flex', alignItems: 'center', gap: 12,
    padding: '10px 14px', borderRadius: 10,
    background: isCaptain ? T.surfaceTint : '#fff',
    border: `1px solid ${isCaptain ? T.pitchLight : T.border}`,
  }}>
    {/* Jersey number */}
    <div style={{
      width: 44, height: 44, borderRadius: 10,
      background: isCaptain ? T.pitch : T.surfaceTint,
      color: isCaptain ? '#fff' : T.ink,
      display: 'grid', placeItems: 'center',
      fontFamily: F.display, fontWeight: 800, fontSize: 16, letterSpacing: '-0.02em',
      flexShrink: 0,
    }}>{player.num}</div>
    <div style={{ flex: 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: T.ink }}>{player.name}</span>
        {isCaptain && (
          <span style={{
            background: T.pitch, color: '#fff', padding: '2px 8px',
            borderRadius: 6, fontSize: 9, fontWeight: 800, letterSpacing: '0.1em',
            fontFamily: F.mono,
          }}>K · KAPETAN</span>
        )}
      </div>
      <div style={{ fontSize: 12, color: T.inkMute, marginTop: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span>{player.role}</span>
        {player.goals > 0 && (
          <>
            <span style={{ color: T.border }}>·</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <BallIcon size={10} color={T.pitch}/> {player.goals} {player.goals === 1 ? 'gol' : 'gola'}
            </span>
          </>
        )}
      </div>
    </div>
    <button style={{
      width: 28, height: 28, borderRadius: 99, border: 'none',
      background: T.surfaceTint, color: T.inkSoft,
      display: 'grid', placeItems: 'center', cursor: 'pointer',
    }}>
      <IconEdit size={12}/>
    </button>
    <button style={{
      width: 28, height: 28, borderRadius: 99, border: 'none',
      background: 'rgba(220,38,38,0.1)', color: T.red,
      display: 'grid', placeItems: 'center', cursor: 'pointer',
    }}>
      <IconTrash size={12}/>
    </button>
  </div>
);

const TeamsTabContent = () => {
  const selected = TEAMS.find(t => t.selected);
  return (
    <>
      {/* Top stat strip */}
      <SectionCard icon={<IconUsers2 size={16}/>} title="Ekipe" subtitle="Dodaj ekipe i upravljaj sastavom."
        action={
          <div style={{ display: 'flex', gap: 8 }}>
            <GhostButton icon={<IconPlus size={14}/>}>Prijavi ekipu</GhostButton>
            <PrimaryButton icon={<IconPlus size={14}/>}>Dodaj ekipu</PrimaryButton>
          </div>
        }
      >
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          {[
            { label: 'PRIJAVLJENE', val: '16 / 16', color: T.pitch },
            { label: 'POPUNJENO', val: '100%', color: T.pitchLight },
            { label: 'IGRAČA UKUPNO', val: '108', color: T.ink },
            { label: 'PROSJEK / EKIPA', val: '6.8', color: T.amber },
          ].map(s => (
            <div key={s.label} style={{ padding: '12px 14px', background: T.surfaceTint2, borderRadius: 10, position: 'relative', overflow: 'hidden' }}>
              <div style={{ position: 'absolute', top: 0, left: 0, width: 3, height: '100%', background: s.color }}/>
              <div style={{ fontFamily: F.mono, fontSize: 10, color: T.inkMute, letterSpacing: '0.1em', fontWeight: 700 }}>{s.label}</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: T.ink, letterSpacing: '-0.02em', marginTop: 4 }}>{s.val}</div>
            </div>
          ))}
        </div>
      </SectionCard>

      {/* Two column layout */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr', gap: 24, marginTop: 24 }}>
        {/* Left — teams list */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, margin: 0, color: T.ink, fontFamily: F.mono, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
              Aktivne ekipe <span style={{ color: T.inkMute, fontWeight: 500, marginLeft: 4 }}>(12)</span>
            </h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#fff', border: `1px solid ${T.border}`, borderRadius: 10, padding: '6px 12px' }}>
              <IconSearch size={12}/>
              <input placeholder="Pretraži ekipu" style={{ width: 120, border: 'none', background: 'transparent', outline: 'none', fontSize: 12, color: T.ink }}/>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 720, overflow: 'hidden' }}>
            {TEAMS.map(team => <TeamListItem key={team.id} team={team}/>)}
          </div>
        </div>

        {/* Right — selected team detail */}
        <div>
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '14px 18px', background: '#fff',
            border: `1px solid ${T.border}`, borderRadius: 12, marginBottom: 12,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{
                width: 44, height: 44, borderRadius: 10,
                background: `linear-gradient(135deg, ${selected.color}, ${selected.color}cc)`,
                color: '#fff', display: 'grid', placeItems: 'center',
                fontFamily: F.display, fontSize: 15, fontWeight: 800,
              }}>{selected.short}</div>
              <div>
                <div style={{ fontSize: 17, fontWeight: 700, color: T.ink }}>{selected.name}</div>
                <div style={{ fontSize: 12, color: T.inkMute, marginTop: 1 }}>Sastav igrača · {selected.players} igrača</div>
              </div>
            </div>
            <PrimaryButton icon={<IconPlus size={14}/>}>Dodaj igrača</PrimaryButton>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {PLAYERS.map((p, i) => <PlayerRow key={p.num} player={p} isCaptain={i === 0}/>)}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
            <PrimaryButton>Spremi promjene</PrimaryButton>
          </div>
        </div>
      </div>
    </>
  );
};

const PageTeams = () => {
  const t = TOURNAMENTS[4]; // Zagorski Futsal Grand Prix
  return (
    <PageShell active="Turniri">
      <BackLink/>
      <PageTitle title={t.name} status="draft" statusLabel="Nacrt"/>
      <TabBar tabs={DETAIL_TABS} active="Ekipe"/>
      <TeamsTabContent/>
    </PageShell>
  );
};

window.PageTeams = PageTeams;
window.TEAMS = TEAMS;
