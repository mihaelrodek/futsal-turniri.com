// page-schedule.jsx — Raspored tab (match format + match list)

const MATCHES = [
  { round: 'OSMINA FINALA', home: 'FK Tresnjevka', away: 'NK Jarun', time: '09:00', day: 'NED 05. SRP', status: 'live', score: '0-0', clock: "12' 1. pol." },
  { round: 'OSMINA FINALA', home: 'NK Moslavina', away: 'FK Posavec', time: '09:40', day: 'NED 05. SRP' },
  { round: 'OSMINA FINALA', home: 'FK Brodosplit', away: 'NK Spansko', time: '10:20', day: 'NED 05. SRP' },
  { round: 'OSMINA FINALA', home: 'NK Vinkovci 91', away: 'NK Dugave', time: '11:00', day: 'NED 05. SRP' },
  { round: 'OSMINA FINALA', home: 'NK Sveta Nedjelja', away: 'NK Metalac', time: '11:40', day: 'NED 05. SRP' },
  { round: 'OSMINA FINALA', home: 'NK Borac', away: 'NK Slavonac', time: '12:20', day: 'NED 05. SRP' },
  { round: 'OSMINA FINALA', home: 'FK Sesvete', away: 'NK Krajina', time: '13:00', day: 'NED 05. SRP' },
  { round: 'OSMINA FINALA', home: 'FK Vukovar', away: 'FK Lika', time: '13:40', day: 'NED 05. SRP' },
];

const FormatField = ({ label, value, sub }) => (
  <div style={{
    background: '#fff', border: `1px solid ${T.border}`, borderRadius: 12,
    padding: '14px 16px',
  }}>
    <div style={{ fontFamily: F.mono, fontSize: 10, color: T.inkMute, letterSpacing: '0.1em', fontWeight: 700 }}>{label}</div>
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 4 }}>
      <span style={{ fontSize: 24, fontWeight: 800, color: T.ink, letterSpacing: '-0.02em' }}>{value}</span>
      {sub && <span style={{ fontSize: 12, color: T.inkMute }}>{sub}</span>}
    </div>
  </div>
);

const MatchRow = ({ m, idx }) => {
  const isLive = m.status === 'live';
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '54px 110px 1fr auto 1fr 110px',
      alignItems: 'center', gap: 16, padding: '14px 20px',
      background: '#fff',
      border: `1px solid ${isLive ? T.red : T.border}`,
      borderRadius: 12,
      boxShadow: isLive ? '0 0 0 3px rgba(220,38,38,0.06)' : 'none',
    }}>
      {/* Match number */}
      <div style={{
        width: 40, height: 40, borderRadius: 10, background: T.surfaceTint,
        color: T.pitch, display: 'grid', placeItems: 'center',
        fontFamily: F.display, fontSize: 15, fontWeight: 800,
      }}>{String(idx + 1).padStart(2, '0')}</div>

      {/* Time */}
      <div>
        <div style={{ fontFamily: F.mono, fontSize: 16, fontWeight: 800, color: T.ink, letterSpacing: '-0.02em' }}>{m.time}</div>
        <div style={{ fontFamily: F.mono, fontSize: 10, color: T.inkMute, letterSpacing: '0.08em' }}>{m.day}</div>
      </div>

      {/* Home */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10 }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: T.ink, textAlign: 'right' }}>{m.home}</span>
        <div style={{ width: 32, height: 32, borderRadius: 8, background: '#dc2626', color: '#fff', display: 'grid', placeItems: 'center', fontFamily: F.display, fontSize: 11, fontWeight: 800 }}>
          {m.home.split(' ').map(w => w[0]).slice(0, 2).join('')}
        </div>
      </div>

      {/* Score / VS */}
      <div style={{ textAlign: 'center', minWidth: 80 }}>
        {isLive ? (
          <>
            <div style={{ fontFamily: F.mono, fontSize: 20, fontWeight: 800, color: T.ink, letterSpacing: '-0.02em' }}>0 : 0</div>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontFamily: F.mono, fontSize: 10, color: T.red, fontWeight: 700, letterSpacing: '0.1em', marginTop: 2 }}>
              <span style={{ width: 5, height: 5, borderRadius: 99, background: T.red, animation: 'pulse 1.6s infinite' }}/>
              {m.clock}
            </div>
          </>
        ) : (
          <div style={{ fontFamily: F.mono, fontSize: 14, color: T.inkMute, fontWeight: 700 }}>– vs –</div>
        )}
      </div>

      {/* Away */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 32, height: 32, borderRadius: 8, background: '#2563eb', color: '#fff', display: 'grid', placeItems: 'center', fontFamily: F.display, fontSize: 11, fontWeight: 800 }}>
          {m.away.split(' ').map(w => w[0]).slice(0, 2).join('')}
        </div>
        <span style={{ fontSize: 15, fontWeight: 700, color: T.ink }}>{m.away}</span>
      </div>

      {/* Action */}
      <div style={{ textAlign: 'right' }}>
        {isLive ? (
          <button style={{
            padding: '8px 14px', borderRadius: 99, border: 'none',
            background: T.red, color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', gap: 6,
          }}>
            <IconPlay size={10}/> Prati
          </button>
        ) : (
          <button style={{
            padding: '7px 12px', borderRadius: 99, border: `1px solid ${T.border}`,
            background: '#fff', color: T.ink, fontSize: 12, fontWeight: 600, cursor: 'pointer',
          }}>
            Detalji →
          </button>
        )}
      </div>
    </div>
  );
};

