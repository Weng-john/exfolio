import { useRef, useState } from 'react';
import {
  filterTransactions,
  getSettings,
  parseTransactionsCsv,
  splitExisting,
  transactionsToCsv,
  type CsvImportResult,
  type Transaction,
  type TxFilter,
  type TxType,
} from '@core/index';
import { removeRow, setTable, upsertRow, useData } from '../../store';
import { Card, Empty, Modal } from '../../components/ui';
import { fmtMoney, fmtNum, signClass } from '../../format';
import StatementImport from './StatementImport';
import TxForm from './TxForm';
import { TX_LABELS } from './labels';
import { FundingBadges, FundingNotice } from '../../components/FundingEvidence';

interface Preview {
  fileName: string;
  result: CsvImportResult;
  fresh: Transaction[];
  skipped: Transaction[];
}

export default function TransactionsTab() {
  const data = useData();
  const [filter, setFilter] = useState<TxFilter>({});
  const [editing, setEditing] = useState<Transaction | 'new' | undefined>();
  const [preview, setPreview] = useState<Preview | undefined>();
  const [message, setMessage] = useState('');
  const [statementOpen, setStatementOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const base = getSettings(data).baseCurrency;

  const rows = filterTransactions(data.transactions, filter);
  const accountName = (id?: string) =>
    id ? (data.accounts.find((a) => a.id === id)?.name ?? id) : '';
  const instSymbol = (id?: string) =>
    id ? (data.instruments.find((i) => i.id === id)?.symbol ?? id) : '';
  const patch = (p: Partial<TxFilter>) => setFilter((f) => ({ ...f, ...p }));

  const remove = (t: Transaction) => {
    if (window.confirm(`刪除 ${t.date} ${TX_LABELS[t.type]} 交易？此動作無法復原。`))
      removeRow('transactions', t.id);
  };

  const exportCsv = () => {
    // BOM so Excel reads the UTF-8 Chinese text correctly.
    const blob = new Blob(['﻿', transactionsToCsv(rows)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `transactions-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const result = parseTransactionsCsv(await file.text(), data);
    setPreview({
      fileName: file.name,
      result,
      ...splitExisting(result.transactions, data.transactions),
    });
    setMessage('');
    if (fileRef.current) fileRef.current.value = '';
  };

  const confirmImport = () => {
    if (!preview) return;
    if (preview.fresh.length) setTable('transactions', [...data.transactions, ...preview.fresh]);
    setMessage(
      `已匯入 ${preview.fresh.length} 筆，略過 ${preview.skipped.length} 筆（id 已存在）。`,
    );
    setPreview(undefined);
  };

  return (
    <Card
      title={`交易（${rows.length}${rows.length !== data.transactions.length ? ` / ${data.transactions.length}` : ''}）`}
      actions={
        <>
          <button onClick={exportCsv} disabled={!rows.length}>
            匯出 CSV
          </button>
          <button onClick={() => fileRef.current?.click()}>匯入 CSV</button>
          <button onClick={() => setStatementOpen(true)}>匯入券商對帳單</button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            hidden
            onChange={(e) => void onFile(e.target.files?.[0])}
          />
          <button
            className="primary"
            onClick={() => setEditing('new')}
            disabled={!data.accounts.length}
          >
            新增交易
          </button>
        </>
      }
    >
      <FundingNotice transactions={rows} />
      {message && <div className="notice">{message}</div>}
      <div className="acct-filters">
        <select
          aria-label="帳戶"
          value={filter.accountId ?? ''}
          onChange={(e) => patch({ accountId: e.target.value || undefined })}
        >
          <option value="">全部帳戶</option>
          {data.accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <select
          aria-label="類型"
          value={filter.type ?? ''}
          onChange={(e) => patch({ type: (e.target.value || undefined) as TxType | undefined })}
        >
          <option value="">全部類型</option>
          {(Object.keys(TX_LABELS) as TxType[]).map((t) => (
            <option key={t} value={t}>
              {TX_LABELS[t]}
            </option>
          ))}
        </select>
        <select
          aria-label="商品"
          value={filter.instrumentId ?? ''}
          onChange={(e) => patch({ instrumentId: e.target.value || undefined })}
        >
          <option value="">全部商品</option>
          {data.instruments.map((i) => (
            <option key={i.id} value={i.id}>
              {i.symbol} {i.name}
            </option>
          ))}
        </select>
        <input
          type="date"
          aria-label="起日"
          value={filter.from ?? ''}
          onChange={(e) => patch({ from: e.target.value || undefined })}
        />
        <input
          type="date"
          aria-label="迄日"
          value={filter.to ?? ''}
          onChange={(e) => patch({ to: e.target.value || undefined })}
        />
        <button className="ghost" onClick={() => setFilter({})}>
          清除篩選
        </button>
      </div>

      {rows.length === 0 ? (
        <Empty>沒有符合條件的交易。</Empty>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>日期</th>
                <th>類型</th>
                <th>帳戶</th>
                <th>商品</th>
                <th className="num">數量</th>
                <th className="num">價格</th>
                <th className="num">金額</th>
                <th>備註</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id}>
                  <td>{t.date}</td>
                  <td>
                    {TX_LABELS[t.type]}
                    <FundingBadges transaction={t} />
                  </td>
                  <td>
                    {accountName(t.accountId)}
                    {t.toAccountId && (
                      <span className="muted"> → {accountName(t.toAccountId)}</span>
                    )}
                    {t.bucket !== 'core' && (
                      <span className="muted">
                        {' '}
                        · {data.strategies.find((s) => s.id === t.bucket)?.name ?? t.bucket}
                      </span>
                    )}
                  </td>
                  <td>{instSymbol(t.instrumentId)}</td>
                  <td className="num">{fmtNum(t.quantity, 4)}</td>
                  <td className="num">{fmtNum(t.price, 4)}</td>
                  <td
                    className={`num ${t.type === 'adjust' || t.type === 'funding_fee' ? signClass(t.amount) : ''}`}
                  >
                    {t.type === 'buy' || t.type === 'sell'
                      ? '—'
                      : `${fmtMoney(t.amount, t.currency)} ${t.currency}`}
                    {t.type === 'transfer' && t.toCurrency && t.toCurrency !== t.currency && (
                      <div className="muted">
                        → {fmtMoney(t.toAmount, t.toCurrency)} {t.toCurrency}
                      </div>
                    )}
                    {t.type === 'loan_repay' && t.source && (
                      <div className="muted">
                        {t.source === 'unconfirmed'
                          ? '待核對 · 尚未計帳'
                          : t.source === 'external'
                            ? '外部資金'
                            : '投資組合'}
                      </div>
                    )}
                  </td>
                  <td>{t.note}</td>
                  <td className="actions">
                    <button className="ghost" onClick={() => setEditing(t)}>
                      編輯
                    </button>
                    <button className="danger" onClick={() => remove(t)}>
                      刪除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted">
        金額欄為現金金額（{base} 以外幣別另標示）；買賣的現金影響由數量 × 價格推算。
      </p>

      {editing && (
        <TxForm
          data={data}
          tx={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(undefined)}
          onSave={(t) => {
            upsertRow('transactions', t);
            setEditing(undefined);
          }}
        />
      )}

      {preview && (
        <Modal
          title={`匯入預覽 · ${preview.fileName}`}
          wide
          onClose={() => setPreview(undefined)}
          footer={
            <>
              <button className="ghost" onClick={() => setPreview(undefined)}>
                取消
              </button>
              <button className="primary" onClick={confirmImport} disabled={!preview.fresh.length}>
                確認匯入 {preview.fresh.length} 筆
              </button>
            </>
          }
        >
          <p>
            有效 {preview.result.transactions.length} 筆（新增 {preview.fresh.length}、id
            已存在將略過 {preview.skipped.length}），錯誤 {preview.result.errors.length}{' '}
            筆。錯誤的列不會匯入。
          </p>
          {preview.result.errors.length > 0 && (
            <ul className="acct-errors">
              {preview.result.errors.map((e) => (
                <li key={e.row}>
                  第 {e.row} 列：{e.message}
                </li>
              ))}
            </ul>
          )}
          {preview.fresh.length > 0 && (
            <div className="table-wrap acct-preview">
              <table>
                <thead>
                  <tr>
                    <th>日期</th>
                    <th>類型</th>
                    <th>帳戶</th>
                    <th>商品</th>
                    <th className="num">數量</th>
                    <th className="num">價格</th>
                    <th className="num">金額</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.fresh.map((t) => (
                    <tr key={t.id}>
                      <td>{t.date}</td>
                      <td>{TX_LABELS[t.type]}</td>
                      <td>{accountName(t.accountId)}</td>
                      <td>{instSymbol(t.instrumentId)}</td>
                      <td className="num">{fmtNum(t.quantity, 4)}</td>
                      <td className="num">{fmtNum(t.price, 4)}</td>
                      <td className="num">
                        {t.type === 'buy' || t.type === 'sell'
                          ? '—'
                          : `${fmtMoney(t.amount, t.currency)} ${t.currency}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Modal>
      )}
      {statementOpen && <StatementImport onClose={() => setStatementOpen(false)} />}
    </Card>
  );
}
