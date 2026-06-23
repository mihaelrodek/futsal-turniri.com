// page-create.jsx — Kreiraj turnir form

const FormField = ({ label, required, children, hint, half }) => (
  <div style={{ flex: half ? 1 : undefined, display: 'flex', flexDirection: 'column', gap: 6 }}>
    <label style={{ fontSize: 13, fontWeight: 600, color: T.ink, display: 'flex', alignItems: 'center', gap: 4 }}>
      {label}
      {required && <span style={{ color: T.red }}>*</span>}
    </label>
    {children}
    {hint && <div style={{ fontSize: 11, color: T.inkMute }}>{hint}</div>}
  </div>
);

const Input = ({ placeholder, value, type = 'text', icon }) => (
  <div style={{
    display: 'flex', alignItems: 'center', gap: 8,
    background: '#fff', border: `1px solid ${T.border}`, borderRadius: 10,
    padding: '0 14px', height: 44,
  }}>
    {icon && <span style={{ color: T.inkMute }}>{icon}</span>}
    <input defaultValue={value} placeholder={placeholder} type={type} style={{
      flex: 1, border: 'none', background: 'transparent', outline: 'none',
      fontSize: 14, color: T.ink, fontFamily: F.sans,
    }}/>
  </div>
);

const Textarea = ({ placeholder, value, rows = 3 }) => (
  <textarea defaultValue={value} placeholder={placeholder} rows={rows} style={{
    width: '100%', background: '#fff', border: `1px solid ${T.border}`, borderRadius: 10,
    padding: '12px 14px', fontSize: 14, color: T.ink, fontFamily: F.sans,
    outline: 'none', resize: 'vertical',
  }}/>
);

const Radio = ({ label, sub, checked, accent }) => (
  <label style={{
    display: 'flex', alignItems: 'flex-start', gap: 10,
    padding: '14px 16px', borderRadius: 12,
    background: checked ? T.surfaceTint : '#fff',
    border: `1.5px solid ${checked ? T.pitch : T.border}`,
    cursor: 'pointer',
  }}>
    <span style={{
      width: 18, height: 18, borderRadius: 99,
      background: '#fff', border: `2px solid ${checked ? T.pitch : T.borderStrong}`,
      display: 'grid', placeItems: 'center', flexShrink: 0, marginTop: 1,
    }}>
      {checked && <span style={{ width: 8, height: 8, borderRadius: 99, background: T.pitch }}/>}
    </span>
    <div>
      <div style={{ fontSize: 14, fontWeight: 600, color: T.ink }}>{label}</div>
      {sub && <div style={{ fontSize: 12, color: T.inkMute, marginTop: 2 }}>{sub}</div>}
    </div>
  </label>
);

const FormSection = ({ icon, title, subtitle, children }) => (
  <div style={{ background: '#fff', border: `1px solid ${T.border}`, borderRadius: 16, overflow: 'hidden' }}>
    <div style={{ padding: '20px 28px', borderBottom: `1px solid ${T.border}`, display: 'flex', alignItems: 'center', gap: 14 }}>
      <div style={{
        width: 42, height: 42, borderRadius: 12,
        background: T.surfaceTint, color: T.pitch,
        display: 'grid', placeItems: 'center',
      }}>{icon}</div>
      <div>
        <div style={{ fontSize: 17, fontWeight: 700, color: T.ink, letterSpacing: '-0.01em' }}>{title}</div>
        <div style={{ fontSize: 13, color: T.inkMute, marginTop: 2 }}>{subtitle}</div>
      </div>
    </div>
    <div style={{ padding: 28 }}>{children}</div>
  </div>
);

