import { useMemo, useRef } from 'react';
import { payoffCurve, TEMPLATES, templateLegs, type Template, type TemplateId } from '@core/index';
import { PayoffGlyph } from './PayoffChart';

const OUTLOOK: Record<Template['outlook'], { label: string; tone: string }> = {
  bullish: { label: '看漲', tone: 'ok' },
  bearish: { label: '看跌', tone: 'bad' },
  neutral: { label: '盤整', tone: 'info' },
  volatile: { label: '大波動', tone: 'warn' },
  hedge: { label: '避險', tone: 'info' },
};

/** Shape of each template on a fixed reference market, so cards compare at a glance. */
function useGlyphs() {
  return useMemo(() => {
    const out = {} as Record<TemplateId, number[]>;
    for (const t of TEMPLATES) {
      const legs = templateLegs(t.id, 100, 5, 0.25, 30 / 365);
      out[t.id] = payoffCurve(legs, { multiplier: 1 }, 70, 130, 60).map((p) => p.expiry);
    }
    return out;
  }, []);
}

/**
 * A horizontally scrolling row of strategy cards. Native scrolling and Tab
 * order do the work; the arrow buttons scroll by one card for pointer users.
 */
export function TemplateCarousel(props: {
  selected?: TemplateId;
  onPick: (id: TemplateId) => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const glyphs = useGlyphs();
  const scroll = (dir: 1 | -1) => {
    const el = track.current;
    if (!el) return;
    const card = el.querySelector<HTMLElement>('.opt-template');
    el.scrollBy({ left: dir * ((card?.offsetWidth ?? 240) + 12), behavior: 'smooth' });
  };
  return (
    <section className="opt-carousel" aria-roledescription="輪播" aria-label="策略範本">
      <div className="opt-carousel-head">
        <p className="muted">
          挑一個起點，系統會依目前的標的價格與波動率以模型計算各腿權利金，之後可逐腿修改。
        </p>
        <div className="opt-carousel-nav">
          <button
            type="button"
            className="icon-btn"
            aria-label="上一組範本"
            onClick={() => scroll(-1)}
          >
            ←
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label="下一組範本"
            onClick={() => scroll(1)}
          >
            →
          </button>
        </div>
      </div>
      <div className="opt-carousel-track" ref={track}>
        {TEMPLATES.map((t, i) => {
          const o = OUTLOOK[t.outlook];
          const active = props.selected === t.id;
          return (
            <button
              type="button"
              key={t.id}
              className={`opt-template ${active ? 'active' : ''}`}
              aria-pressed={active}
              aria-roledescription="投影片"
              aria-label={`${i + 1} / ${TEMPLATES.length}：${t.name}，${o.label}。${t.view}`}
              onClick={() => props.onPick(t.id)}
            >
              <span className="opt-template-top">
                <span className={`badge ${o.tone}`}>{o.label}</span>
                {active && <span className="opt-template-check">已套用</span>}
              </span>
              <PayoffGlyph values={glyphs[t.id]} />
              <strong>{t.name}</strong>
              <span className="opt-template-view">{t.view}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
