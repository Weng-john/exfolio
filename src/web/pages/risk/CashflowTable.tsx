import { useState } from 'react';
import { newId, today, type CashflowItem } from '@core/index';
import { Badge, Card, Empty, Field, Modal } from '../../components/ui';
import { fmtMoney } from '../../format';
import { removeRow, upsertRow, useData } from '../../store';
import { NumInput } from './shared';

const FREQ: Record<CashflowItem['frequency'], string> = {
  once: '一次性',
  monthly: '每月',
  quarterly: '每季',
  yearly: '每年',
};

function blank(currency: string): CashflowItem {
  return {
    id: newId('cf'),
    name: '',
    kind: 'expense',
    amount: 0,
    currency,
    frequency: 'monthly',
    startDate: today(),
    affectsPortfolio: true,
  };
}

/** CRUD over `data.cashflowItems`: income and expenses used by the survival run. */
export default function CashflowTable() {
  const data = useData();
  const base = data.settings[0]?.baseCurrency ?? 'TWD';
  const [form, setForm] = useState<{ item: CashflowItem; isNew: boolean }>();

  const save = () => {
    if (!form) return;
    upsertRow('cashflowItems', { ...form.item, name: form.item.name.trim(), endDate: form.item.endDate || undefined });
    setForm(undefined);
  };
  const valid = !!form && form.item.name.trim() !== '' && form.item.amount > 0 && !!form.item.startDate;
  const set = (patch: Partial<CashflowItem>) => setForm((f) => f && { ...f, item: { ...f.item, ...patch } });

  return (
    <Card
      title="外部收支（現金流項目）"
      actions={
        <button className="primary" onClick={() => setForm({ item: blank(base), isNew: true })}>
          新增
        </button>
      }
    >
      {!data.cashflowItems.length ? (
        <Empty>尚未建立收入或支出。新增薪資、生活費等，生存模擬才會計入。</Empty>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>名稱</th>
                <th>類別</th>
                <th className="num">金額</th>
                <th>頻率</th>
                <th>開始</th>
                <th>結束</th>
                <th>進出投資組合</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.cashflowItems.map((c) => (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td>{c.kind === 'income' ? '收入' : '支出'}</td>
                  <td className={`num ${c.kind === 'income' ? 'pos' : 'neg'}`}>
                    {fmtMoney(c.amount, c.currency)} {c.currency}
                  </td>
                  <td>{FREQ[c.frequency]}</td>
                  <td>{c.startDate}</td>
                  <td>{c.endDate ?? '—'}</td>
                  <td>{c.affectsPortfolio ? <Badge tone="info">是</Badge> : <Badge tone="warn">否（組合外）</Badge>}</td>
                  <td>
                    <div className="risk-row-actions">
                      <button className="ghost" onClick={() => setForm({ item: { ...c }, isNew: false })}>
                        編輯
                      </button>
                      <button
                        className="ghost danger"
                        onClick={() => window.confirm(`確定刪除「${c.name}」？`) && removeRow('cashflowItems', c.id)}
                      >
                        刪除
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
        「進出投資組合」為否的收支留在組合之外，不會增減投資組合現金（例如薪資直接用來生活）。
      </p>

      {form && (
        <Modal
          title={form.isNew ? '新增收支' : '編輯收支'}
          onClose={() => setForm(undefined)}
          footer={
            <>
              <button onClick={() => setForm(undefined)}>取消</button>
              <button className="primary" disabled={!valid} onClick={save}>
                儲存
              </button>
            </>
          }
        >
          <div className="form-grid">
            <Field label="名稱">
              <input value={form.item.name} onChange={(e) => set({ name: e.target.value })} />
            </Field>
            <Field label="類別">
              <select value={form.item.kind} onChange={(e) => set({ kind: e.target.value as CashflowItem['kind'] })}>
                <option value="income">收入</option>
                <option value="expense">支出</option>
              </select>
            </Field>
            <Field label="金額（正數）">
              <NumInput value={form.item.amount || undefined} onChange={(v) => set({ amount: v ?? 0 })} />
            </Field>
            <Field label="幣別">
              <input value={form.item.currency} onChange={(e) => set({ currency: e.target.value.trim().toUpperCase() })} />
            </Field>
            <Field label="頻率">
              <select value={form.item.frequency} onChange={(e) => set({ frequency: e.target.value as CashflowItem['frequency'] })}>
                {Object.entries(FREQ).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="開始日期">
              <input type="date" value={form.item.startDate} onChange={(e) => set({ startDate: e.target.value })} />
            </Field>
            <Field label="結束日期（可留空）">
              <input type="date" value={form.item.endDate ?? ''} onChange={(e) => set({ endDate: e.target.value || undefined })} />
            </Field>
            <Field label="進出投資組合" hint="否 = 在組合外收付">
              <select value={form.item.affectsPortfolio ? 'yes' : 'no'} onChange={(e) => set({ affectsPortfolio: e.target.value === 'yes' })}>
                <option value="yes">是</option>
                <option value="no">否</option>
              </select>
            </Field>
          </div>
        </Modal>
      )}
    </Card>
  );
}