const ScheduleTabContent = () => (
  <>
    {/* Format */}
    <SectionCard
      icon={<IconSettings size={16}/>}
      title="Format utakmice"
      subtitle="Trajanje, poluvremena i pauze između utakmica"
      action={<PrimaryButton icon={<IconCalendar size={14}/>}>Generiraj raspored</PrimaryButton>}
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
        <FormatField label="BROJ POLUVREMENA" value="2" sub="× po"/>
        <FormatField label="TRAJANJE POLUVRIJEME" value="10" sub="min"/>
        <FormatField label="PAUZA POLUVRIJEME" value="5" sub="min"/>
        <FormatField label="PAUZA IZMEĐU UTAKMICA" value="5" sub="min"/>
        <FormatField label="BUFFER" value="5" sub="min"/>
      </div>
      <div style={{ marginTop: 16, padding: '12px 16px', background: T.surfaceTint, borderRadius: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <IconClock size={14}/>
          <span style={{ fontSize: 13, color: T.ink, fontWeight: 600 }}>Trajanje termina:</span>
          <span style={{ fontFamily: F.mono, fontSize: 15, color: T.pitch, fontWeight: 800 }}>35 min</span>
        </div>
        <span style={{ fontFamily: F.mono, fontSize: 11, color: T.inkMute, letterSpacing: '0.1em' }}>
          POČETAK · 09:00 · KRAJ · ~18:20
        </span>
      </div>
    </SectionCard>

    {/* Schedule list */}
    <div style={{ marginTop: 20 }}>
      <SectionCard
        icon={<IconCalendar size={16}/>}
        title="Raspored utakmica"
        subtitle="16 utakmica · 1 dvorana · jedan dan"
        action={
          <div style={{ display: 'flex', gap: 8 }}>
            <GhostButton icon={<IconShare size={14}/>}>Izvoz PDF</GhostButton>
          </div>
        }
      >
        {/* Round header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <div style={{
            background: T.surfaceTint, color: T.pitch, padding: '6px 14px',
            borderRadius: 99, fontFamily: F.mono, fontSize: 11, fontWeight: 800, letterSpacing: '0.15em',
          }}>OSMINA FINALA · 8 UTAKMICA</div>
          <div style={{ flex: 1, height: 1, background: T.border }}/>
          <span style={{ fontFamily: F.mono, fontSize: 11, color: T.inkMute, letterSpacing: '0.1em' }}>NED · 05. SRP 2026</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {MATCHES.map((m, i) => <MatchRow key={i} m={m} idx={i}/>)}
        </div>

        {/* Future rounds placeholder */}
        <div style={{ marginTop: 20, padding: '20px', textAlign: 'center', border: `1px dashed ${T.border}`, borderRadius: 12, color: T.inkMute, fontSize: 13 }}>
          Četvrtfinale, polufinale i finale generirat će se nakon završetka osmine finala.
        </div>
      </SectionCard>
    </div>
  </>
);

const PageSchedule = () => {
  const t = TOURNAMENTS[4];
  return (
    <PageShell active="Turniri">
      <BackLink/>
      <PageTitle title={t.name} status="active" statusLabel="U tijeku"/>
      <TabBar tabs={DETAIL_TABS} active="Raspored"/>
      <ScheduleTabContent/>
    </PageShell>
  );
};

window.PageSchedule = PageSchedule;
