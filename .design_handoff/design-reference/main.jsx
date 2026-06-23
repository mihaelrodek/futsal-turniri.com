// main.jsx — design canvas wiring all pages

const Intro = () => (
  <div style={{
    background: 'linear-gradient(135deg, #fff 0%, #f3f6f1 100%)',
    color: T.ink, padding: '36px 44px', borderRadius: 16,
    fontFamily: F.sans, minWidth: 640,
    border: `1px solid ${T.border}`,
  }}>
    <div style={{ fontFamily: F.mono, fontSize: 11, color: T.pitch, letterSpacing: '0.2em', fontWeight: 700, marginBottom: 10 }}>
      FUTSAL TURNIRI · REDESIGN v2
    </div>
    <h1 style={{ fontFamily: F.display, fontSize: 32, fontWeight: 800, margin: '0 0 12px', letterSpacing: '-0.025em', color: T.ink }}>
      Pitch theme — every screen in the app
    </h1>
    <p style={{ fontSize: 15, color: T.inkSoft, lineHeight: 1.55, maxWidth: 560, margin: 0 }}>
      Direction C extended across the whole product: tournaments listing with the scoreboard hero up top
      (per your note), poster-based tournament cards, plus every detail screen, the bracket, schedule,
      stats, the create-tournament form, the map and the live page. Click any artboard's ⤢ to expand.
    </p>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginTop: 24 }}>
      {[
        { label: 'TURNIRI', desc: 'Lista s plakatima' },
        { label: 'DETALJI · EKIPE · ŽDRIJEB · RASPORED · STATISTIKA', desc: '5 tab-ova detaljnog prikaza' },
        { label: 'KREIRAJ · KARTA · UŽIVO', desc: 'Globalne stranice' },
      ].map(d => (
        <div key={d.label} style={{
          background: T.surfaceTint, border: `1px solid ${T.border}`,
          borderRadius: 10, padding: 14, borderLeft: `3px solid ${T.pitch}`,
        }}>
          <div style={{ fontFamily: F.mono, fontSize: 9, fontWeight: 800, color: T.pitch, letterSpacing: '0.1em', lineHeight: 1.3 }}>{d.label}</div>
          <div style={{ fontSize: 12, color: T.inkSoft, marginTop: 4 }}>{d.desc}</div>
        </div>
      ))}
    </div>
  </div>
);

const App = () => (
  <DesignCanvas title="Futsal Turniri — Pitch theme">
    <DCSection id="intro" title="Brief">
      <DCArtboard id="intro" label="Direction C — extended across the app" width={780} height={420} background="#f3f6f1">
        <div style={{ display: 'grid', placeItems: 'center', height: '100%', padding: 24 }}>
          <Intro />
        </div>
      </DCArtboard>
    </DCSection>

    <DCSection id="global" title="Glavne stranice">
      <DCArtboard id="page-list" label="Turniri (lista)" width={1280} height={2100} background="#f3f6f1">
        <PageList/>
      </DCArtboard>
      <DCArtboard id="page-live" label="Uživo — više utakmica istovremeno" width={1280} height={2000} background="#f3f6f1">
        <PageLive/>
      </DCArtboard>
      <DCArtboard id="page-map" label="Karta" width={1280} height={1100} background="#f3f6f1">
        <PageMap/>
      </DCArtboard>
      <DCArtboard id="page-create" label="Kreiraj turnir" width={1280} height={2400} background="#f3f6f1">
        <PageCreate/>
      </DCArtboard>
    </DCSection>

    <DCSection id="detail" title="Turnir — tab-ovi">
      <DCArtboard id="tab-detalji" label="Detalji" width={1280} height={1300} background="#f3f6f1">
        <PageDetail/>
      </DCArtboard>
      <DCArtboard id="tab-ekipe" label="Ekipe" width={1280} height={1300} background="#f3f6f1">
        <PageTeams/>
      </DCArtboard>
      <DCArtboard id="tab-zdrijeb" label="Ždrijeb" width={1380} height={1100} background="#f3f6f1">
        <PageBracket/>
      </DCArtboard>
      <DCArtboard id="tab-raspored" label="Raspored" width={1280} height={1700} background="#f3f6f1">
        <PageSchedule/>
      </DCArtboard>
      <DCArtboard id="tab-statistika" label="Statistika" width={1280} height={1200} background="#f3f6f1">
        <PageStats/>
      </DCArtboard>
      <DCArtboard id="tab-statistika-empty" label="Statistika (prazno)" width={1280} height={900} background="#f3f6f1">
        <PageStatsEmpty/>
      </DCArtboard>
    </DCSection>
  </DesignCanvas>
);

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
