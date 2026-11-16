import { useState } from 'react';
import { Field, Modal } from '../../components/ui';
import { fmtNum } from '../../format';
import { legId, modelPremium, type ParsedMarket, type UiLeg } from './model';

/** Add or edit one leg. Premium defaults to the model price at the market inputs. */
export function LegDialog(props: {
  market: ParsedMarket;
  initial?: UiLeg;
  onSave: (leg: UiLeg) => void;
  onClose: () => void;
}) {
  const m = props.market;
  const init = props.initial;
  const [kind, setKind] = useState<UiLeg['kind']>(init?.kind ?? 'call');
  const [side, setSide] = useState<'buy' | 'sell'>(init && init.quantity < 0 ? 'sell' : 'buy');
  const [qty, setQty] = useState(String(init ? Math.abs(init.quantity) : 1));
  const [strike, setStrike] = useState(String(init?.strike || Math.round(m.spot)));
  const [days, setDays] = useState(init?.days === undefined ? '' : String(init.days));
  const [vol, setVol] = useState(
    init?.vol === undefined ? '' : String(+(init.vol * 100).toFixed(4)),
  );
  const [price, setPrice] = useState(init ? String(+init.price.toFixed(4)) : '');

  const option = kind !== 'underlying';
  const q = Number(qty);
  const k = Number(strike);
  const d = days.trim() === '' ? undefined : Number(days);
  const v = vol.trim() === '' ? undefined : Number(vol) / 100;
  const errors: string[] = [];
  if (!(q > 0)) errors.push('數量必須大於 0');
  if (option && !(k > 0)) errors.push('履約價必須大於 0');
  if (option && d !== undefined && !(Number.isInteger(d) && d >= 1))
    errors.push('到期天數需為 1 以上的整數');
  if (option && v !== undefined && !(v > 0 && v <= 5)) errors.push('波動率需介於 0 到 500%');
  const model =
    option && errors.length === 0 ? modelPremium(kind, k, m, d ?? m.days, v ?? m.vol) : undefined;
  const p = price.trim() === '' ? (option ? model : m.spot) : Number(price);
  if (!(p !== undefined && p >= 0 && Number.isFinite(p))) errors.push('價格不可為負');

  const save = () => {
    if (errors.length) return;
    props.onSave({
      id: init?.id ?? legId(),
      kind,
      quantity: side === 'buy' ? q : -q,
      strike: option ? k : 0,
      price: p!,
      days: option ? d : undefined,
      vol: option ? v : undefined,
    });
  };

  return (
    <Modal
      title={init ? '編輯部位腿' : '新增部位腿'}
      onClose={props.onClose}
      footer={
        <>
          <button onClick={props.onClose}>取消</button>
          <button className="primary" disabled={errors.length > 0} onClick={save}>
            {init ? '儲存' : '加入'}
          </button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="種類">
          <select value={kind} onChange={(e) => setKind(e.target.value as UiLeg['kind'])}>
            <option value="call">買權 Call</option>
            <option value="put">賣權 Put</option>
            <option value="underlying">標的本身</option>
          </select>
        </Field>
        <Field label="方向">
          <select value={side} onChange={(e) => setSide(e.target.value as 'buy' | 'sell')}>
            <option value="buy">買進（+）</option>
            <option value="sell">賣出（−）</option>
          </select>
        </Field>
        <Field label="數量（口）" hint="標的以一口合約的單位數計">
          <input
            type="number"
            min="0"
            step="any"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
          />
        </Field>
        {option && (
          <Field label="履約價">
            <input
              type="number"
              min="0"
              step="any"
              value={strike}
              onChange={(e) => setStrike(e.target.value)}
            />
          </Field>
        )}
        <Field
          label={option ? '權利金（每單位）' : '進場價格'}
          hint={
            option
              ? model !== undefined
                ? `留空採模型價 ${fmtNum(model, 4)}`
                : '輸入完整後可採模型價'
              : `留空採現價 ${fmtNum(m.spot, 4)}`
          }
        >
          <input
            type="number"
            min="0"
            step="any"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
          />
        </Field>
        {option && (
          <>
            <Field label="到期天數" hint={`留空依市場設定 ${m.days} 天`}>
              <input
                type="number"
                min="1"
                step="1"
                value={days}
                onChange={(e) => setDays(e.target.value)}
              />
            </Field>
            <Field label="波動率（%）" hint={`留空依市場設定 ${fmtNum(m.vol * 100, 2)}%`}>
              <input
                type="number"
                min="0"
                step="any"
                value={vol}
                onChange={(e) => setVol(e.target.value)}
              />
            </Field>
          </>
        )}
      </div>
      {errors.length > 0 && (
        <div className="notice warn" role="alert">
          {errors.join('；')}
        </div>
      )}
    </Modal>
  );
}
