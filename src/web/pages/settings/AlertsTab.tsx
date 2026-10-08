import { useState } from 'react';
import { getSettings, type Settings } from '@core/index';
import { upsertRow, useData } from '../../store';
import { Card, Field } from '../../components/ui';
import { ErrorList, numStr, parseNum } from './shared';

export default function AlertsTab() {
  const data = useData();
  const s = getSettings(data);
  const [base, setBase] = useState(s.baseCurrency);
  const [gross, setGross] = useState(numStr(s.alerts.grossLeverage));
  const [debt, setDebt] = useState(numStr(s.alerts.debtToNav));
  const [maint, setMaint] = useState(numStr(s.alerts.maintenanceRatio));
  const [stale, setStale] = useState(String(s.alerts.staleQuoteMinutes));
  const [errors, setErrors] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);

  const save = () => {
    const errs: string[] = [];
    const g = parseNum(gross), d = parseNum(debt), m = parseNum(maint), st = Number(stale);
    if (!base.trim()) errs.push('本位幣為必填');
    for (const [label, v] of [['總槓桿', g], ['負債 / NAV', d], ['維持率', m]] as const) {
      if (v !== undefined && (!Number.isFinite(v) || v <= 0)) errs.push(`${label}門檻必須大於 0，或留空表示不提醒`);
    }
    if (!Number.isFinite(st) || st <= 0 || stale.trim() === '') errs.push('報價過期分鐘數必須大於 0');
    setSaved(false);
    if (errs.length) return setErrors(errs);
    const next: Settings = {
      ...s,
      id: 'default',
      baseCurrency: base.trim().toUpperCase(),
      alerts: { staleQuoteMinutes: st, ...(g !== undefined && { grossLeverage: g }), ...(d !== undefined && { debtToNav: d }), ...(m !== undefined && { maintenanceRatio: m }) },
    };
    upsertRow('settings', next);
    setErrors([]);
    setSaved(true);
  };

  return (
    <Card title="本位幣與提醒門檻" actions={<button className="primary" onClick={save}>儲存</button>}>
      <div className="notice">
        這些門檻<strong>只會觸發提醒</strong>，不會阻擋任何交易，也不會限制槓桿上限。槓桿由你自行決定，系統只負責讓風險看得見。
      </div>
      <div className="form-grid">
        <Field label="本位幣" hint="NAV 與曝險以此幣別計算"><input value={base} onChange={(e) => setBase(e.target.value)} /></Field>
        <Field label="總槓桿提醒（×）" hint="總曝險 / NAV 超過時提醒；留空 = 不提醒"><input type="number" step="any" value={gross} onChange={(e) => setGross(e.target.value)} /></Field>
        <Field label="負債 / NAV 提醒" hint="例如 0.5 = 50%；留空 = 不提醒"><input type="number" step="any" value={debt} onChange={(e) => setDebt(e.target.value)} /></Field>
        <Field label="維持率提醒" hint="擔保品價值 / 借款餘額低於時提醒，例如 1.6；留空 = 不提醒"><input type="number" step="any" value={maint} onChange={(e) => setMaint(e.target.value)} /></Field>
        <Field label="報價過期（分鐘）" hint="超過即標示為過期報價"><input type="number" step="any" value={stale} onChange={(e) => setStale(e.target.value)} /></Field>
      </div>
      <ErrorList errors={errors} />
      {saved && <p className="pos">已儲存。</p>}
    </Card>
  );
}
