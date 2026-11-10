import { AtSign, MapPin, MessageCircle, Navigation } from 'lucide-react';
import { openStatus, tzOf, useShop } from '../state/shop';
import { formatPhone, money, waLink } from '../lib/format';
import { durationLabel, shortTime, todayKey, weekdayOf, WEEK_ORDER, WEEKDAYS_LONG } from '../lib/time';
import { Avatar, Loading, Stars, Wordmark, scriptName } from '../ui/kit';

export function ShopPage() {
  const { shop, hours, services, barbers, ratings, loading } = useShop();
  if (loading || !shop) return <Loading />;
  const tz = tzOf(shop);
  const todayWd = weekdayOf(todayKey(tz));
  const status = openStatus(hours, tz);
  const activeServices = services.filter((s) => s.active);
  const team = barbers.filter((b) => b.active);
  const contacts = [
    shop.whatsapp && { href: waLink(shop.whatsapp), icon: <MessageCircle size={20} />, label: 'WhatsApp' },
    shop.instagram && { href: `https://instagram.com/${shop.instagram}`, icon: <AtSign size={20} />, label: 'Instagram' },
    shop.maps_url && { href: shop.maps_url, icon: <Navigation size={20} />, label: 'Como chegar' },
  ].filter(Boolean) as { href: string; icon: JSX.Element; label: string }[];

  return (
    <div className="stack lg">
      <div className="card card-pad stack" style={{ alignItems: 'center', textAlign: 'center', padding: '28px 16px' }}>
        <Wordmark size="lg" center name={scriptName(shop.name)} tagline={shop.tagline} />
        {status && (
          <p className="status-line">
            <span className={`dot ${status.open ? 'open' : 'closed'}`} />
            {status.text}
          </p>
        )}
        {shop.address && (
          <p className="row small text-2" style={{ justifyContent: 'center', gap: 6 }}>
            <MapPin size={15} /> {shop.address}
          </p>
        )}
        {shop.whatsapp && <p className="small muted">{formatPhone(shop.whatsapp)}</p>}
      </div>

      {contacts.length > 0 && (
        <div className="contact-grid" style={{ gridTemplateColumns: `repeat(${contacts.length}, 1fr)` }}>
          {contacts.map((c) => (
            <a key={c.label} className="btn outline" href={c.href} target="_blank" rel="noreferrer">
              {c.icon}
              {c.label}
            </a>
          ))}
        </div>
      )}

      {hours.some((h) => h.is_open) && (
        <section className="stack">
          <p className="section-title">Horário de funcionamento</p>
          <div className="card card-pad" style={{ paddingTop: 6, paddingBottom: 6 }}>
            <table className="hours-table">
              <tbody>
                {WEEK_ORDER.map((wd) => {
                  const h = hours.find((x) => x.weekday === wd);
                  return (
                    <tr key={wd} className={wd === todayWd ? 'today' : ''}>
                      <td>{WEEKDAYS_LONG[wd]}</td>
                      <td>
                        {h?.is_open
                          ? `${shortTime(h.opens)} – ${shortTime(h.closes)}${h.break_start ? ` · intervalo ${shortTime(h.break_start)}–${shortTime(h.break_end)}` : ''}`
                          : 'Fechado'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {activeServices.length > 0 && (
        <section className="stack">
          <p className="section-title">Serviços</p>
          <div className="card">
            {activeServices.map((s) => (
              <div key={s.id} className="list-item">
                <div className="grow">
                  <div style={{ fontWeight: 600 }}>{s.name}</div>
                  <div className="small muted">
                    {durationLabel(s.duration_minutes)}
                    {s.description ? ` · ${s.description}` : ''}
                  </div>
                </div>
                <strong>{money(s.price_cents)}</strong>
              </div>
            ))}
          </div>
        </section>
      )}

      {team.length > 0 && (
        <section className="stack">
          <p className="section-title">Equipe</p>
          <div className="card">
            {team.map((b) => {
              const r = ratings[b.id];
              return (
                <div key={b.id} className="list-item">
                  <Avatar name={b.name} photo={b.photo} size={44} />
                  <div className="grow">
                    <div style={{ fontWeight: 600 }}>{b.name}</div>
                    {b.bio && <div className="small muted">{b.bio}</div>}
                  </div>
                  {r && (
                    <span className="row small muted" style={{ gap: 6 }}>
                      <Stars value={r.average} size={13} />
                      {r.average.toFixed(1).replace('.', ',')}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
