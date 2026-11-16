import { Card } from '../../components/ui';
import { setPnlScheme, toggleTheme, usePnlScheme, useTheme, type PnlScheme } from '../../theme';

const SCHEMES: Array<{ id: PnlScheme; label: string; hint: string }> = [
  { id: 'green-up', label: '綠正紅負', hint: '獲利為綠、虧損為紅（歐美慣例）' },
  { id: 'red-up', label: '紅漲綠跌', hint: '獲利為紅、虧損為綠（台股慣例）' },
];

/** Display preferences. Kept in this browser only; they are not portfolio data. */
export default function DisplayTab() {
  const scheme = usePnlScheme();
  const theme = useTheme();
  return (
    <Card title="顯示偏好">
      <p className="muted">這些偏好只存在這個瀏覽器，不屬於投資資料，也不會隨備份匯出。</p>
      <fieldset className="choice-group">
        <legend>損益顏色</legend>
        {SCHEMES.map((s) => (
          <label key={s.id} className={`choice ${scheme === s.id ? 'active' : ''}`}>
            <input
              type="radio"
              name="pnl-scheme"
              checked={scheme === s.id}
              onChange={() => setPnlScheme(s.id)}
            />
            <span>
              <strong>{s.label}</strong>
              <span className="field-hint">{s.hint}</span>
            </span>
            <span className="choice-sample" data-scheme={s.id} aria-hidden="true">
              <b>+1,250</b>
              <i>−830</i>
            </span>
          </label>
        ))}
      </fieldset>
      <fieldset className="choice-group">
        <legend>外觀</legend>
        {(['light', 'dark'] as const).map((t) => (
          <label key={t} className={`choice ${theme === t ? 'active' : ''}`}>
            <input
              type="radio"
              name="theme"
              checked={theme === t}
              onChange={() => theme !== t && toggleTheme()}
            />
            <span>
              <strong>{t === 'light' ? '淺色' : '深色'}</strong>
            </span>
          </label>
        ))}
      </fieldset>
    </Card>
  );
}
