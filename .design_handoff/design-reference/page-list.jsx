// page-list.jsx — Tournaments listing page (the redesigned version C)
// Big scoreboard hero from variant A + poster-based cards + no stats row

const ListHero = () => {
  // Hero with live scoreboard front and center (A's style, in C's palette)
  return (
    <section style={{ marginBottom: 28 }}>
      <div style={{
        position: 'relative', borderRadius: 20, overflow: 'hidden',
        background: `linear-gradient(135deg, ${T.pitch}, ${T.pitchDeep})`,
        color: '#fff',
      }}>
        {/* Pitch backdrop */}
        <div style={{ position: 'absolute', inset: 0, opacity: 0.15 }}><PitchBackdrop opacity={1}/></div>
        {/* Vertical stripes */}
        <div style={{ position: 'absolute', inset: 0, background: 'repeating-linear-gradient(90deg, transparent 0, transparent 70px, rgba(0,0,0,0.05) 70px, rgba(0,0,0,0.05) 140px)' }}/>

        {/* Top — live label bar */}
        <div style={{
          position: 'relative', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '14px 28px', borderBottom: '1px solid rgba(255,255,255,0.12)',
          background: 'rgba(220, 38, 38, 0.18)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ width: 8, height: 8, borderRadius: 99, background: '#fff', boxShadow: '0 0 10px #fff', animation: 'pulse 1.6s infinite' }}/>
            <span style={{ fontFamily: F.mono, fontSize: 11, fontWeight: 700, letterSpacing: '0.15em' }}>UŽIVO · MATCHDAY</span>
          </div>
          <span style={{ fontFamily: F.mono, fontSize: 10, color: 'rgba(255,255,255,0.65)', letterSpacing: '0.1em' }}>
            FUTSAL KUP ZAGREB 2026 · ČETVRTFINALE
          </span>
        </div>

        {/* Center — big scoreboard */}
        <div style={{
          position: 'relative', display: 'grid', gridTemplateColumns: '1fr auto 1fr',
          alignItems: 'center', gap: 24, padding: '32px 36px',
        }}>
          {/* Home */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 18, justifyContent: 'flex-end' }}>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontFamily: F.mono, fontSize: 10, color: 'rgba(255,255,255,0.6)', letterSpacing: '0.12em' }}>DOMAĆIN</div>
              <div style={{ fontFamily: F.display, fontSize: 28, fontWeight: 700, color: '#fff', letterSpacing: '-0.02em', lineHeight: 1.1, marginTop: 2 }}>NK Bregana</div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', marginTop: 4 }}>3 strijelca · 8 šuteva</div>
            </div>
            <div style={{
              width: 64, height: 64, borderRadius: 14,
              background: 'linear-gradient(145deg, #ff5c4e, #c93026)',
              display: 'grid', placeItems: 'center',
              fontFamily: F.display, fontSize: 24, fontWeight: 800, color: '#fff',
              boxShadow: '0 8px 24px rgba(201,48,38,0.45)',
            }}>NB</div>
          </div>

          {/* Score */}
          <div style={{ textAlign: 'center', padding: '0 8px' }}>
            <div style={{
              fontFamily: F.mono, fontSize: 11, color: T.goal, letterSpacing: '0.18em', fontWeight: 700,
              display: 'inline-flex', alignItems: 'center', gap: 6,
            }}>
              <IconClock size={12}/> 21:47 · 1. POLUVRIJEME
            </div>
            <div style={{
              fontFamily: F.mono, fontSize: 78, fontWeight: 800, color: '#fff',
              letterSpacing: '-0.05em', lineHeight: 1, marginTop: 6,
            }}>
              2<span style={{ color: 'rgba(255,255,255,0.35)', padding: '0 16px' }}>:</span>1
            </div>
            <div style={{ fontFamily: F.mono, fontSize: 10, color: 'rgba(255,255,255,0.5)', letterSpacing: '0.15em', marginTop: 6 }}>
              SUTKINJA · A. NOVAK · DVORANA TRESNJEVKA
            </div>
          </div>

          {/* Away */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
            <div style={{
              width: 64, height: 64, borderRadius: 14,
              background: 'linear-gradient(145deg, #4d80ff, #1a4dcc)',
              display: 'grid', placeItems: 'center',
              fontFamily: F.display, fontSize: 24, fontWeight: 800, color: '#fff',
              boxShadow: '0 8px 24px rgba(26,77,204,0.45)',
            }}>SG</div>
            <div>
              <div style={{ fontFamily: F.mono, fontSize: 10, color: 'rgba(255,255,255,0.6)', letterSpacing: '0.12em' }}>GOST</div>
              <div style={{ fontFamily: F.display, fontSize: 28, fontWeight: 700, color: '#fff', letterSpacing: '-0.02em', lineHeight: 1.1, marginTop: 2 }}>NK Stari grad</div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', marginTop: 4 }}>1 strijelac · 5 šuteva</div>
            </div>
          </div>
        </div>

        {/* Bottom — scorer ticker + CTAs */}
        <div style={{
          position: 'relative', display: 'grid', gridTemplateColumns: '1fr 1fr auto',
          borderTop: '1px solid rgba(255,255,255,0.12)',
          background: 'rgba(0,0,0,0.3)',
        }}>
          <div style={{ padding: '14px 28px', borderRight: '1px solid rgba(255,255,255,0.1)', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {[{ min: "1'", name: 'Karlo Tomic' }, { min: "6'", name: 'Igor Galic' }].map(g => (
              <div key={g.name} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
                <span style={{ fontFamily: F.mono, color: T.goal, fontWeight: 700, minWidth: 22 }}>{g.min}</span>
                <BallIcon size={12} color={T.goal}/>
                <span style={{ fontWeight: 500 }}>{g.name}</span>
              </div>
            ))}
          </div>
          <div style={{ padding: '14px 28px', borderRight: '1px solid rgba(255,255,255,0.1)', display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
              <span style={{ fontWeight: 500 }}>Petar Vidovic</span>
              <BallIcon size={12} color={T.goal}/>
              <span style={{ fontFamily: F.mono, color: T.goal, fontWeight: 700, minWidth: 22, textAlign: 'right' }}>4'</span>
            </div>
          </div>
          <div style={{ padding: '14px 24px', display: 'flex', alignItems: 'center', gap: 10 }}>
            <button style={{
              padding: '10px 18px', borderRadius: 10, border: 'none',
              background: T.goal, color: T.ink, fontFamily: F.sans, fontSize: 13, fontWeight: 700,
              cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6,
            }}>
              <IconPlay size={11}/> Prati uživo
            </button>
          </div>
        </div>
      </div>

    </section>
  );
};

const ListToolbar = () => (
  <section style={{ marginBottom: 24 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{
        flex: 1, display: 'flex', alignItems: 'center', gap: 10,
        background: '#fff', border: `1px solid ${T.border}`,
        borderRadius: 12, padding: '0 16px', height: 46,
      }}>
        <IconSearch/>
        <input placeholder="Pretraži po imenu turnira, gradu ili dvorani…" style={{
          flex: 1, background: 'transparent', border: 'none', outline: 'none',
          color: T.ink, fontSize: 14, fontFamily: F.sans,
        }}/>
        <span style={{ fontFamily: F.mono, fontSize: 10, color: T.inkMute, padding: '2px 6px', background: T.surfaceTint, borderRadius: 4 }}>⌘ K</span>
      </div>
      <button style={{
        display: 'inline-flex', alignItems: 'center', gap: 8, height: 46, padding: '0 16px',
        background: '#fff', border: `1px solid ${T.border}`, borderRadius: 12,
        color: T.ink, fontSize: 13, fontWeight: 600, cursor: 'pointer',
      }}>
        <IconFilter size={14}/> Filteri
        <span style={{ background: T.pitch, color: '#fff', borderRadius: 99, padding: '2px 7px', fontSize: 10, fontWeight: 700 }}>2</span>
      </button>
      <div style={{ display: 'flex', background: '#fff', border: `1px solid ${T.border}`, borderRadius: 12, padding: 3 }}>
        {['Mreža', 'Lista', 'Karta'].map((v, i) => (
          <button key={v} style={{
            padding: '8px 14px', borderRadius: 9, border: 'none',
            background: i === 0 ? T.surfaceTint : 'transparent',
            color: i === 0 ? T.pitch : T.inkSoft,
            fontSize: 12, fontWeight: 600, cursor: 'pointer',
          }}>{v}</button>
        ))}
      </div>
    </div>
    <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
      {[
        { label: 'Svi turniri', count: 8, active: true },
        { label: 'Uživo', count: 1, dot: T.red },
        { label: 'Nadolazeći', count: 2, dot: T.pitchLight },
        { label: 'Za 6 dana', count: 1, dot: T.amber },
        { label: 'Mjesta puna', count: 4, dot: T.inkMute },
      ].map(f => (
        <button key={f.label} style={{
          display: 'inline-flex', alignItems: 'center', gap: 7, padding: '7px 14px',
          borderRadius: 99, border: 'none',
          background: f.active ? T.ink : '#fff',
          color: f.active ? '#fff' : T.inkSoft,
          fontSize: 12, fontWeight: 600, cursor: 'pointer',
          boxShadow: f.active ? 'none' : `inset 0 0 0 1px ${T.border}`,
        }}>
          {f.dot && <span style={{ width: 7, height: 7, borderRadius: 99, background: f.dot }}/>}
          {f.label}
          <span style={{ color: f.active ? 'rgba(255,255,255,0.6)' : T.inkMute, fontWeight: 700 }}>{f.count}</span>
        </button>
      ))}
    </div>
  </section>
);

const TournamentCard = ({ t }) => {
  const accent = {
    live: T.red, upcoming: T.pitchLight, soon: T.amber, full: T.inkMute,
  }[t.status];
  const fill = t.teams / t.max;
  return (
    <article style={{
      background: '#fff', borderRadius: 16, overflow: 'hidden',
      border: `1px solid ${T.border}`,
      display: 'flex', flexDirection: 'column',
    }}>
      {/* Poster area */}
      <div style={{ position: 'relative' }}>
        <TournamentPoster t={t} height={180}/>
        {/* Status overlay top right */}
        <div style={{ position: 'absolute', top: 12, right: 12 }}>
          <StatusChip status={t.status} label={t.statusLabel}/>
        </div>
        {/* Date stamp top left */}
        <div style={{
          position: 'absolute', top: 12, left: 12,
          background: 'rgba(255,255,255,0.95)', borderRadius: 10,
          padding: '8px 12px', textAlign: 'center',
          backdropFilter: 'blur(8px)', minWidth: 60,
        }}>
          <div style={{ fontFamily: F.mono, fontSize: 9, color: T.inkMute, fontWeight: 700, letterSpacing: '0.1em' }}>{t.day}</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: T.ink, lineHeight: 1, letterSpacing: '-0.03em', marginTop: 1 }}>{t.dateShort.split(' ')[0]}</div>
          <div style={{ fontFamily: F.mono, fontSize: 9, color: T.pitch, fontWeight: 700, letterSpacing: '0.1em' }}>{t.dateShort.split(' ')[1]}</div>
        </div>
        {/* Time bottom right */}
        <div style={{
          position: 'absolute', bottom: 12, right: 14,
          background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(8px)',
          padding: '6px 10px', borderRadius: 8, color: '#fff',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: F.mono, fontSize: 14, fontWeight: 700, letterSpacing: '-0.02em' }}>
            <IconClock size={12}/> {t.time}
          </div>
        </div>
      </div>
      {/* Body */}
      <div style={{ padding: '16px 18px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <h3 style={{ fontSize: 17, fontWeight: 700, margin: 0, color: T.ink, letterSpacing: '-0.01em', lineHeight: 1.2 }}>{t.name}</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 4, color: T.inkMute, fontSize: 13 }}>
            <IconPin size={12}/> {t.location}
          </div>
        </div>
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
            <span style={{ fontSize: 12, color: T.inkMute, fontWeight: 500 }}>Popunjenost</span>
            <span style={{ fontFamily: F.mono, fontSize: 12, fontWeight: 700, color: T.ink }}>{t.teams} / {t.max}</span>
          </div>
          <div style={{ height: 6, background: T.surfaceTint, borderRadius: 99, overflow: 'hidden' }}>
            <div style={{ width: `${fill * 100}%`, height: '100%', background: `linear-gradient(90deg, ${T.pitchLight}, ${accent})`, borderRadius: 99 }}/>
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 12, borderTop: `1px solid ${T.border}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: T.pitch, fontWeight: 700, fontSize: 16 }}>
            {t.fee}€ <span style={{ fontSize: 11, color: T.inkMute, fontWeight: 500 }}>kotizacija</span>
          </div>
          <button style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            background: T.surfaceTint, color: T.pitch,
            padding: '6px 12px', borderRadius: 99, border: 'none',
            fontSize: 12, fontWeight: 700, cursor: 'pointer',
          }}>
            Detalji <IconChev size={12}/>
          </button>
        </div>
      </div>
    </article>
  );
};

const PageList = () => (
  <PageShell active="Turniri">
    <ListHero/>
    <ListToolbar/>

    {/* Grid section */}
    <section style={{ marginBottom: 48 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 18 }}>
        <div>
          <h2 style={{ fontSize: 22, fontWeight: 700, margin: 0, letterSpacing: '-0.02em', color: T.ink }}>Predstojeći turniri</h2>
          <p style={{ fontSize: 13, color: T.inkMute, margin: '2px 0 0' }}>Sortirano po datumu početka · 8 rezultata</p>
        </div>
        <div style={{ fontFamily: F.mono, fontSize: 11, color: T.inkMute, letterSpacing: '0.1em' }}>
          SVI · KOL 2026
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 18 }}>
        {TOURNAMENTS.map(t => <TournamentCard key={t.id} t={t}/>)}
      </div>
    </section>

    {/* Completed */}
    <section>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 16 }}>
        <h2 style={{ fontSize: 22, fontWeight: 700, margin: 0, letterSpacing: '-0.02em' }}>Završeni turniri</h2>
        <a style={{ fontSize: 13, color: T.pitch, fontWeight: 600, cursor: 'pointer' }}>Arhiva sezona →</a>
      </div>
      <div style={{
        position: 'relative', overflow: 'hidden',
        background: '#fff', border: `1px dashed ${T.border}`, borderRadius: 16,
        padding: '48px 24px', textAlign: 'center',
      }}>
        <div style={{ position: 'absolute', inset: 0, opacity: 0.04 }}><PitchBackdrop opacity={1}/></div>
        <div style={{ position: 'relative' }}>
          <div style={{
            display: 'inline-grid', placeItems: 'center', width: 56, height: 56, borderRadius: 99,
            background: T.surfaceTint, color: T.pitch, marginBottom: 12,
          }}>
            <IconCalendar size={22}/>
          </div>
          <div style={{ fontSize: 18, fontWeight: 700, color: T.ink }}>Još nema završenih turnira</div>
          <div style={{ fontSize: 14, color: T.inkMute, marginTop: 4 }}>
            Završeni turniri će se pojaviti ovdje s konačnim rezultatima, statistikama i strijelcima.
          </div>
        </div>
      </div>
    </section>
  </PageShell>
);

window.PageList = PageList;
