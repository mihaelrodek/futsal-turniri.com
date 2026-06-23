// page-detail.jsx — Tournament detail (Detalji tab)

const DETAIL_TABS = ['Detalji', 'Ekipe', 'Ždrijeb', 'Raspored', 'Statistika'];

const DetailHeader = ({ t }) => (
  <>
    <BackLink/>
    <PageTitle title={t.name} status="active" statusLabel="U tijeku"/>
  </>
);

const InfoStat = ({ icon, label, value, accent }) => (
  <div style={{
    background: '#fff', border: `1px solid ${T.border}`, borderRadius: 12,
    padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 4,
    minHeight: 84, position: 'relative', overflow: 'hidden',
  }}>
    {accent && <div style={{ position: 'absolute', top: 0, left: 0, width: 3, height: '100%', background: accent }}/>}
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: T.inkMute, fontSize: 11, fontWeight: 600, fontFamily: F.mono, letterSpacing: '0.1em' }}>
      {icon} {label}
    </div>
    <div style={{ fontSize: 22, fontWeight: 700, color: T.ink, letterSpacing: '-0.02em' }}>{value}</div>
  </div>
);

const PrizeRow = ({ place, amount, medal }) => {
  const colors = ['#f5c842', '#c0c5cc', '#cd8654'];
  const color = colors[place - 1];
  return (
    <div style={{
      flex: 1, background: T.surfaceTint2, border: `1px solid ${T.border}`,
      borderRadius: 12, padding: '14px 16px',
      display: 'flex', alignItems: 'center', gap: 12,
    }}>
      <div style={{
        width: 36, height: 36, borderRadius: 99,
        background: `linear-gradient(145deg, ${color}, ${color}cc)`,
        display: 'grid', placeItems: 'center', color: '#fff',
      }}>
        <IconTrophy size={18}/>
      </div>
      <div>
        <div style={{ fontFamily: F.mono, fontSize: 10, color: T.inkMute, letterSpacing: '0.1em', fontWeight: 700 }}>{place}. MJESTO</div>
        <div style={{ fontSize: 20, fontWeight: 800, color: T.ink, letterSpacing: '-0.02em' }}>{amount}€</div>
      </div>
    </div>
  );
};

