import { useState } from 'react';
import {
  accountReferences,
  brokerReferences,
  getSettings,
  newId,
  type Account,
  type AccountType,
  type Broker,
} from '@core/index';
import { removeRow, upsertRow, useData } from '../../store';
import { Badge, Card, Empty, Field, Modal } from '../../components/ui';
import InstitutionForm, { KIND_LABELS } from './InstitutionForm';
import { ACCOUNT_TYPE_LABELS } from './labels';

export default function StructureTab() {
  const data = useData();
  const [broker, setBroker] = useState<Broker | undefined>();
  const [account, setAccount] = useState<Account | undefined>();
  const [notice, setNotice] = useState('');
  const brokerName = (id: string) => data.brokers.find((b) => b.id === id)?.name ?? id;

  const removeBroker = (b: Broker) => {
    const ref = brokerReferences(data, b.id);
    if (ref.accounts || ref.instruments) {
      const parts = [
        ref.accounts && `${ref.accounts} 個帳戶`,
        ref.instruments && `${ref.instruments} 個商品的可交易券商設定`,
      ].filter(Boolean);
      setNotice(
        `無法刪除機構「${b.name}」：仍被 ${parts.join('、')} 引用。請先刪除或改掛這些項目。`,
      );
      return;
    }
    if (window.confirm(`刪除機構「${b.name}」？`)) {
      removeRow('brokers', b.id);
      setNotice('');
    }
  };

  const removeAccount = (a: Account) => {
    const ref = accountReferences(data, a.id);
    if (ref.transactions || ref.collateral) {
      const parts = [
        ref.transactions && `${ref.transactions} 筆交易`,
        ref.collateral && `${ref.collateral} 筆貸款擔保品`,
      ].filter(Boolean);
      setNotice(
        `無法刪除帳戶「${a.name}」：仍被 ${parts.join('、')} 引用，刪除會破壞帳本。若不再使用，請改為停用。`,
      );
      return;
    }
    if (window.confirm(`刪除帳戶「${a.name}」？`)) {
      removeRow('accounts', a.id);
      setNotice('');
    }
  };

  return (
    <>
      {notice && <div className="notice warn">{notice}</div>}
      <Card
        title="券商 / 銀行 / 交易所"
        actions={
          <button className="primary" onClick={() => setBroker({ id: '', name: '' })}>
            新增機構
          </button>
        }
      >
        {data.brokers.length === 0 ? (
          <Empty>尚無機構。按「新增機構」從常用清單挑選，或自行輸入任何券商、銀行、交易所。</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>名稱</th>
                  <th>類別</th>
                  <th>帳戶數</th>
                  <th>手續費設定</th>
                  <th>備註</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.brokers.map((b) => (
                  <tr key={b.id}>
                    <td>{b.name}</td>
                    <td>{KIND_LABELS[b.kind ?? 'broker']}</td>
                    <td className="num">{brokerReferences(data, b.id).accounts}</td>
                    <td>{feeSummary(b)}</td>
                    <td>{b.note}</td>
                    <td className="actions">
                      <button className="ghost" onClick={() => setBroker(b)}>
                        編輯
                      </button>
                      <button className="danger" onClick={() => removeBroker(b)}>
                        刪除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card
        title="帳戶"
        actions={
          <button
            className="primary"
            disabled={!data.brokers.length}
            onClick={() =>
              setAccount({
                id: '',
                brokerId: data.brokers[0]?.id ?? '',
                name: '',
                type: 'securities',
                baseCurrency: getSettings(data).baseCurrency,
                active: true,
              })
            }
          >
            新增帳戶
          </button>
        }
      >
        {data.accounts.length === 0 ? (
          <Empty>尚無帳戶。{!data.brokers.length && '請先新增機構。'}</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>名稱</th>
                  <th>機構</th>
                  <th>類型</th>
                  <th>幣別</th>
                  <th>狀態</th>
                  <th>交易數</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.accounts.map((a) => (
                  <tr key={a.id}>
                    <td>{a.name}</td>
                    <td>{brokerName(a.brokerId)}</td>
                    <td>{ACCOUNT_TYPE_LABELS[a.type]}</td>
                    <td>{a.baseCurrency}</td>
                    <td>
                      {a.active ? <Badge tone="ok">使用中</Badge> : <Badge tone="warn">停用</Badge>}
                    </td>
                    <td className="num">{accountReferences(data, a.id).transactions}</td>
                    <td className="actions">
                      <button className="ghost" onClick={() => setAccount(a)}>
                        編輯
                      </button>
                      <button className="danger" onClick={() => removeAccount(a)}>
                        刪除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {broker && (
        <InstitutionForm
          broker={broker}
          existingIds={data.brokers.map((b) => b.id)}
          onClose={() => setBroker(undefined)}
          onSave={(b) => {
            upsertRow('brokers', b);
            setBroker(undefined);
          }}
        />
      )}
      {account && (
        <AccountForm
          account={account}
          brokers={data.brokers}
          onClose={() => setAccount(undefined)}
          onSave={(a) => {
            upsertRow('accounts', a);
            setAccount(undefined);
          }}
        />
      )}
    </>
  );
}

/** One-line summary of the equity commission, the rule users tune most. */
function feeSummary(b: Broker): string {
  const rule = b.fees?.stock ?? b.fees?.etf ?? b.fees?.crypto;
  if (!rule) return b.fees ? '已設定' : '—';
  const parts: string[] = [];
  if (rule.rate !== undefined) parts.push(`${Number((rule.rate * 100).toPrecision(6))}%`);
  if (rule.discount !== undefined && rule.discount !== 1)
    parts.push(`${Number((rule.discount * 100).toPrecision(6))} 折`);
  if (rule.minFee) parts.push(`最低 ${rule.minFee}`);
  return parts.join(' · ') || '已設定';
}

function AccountForm(props: {
  account: Account;
  brokers: Broker[];
  onSave: (a: Account) => void;
  onClose: () => void;
}) {
  const [a, setA] = useState(props.account);
  const set = (p: Partial<Account>) => setA((s) => ({ ...s, ...p }));
  const valid = a.name.trim() && a.brokerId && a.baseCurrency.trim();
  const save = () => {
    if (!valid) return;
    const out: Account = {
      ...a,
      id: a.id || newId('acct'),
      name: a.name.trim(),
      baseCurrency: a.baseCurrency.trim().toUpperCase(),
    };
    if (!out.note?.trim()) delete out.note;
    props.onSave(out);
  };
  return (
    <Modal
      title={props.account.id ? '編輯帳戶' : '新增帳戶'}
      onClose={props.onClose}
      footer={
        <>
          <button className="ghost" onClick={props.onClose}>
            取消
          </button>
          <button className="primary" onClick={save} disabled={!valid}>
            儲存
          </button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="名稱">
          <input value={a.name} onChange={(e) => set({ name: e.target.value })} />
        </Field>
        <Field label="機構">
          <select value={a.brokerId} onChange={(e) => set({ brokerId: e.target.value })}>
            {props.brokers.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="類型">
          <select value={a.type} onChange={(e) => set({ type: e.target.value as AccountType })}>
            {(Object.keys(ACCOUNT_TYPE_LABELS) as AccountType[]).map((t) => (
              <option key={t} value={t}>
                {ACCOUNT_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="帳戶幣別">
          <input value={a.baseCurrency} onChange={(e) => set({ baseCurrency: e.target.value })} />
        </Field>
        <Field label="備註">
          <input value={a.note ?? ''} onChange={(e) => set({ note: e.target.value })} />
        </Field>
        <Field label="狀態">
          <label>
            <input
              type="checkbox"
              checked={a.active}
              onChange={(e) => set({ active: e.target.checked })}
            />{' '}
            使用中
          </label>
        </Field>
      </div>
    </Modal>
  );
}
