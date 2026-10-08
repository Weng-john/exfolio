import { useState } from 'react';
import { isDerivative, type AppData, type CollateralItem, type CollateralStatus, type Loan } from '@core/index';
import { Badge, Card, Empty, Field, Modal, Stat } from '../../components/ui';
import { fmtMoney, fmtNum, fmtPct } from '../../format';
import { upsertRow } from '../../store';
import { num } from './shared';

interface Draft {
  instrumentId: string;
  accountId: string;
  quantity: string;
  ratio: string;
}

function CollateralEditor(props: { data: AppData; loan: Loan; onClose: () => void }) {
  const { data, loan } = props;
  const instruments = data.instruments.filter((i) => i.active && !isDerivative(i.type));
  const accounts = data.accounts.filter((a) => a.active && (a.type === 'securities' || a.type === 'crypto'));
  const [rows, setRows] = useState<Draft[]>(
    (loan.collateral ?? []).map((c) => ({
      instrumentId: c.instrumentId,
      accountId: c.accountId,
      quantity: String(c.quantity),
      ratio: String(Number((c.loanableRatio * 100).toFixed(4))),
    })),
  );
  const patch = (i: number, p: Partial<Draft>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const valid = rows.every(
    (r) => r.instrumentId && r.accountId && num(r.quantity) > 0 && num(r.ratio) >= 0 && num(r.ratio) <= 100,
  );

  const save = () => {
    if (!valid) return;
    const collateral: CollateralItem[] = rows.map((r) => ({
      instrumentId: r.instrumentId,
      accountId: r.accountId,
      quantity: num(r.quantity),
      loanableRatio: Number((num(r.ratio) / 100).toFixed(6)),
    }));
    upsertRow('loans', { ...loan, collateral });
    props.onClose();
  };

  return (
    <Modal
      title={`擔保品 · ${loan.name}`}
      wide
      onClose={props.onClose}
      footer={
        <>
          <button onClick={props.onClose}>取消</button>
          <button className="primary" disabled={!valid} onClick={save}>
            儲存
          </button>
        </>
      }
    >
      <div className="loans-stack">
        <p className="loans-explain">
          擔保品與股票持倉是同一筆資產：這裡只記錄「哪些股數被質押」，不會增加資產或 NAV；
          只有質押借款本身列為負債。折算率與追繳門檻僅作提示。
        </p>
        {rows.map((r, i) => (
          <div className="loans-inline" key={i}>
            <Field label="商品">
              <select value={r.instrumentId} onChange={(e) => patch(i, { instrumentId: e.target.value })}>
                <option value="">選擇商品</option>
                {instruments.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.symbol} {x.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="帳戶">
              <select value={r.accountId} onChange={(e) => patch(i, { accountId: e.target.value })}>
                <option value="">選擇帳戶</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="質押數量">
              <input type="number" value={r.quantity} onChange={(e) => patch(i, { quantity: e.target.value })} />
            </Field>
            <Field label="折算率（%）">
              <input type="number" value={r.ratio} onChange={(e) => patch(i, { ratio: e.target.value })} />
            </Field>
            <button className="danger" onClick={() => setRows(rows.filter((_, j) => j !== i))}>
              移除
            </button>
          </div>
        ))}
        <div>
          <button
            onClick={() =>
              setRows([...rows, { instrumentId: '', accountId: accounts[0]?.id ?? '', quantity: '', ratio: '60' }])
            }
          >
            新增擔保品
          </button>
        </div>
      </div>
    </Modal>
  );
}

export default function CollateralPanel(props: { data: AppData; loan: Loan; status?: CollateralStatus }) {
  const { data, loan, status: c } = props;
  const [editing, setEditing] = useState(false);
  const cur = loan.currency;

  return (
    <Card title="擔保品與維持率" actions={<button onClick={() => setEditing(true)}>編輯擔保品</button>}>
      {editing && <CollateralEditor data={data} loan={loan} onClose={() => setEditing(false)} />}
      {!c || !c.items.length ? (
        <Empty>尚未設定擔保品。</Empty>
      ) : (
        <div className="loans-stack">
          <div className="stats">
            <Stat
              label="整戶維持率"
              value={fmtPct(c.maintenanceRatio, 1)}
              tone={c.belowCall ? 'neg' : undefined}
              hint={c.callRatio ? `追繳門檻 ${fmtPct(c.callRatio, 0)}` : '未設定追繳門檻'}
            />
            <Stat label="擔保品市值" value={fmtMoney(c.marketValue, cur)} hint={cur} />
            <Stat label="可借額度（折算後）" value={fmtMoney(c.lendableValue, cur)} hint={`剩餘 ${fmtMoney(c.borrowingCapacity, cur)}`} />
            <Stat
              label="距離追繳"
              value={c.callRatio ? (c.belowCall ? '已低於門檻' : `-${fmtPct(c.triggerDropPct, 1)}`) : '—'}
              tone={c.belowCall ? 'neg' : undefined}
              hint={c.triggerValue !== undefined ? `市值 ${fmtMoney(c.triggerValue, cur)} 時觸發` : undefined}
            />
            <Stat label="可解除質押市值" value={fmtMoney(c.releasableValue, cur)} hint="仍維持在門檻以上" />
          </div>
          {c.belowCall && (
            <div className="notice warn">
              維持率低於追繳門檻。還款 <b>{fmtMoney(c.cureRepayment, cur)}</b> {cur}，或追加擔保品市值{' '}
              <b>{fmtMoney(c.cureCollateral, cur)}</b> {cur}，可回到 {fmtPct(c.callRatio, 0)}。
            </div>
          )}
          {c.warnings
            .filter((w) => !w.includes('追繳門檻'))
            .map((w) => (
              <div className="notice warn" key={w}>
                {w}
              </div>
            ))}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>商品</th>
                  <th>帳戶</th>
                  <th className="num">已質押</th>
                  <th className="num">帳戶持有</th>
                  <th className="num">可動用</th>
                  <th className="num">市值（{cur}）</th>
                  <th className="num">折算率</th>
                  <th className="num">可借值</th>
                </tr>
              </thead>
              <tbody>
                {c.items.map((it, i) => (
                  <tr key={i}>
                    <td>{it.symbol}</td>
                    <td>{data.accounts.find((a) => a.id === it.accountId)?.name ?? it.accountId}</td>
                    <td className="num">{fmtNum(it.pledgedQuantity, 4)}</td>
                    <td className="num">{fmtNum(it.heldQuantity, 4)}</td>
                    <td className="num">
                      {it.overPledged ? <Badge tone="bad">超額質押 {fmtNum(it.freeQuantity, 4)}</Badge> : fmtNum(it.freeQuantity, 4)}
                    </td>
                    <td className="num">{fmtMoney(it.marketValue, cur)}</td>
                    <td className="num">{fmtPct(it.loanableRatio, 0)}</td>
                    <td className="num">{fmtMoney(it.lendableValue, cur)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="loans-explain">
            擔保品市值只是備忘，不計入資產或 NAV（與持倉是同一筆資產）。門檻僅提示，系統不會阻擋任何操作。
          </p>
        </div>
      )}
    </Card>
  );
}