const DetailTabContent = ({ t }) => (
  <div style={{ display: 'grid', gridTemplateColumns: '380px 1fr', gap: 24 }}>
    {/* Left — poster */}
    <div>
      <div style={{
        borderRadius: 16, overflow: 'hidden', border: `1px solid ${T.border}`,
        background: '#fff',
      }}>
        <TournamentPoster t={t} height={500} big/>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <GhostButton icon={<IconShare size={14}/>} full>Podijeli</GhostButton>
        <GhostButton icon={<IconEdit size={14}/>} full>Uredi</GhostButton>
      </div>
    </div>

    {/* Right — info */}
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Quick stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        <InfoStat icon={<IconCalendar size={12}/>} label="DATUM" value="22. svi" accent={T.pitchLight}/>
        <InfoStat icon={<IconClock size={12}/>} label="VRIJEME" value={t.time} accent={T.pitch}/>
        <InfoStat icon={<IconUsers size={12}/>} label="EKIPE" value={`${t.teams} / ${t.max}`} accent={T.amber}/>
        <InfoStat icon={<IconEuro size={12}/>} label="KOTIZACIJA" value={`${t.fee}€`} accent={T.goal}/>
      </div>

      {/* Organizer */}
      <div style={{
        background: '#fff', border: `1px solid ${T.border}`, borderRadius: 12,
        padding: '14px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 38, height: 38, borderRadius: 99, background: `linear-gradient(135deg, ${T.pitchLight}, ${T.pitch})`, color: '#fff', display: 'grid', placeItems: 'center', fontSize: 13, fontWeight: 700 }}>MR</div>
          <div>
            <div style={{ fontFamily: F.mono, fontSize: 10, color: T.inkMute, letterSpacing: '0.1em', fontWeight: 600 }}>ORGANIZATOR</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: T.ink }}>Mihael Rodek</div>
          </div>
        </div>
        <a style={{ fontSize: 13, color: T.pitch, fontWeight: 600, cursor: 'pointer' }}>Pošalji poruku →</a>
      </div>

      {/* Location */}
      <SectionCard
        icon={<IconPin size={16}/>}
        title="Lokacija"
        subtitle="Žarovnica, Grad Lepoglava, Varaždinska županija"
        action={<button style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          background: T.surfaceTint, color: T.pitch, border: 'none',
          padding: '8px 14px', borderRadius: 99,
          fontSize: 13, fontWeight: 600, cursor: 'pointer',
        }}><IconExternal/> Otvori u kartama</button>}
      >
        <div style={{ position: 'relative', height: 200, borderRadius: 10, overflow: 'hidden', border: `1px solid ${T.border}` }}>
          {/* Stylized map preview */}
          <svg viewBox="0 0 400 200" style={{ width: '100%', height: '100%', display: 'block', background: '#e8eee5' }}>
            {/* roads */}
            <path d="M 0 80 Q 100 60, 180 90 T 400 110" stroke="#fff" strokeWidth="6" fill="none"/>
            <path d="M 0 80 Q 100 60, 180 90 T 400 110" stroke={T.pitchLight} strokeWidth="2" strokeDasharray="6 4" fill="none" opacity="0.4"/>
            <path d="M 220 0 L 200 120 L 220 200" stroke="#fff" strokeWidth="4" fill="none"/>
            <path d="M 60 200 L 80 130 L 130 80" stroke="#fff" strokeWidth="3" fill="none"/>
            {/* park / green area */}
            <rect x="40" y="120" width="100" height="60" fill={T.pitchLight} opacity="0.25" rx="6"/>
            <rect x="280" y="40" width="80" height="50" fill={T.pitchLight} opacity="0.25" rx="6"/>
            {/* pin */}
            <g transform="translate(200, 100)">
              <circle r="22" fill={T.pitch} opacity="0.15"/>
              <circle r="14" fill={T.pitch} opacity="0.25"/>
              <path d="M 0 -16 C -8 -16 -14 -10 -14 -2 C -14 8 0 22 0 22 C 0 22 14 8 14 -2 C 14 -10 8 -16 0 -16 Z" fill={T.pitch}/>
              <circle cy="-2" r="4" fill="#fff"/>
            </g>
            <text x="200" y="160" textAnchor="middle" fontSize="11" fill={T.inkSoft} fontWeight="700" fontFamily={F.mono} letterSpacing="0.1em">ŽAROVNICA · 42250</text>
          </svg>
        </div>
      </SectionCard>

      {/* Details */}
      <SectionCard icon={<IconInfo size={16}/>} title="Detalji turnira" subtitle="Pravila, format, dodatne informacije">
        <p style={{ fontSize: 14, color: T.inkSoft, margin: 0, lineHeight: 1.6 }}>
          Tradicionalni karnevalski turnir parova. Igra se po sustavu eliminacije s mogućnošću jednog "života" do polufinala — preživi prvi gubitak i nastavi do trofeja. Pravila prema FIFA Futsal Laws of the Game, 2 × 10 min poluvremena. Sve ekipe dobivaju majice za sudionike.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginTop: 16 }}>
          {[
            { label: 'FORMAT', val: 'Eliminacija' },
            { label: 'POLUVREMENA', val: '2 × 10 min' },
            { label: 'PRAVILA', val: 'FIFA Futsal LotG' },
          ].map(d => (
            <div key={d.label} style={{ padding: '10px 14px', background: T.surfaceTint2, borderRadius: 10 }}>
              <div style={{ fontFamily: F.mono, fontSize: 10, color: T.inkMute, letterSpacing: '0.1em', fontWeight: 700 }}>{d.label}</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: T.ink, marginTop: 2 }}>{d.val}</div>
            </div>
          ))}
        </div>
      </SectionCard>

      {/* Prizes */}
      <SectionCard
        icon={<IconGift size={16}/>}
        title="Nagradni fond"
        subtitle="Fiksne nagrade po plasmanu"
        action={<span style={{
          background: T.surfaceTint, color: T.pitch, padding: '4px 10px',
          borderRadius: 99, fontSize: 11, fontWeight: 700,
        }}>UKUPNO 2.466€</span>}
      >
        <div style={{ display: 'flex', gap: 12 }}>
          <PrizeRow place={1} amount="2222"/>
          <PrizeRow place={2} amount="222"/>
          <PrizeRow place={3} amount="22"/>
        </div>
      </SectionCard>

      {/* Contact */}
      <SectionCard icon={<IconUser size={16}/>} title="Kontakt" subtitle="Za pitanja i prijave" padding="0">
        <div style={{ padding: '16px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: T.ink }}>Mihael Rodek</div>
            <div style={{ fontSize: 13, color: T.inkMute, marginTop: 2 }}>+385 91 234 5678 · mihael@futsalturniri.hr</div>
          </div>
          <PrimaryButton>Prijavi ekipu</PrimaryButton>
        </div>
      </SectionCard>
    </div>
  </div>
);

const PageDetail = () => {
  const t = TOURNAMENTS[0]; // Zarovnica open (has poster)
  return (
    <PageShell active="Turniri">
      <DetailHeader t={t}/>
      <TabBar tabs={DETAIL_TABS} active="Detalji"/>
      <DetailTabContent t={t}/>
    </PageShell>
  );
};

window.PageDetail = PageDetail;
window.DETAIL_TABS = DETAIL_TABS;
window.DetailHeader = DetailHeader;