const PageCreate = () => (
  <PageShell active="Kreiraj turnir">
    <BackLink to="Natrag"/>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 24 }}>
      <div>
        <div style={{ fontFamily: F.mono, fontSize: 11, color: T.pitch, letterSpacing: '0.2em', fontWeight: 700 }}>NOVI TURNIR · 3 KORAKA</div>
        <h1 style={{ fontSize: 34, fontWeight: 800, margin: '6px 0 0', letterSpacing: '-0.025em' }}>Kreiraj turnir</h1>
        <p style={{ fontSize: 14, color: T.inkMute, margin: '4px 0 0' }}>Postavi osnovne informacije, format natjecanja i nagradni fond.</p>
      </div>
      {/* Step indicator */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {['Osnovno', 'Format', 'Pregled'].map((s, i) => (
          <React.Fragment key={s}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '8px 14px', borderRadius: 99,
              background: i === 0 ? T.pitch : '#fff',
              color: i === 0 ? '#fff' : T.inkMute,
              border: i === 0 ? 'none' : `1px solid ${T.border}`,
              fontSize: 12, fontWeight: 700,
            }}>
              <span style={{
                width: 18, height: 18, borderRadius: 99,
                background: i === 0 ? 'rgba(255,255,255,0.2)' : T.surfaceTint,
                display: 'grid', placeItems: 'center',
                fontFamily: F.mono, fontSize: 10,
              }}>{i + 1}</span>
              {s}
            </div>
            {i < 2 && <span style={{ color: T.borderStrong }}>→</span>}
          </React.Fragment>
        ))}
      </div>
    </div>

    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Basic info */}
      <FormSection icon={<IconInfo size={18}/>} title="Osnovne informacije" subtitle="Ime, datum, lokacija turnira.">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <FormField label="Ime turnira" required>
            <Input placeholder="npr. Futsal Open Zagreb 2026"/>
          </FormField>
          <FormField label="Datum i vrijeme" required>
            <Input value="25/05/2026 10:11" icon={<IconCalendar size={14}/>}/>
          </FormField>
          <FormField label="Maks. ekipa">
            <Input value="16" type="number"/>
          </FormField>
          <FormField label="Kotizacija">
            <Input value="100" icon={<IconEuro size={14}/>}/>
          </FormField>
        </div>

        {/* Location with map */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 16 }}>
          <FormField label="Lokacija" required hint="Unesi adresu ili klikni na kartu za odabir.">
            <Input placeholder="Unesi lokaciju ili odaberi na karti" icon={<IconPin size={14}/>}/>
            <Textarea placeholder="Dodatne informacije — pravila, parking, hrana, piće…" rows={4}/>
          </FormField>
          <FormField label="Pregled karte">
            <div style={{
              position: 'relative', borderRadius: 10, overflow: 'hidden',
              border: `1px solid ${T.border}`, height: 240, background: '#e8eee5',
            }}>
              <svg viewBox="0 0 400 240" style={{ width: '100%', height: '100%' }}>
                <path d="M 0 100 Q 100 80, 180 110 T 400 130" stroke="#fff" strokeWidth="6" fill="none"/>
                <path d="M 220 0 L 200 140 L 220 240" stroke="#fff" strokeWidth="4" fill="none"/>
                <path d="M 60 240 L 80 150 L 130 100" stroke="#fff" strokeWidth="3" fill="none"/>
                <rect x="40" y="140" width="100" height="60" fill={T.pitchLight} opacity="0.25" rx="6"/>
                <rect x="280" y="50" width="80" height="50" fill={T.pitchLight} opacity="0.25" rx="6"/>
                <g transform="translate(200, 120)">
                  <circle r="22" fill={T.pitch} opacity="0.15"/>
                  <path d="M 0 -16 C -8 -16 -14 -10 -14 -2 C -14 8 0 22 0 22 C 0 22 14 8 14 -2 C 14 -10 8 -16 0 -16 Z" fill={T.pitch}/>
                  <circle cy="-2" r="4" fill="#fff"/>
                </g>
              </svg>
              <div style={{ position: 'absolute', top: 10, right: 10, background: '#fff', padding: '6px 10px', borderRadius: 8, fontSize: 11, fontFamily: F.mono, color: T.inkSoft, letterSpacing: '0.05em' }}>
                <IconLocate size={11}/> KLIKNI ZA ODABIR
              </div>
            </div>
          </FormField>
        </div>
      </FormSection>

      {/* Poster upload */}
      <FormSection icon={<IconShare size={18}/>} title="Plakat turnira" subtitle="Opcionalno. Korisnici vide plakat na popisu turnira.">
        <div style={{
          display: 'grid', gridTemplateColumns: '220px 1fr', gap: 20, alignItems: 'center',
        }}>
          <div style={{
            position: 'relative', height: 280, borderRadius: 12,
            border: `2px dashed ${T.borderStrong}`, background: T.surfaceTint2,
            display: 'grid', placeItems: 'center', overflow: 'hidden',
          }}>
            <div style={{ position: 'absolute', inset: 0, opacity: 0.04 }}><PitchBackdrop opacity={1}/></div>
            <div style={{ position: 'relative', textAlign: 'center', color: T.inkMute }}>
              <div style={{
                width: 48, height: 48, borderRadius: 12, background: '#fff',
                display: 'grid', placeItems: 'center', margin: '0 auto 8px',
                color: T.pitch, border: `1px solid ${T.border}`,
              }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
              </div>
              <div style={{ fontSize: 13, fontWeight: 700, color: T.ink }}>Povuci sliku ovdje</div>
              <div style={{ fontSize: 11 }}>ili klikni za odabir</div>
            </div>
          </div>
          <div>
            <div style={{ display: 'flex', gap: 10 }}>
              <PrimaryButton>Odaberi sliku</PrimaryButton>
              <GhostButton>Generiraj plakat</GhostButton>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 16 }}>
              {[
                { l: 'Format', v: 'PNG, JPG, WEBP' },
                { l: 'Veličina', v: 'do 5 MB' },
                { l: 'Preporuka', v: '1080 × 1350 px' },
                { l: 'Omjer', v: '4:5 (portretni)' },
              ].map(t => (
                <div key={t.l} style={{ padding: '8px 12px', background: T.surfaceTint2, borderRadius: 8, fontSize: 12 }}>
                  <div style={{ fontFamily: F.mono, fontSize: 10, color: T.inkMute, letterSpacing: '0.1em', fontWeight: 700 }}>{t.l.toUpperCase()}</div>
                  <div style={{ color: T.ink, fontWeight: 600, marginTop: 2 }}>{t.v}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </FormSection>

      {/* Format */}
      <FormSection icon={<IconBracket size={18}/>} title="Format natjecanja" subtitle="Odaberi kako je turnir strukturiran.">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
          <Radio label="Grupe + eliminacija" sub="Najbolje ekipe iz grupa idu u play-off." checked/>
          <Radio label="Samo eliminacija" sub="Knock-out od prvog kola do finala."/>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
          <FormField label="Broj grupa">
            <Input value="4" type="number"/>
          </FormField>
          <FormField label="Ekipa prolazi iz grupe">
            <Input value="2" type="number" hint="Prijedlog za 16 ekipa: 2"/>
          </FormField>
        </div>

        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: T.ink, marginBottom: 10 }}>Popunjavanje eliminacijske ljestvice</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Radio label="Slobodan prolaz" sub="Najbolje ekipe preskaču prvo kolo kad broj ekipa nije potpun." checked/>
            <Radio label="Najbolji trećeplasirani" sub="Dodatne ekipe popunjavaju ljestvicu na temelju rezultata grupne faze."/>
          </div>
        </div>
      </FormSection>

      {/* Prizes */}
      <FormSection icon={<IconGift size={18}/>} title="Nagradni fond" subtitle="Opcionalno. Postavi nagrade za prva 3 mjesta.">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
          {[1, 2, 3].map(p => (
            <FormField key={p} label={`${p}. mjesto`}>
              <Input value={p === 1 ? '2000' : p === 2 ? '500' : '250'} icon={<IconTrophy size={14}/>}/>
            </FormField>
          ))}
        </div>
      </FormSection>
    </div>

    {/* Sticky action bar */}
    <div style={{
      position: 'sticky', bottom: 0, marginTop: 28,
      background: 'rgba(255,255,255,0.95)', backdropFilter: 'blur(10px)',
      border: `1px solid ${T.border}`, borderRadius: 16, padding: '14px 20px',
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      boxShadow: '0 -4px 20px rgba(14,31,21,0.04)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{
          width: 10, height: 10, borderRadius: 99, background: T.pitchLight,
          boxShadow: `0 0 8px ${T.pitchLight}`,
        }}/>
        <span style={{ fontSize: 13, color: T.inkSoft }}>Sve obavezno popunjeno · spremno za kreiranje</span>
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <GhostButton>Odustani</GhostButton>
        <GhostButton>Spremi kao nacrt</GhostButton>
        <PrimaryButton icon={<IconPlus size={14}/>}>Kreiraj turnir</PrimaryButton>
      </div>
    </div>
  </PageShell>
);

window.PageCreate = PageCreate;
