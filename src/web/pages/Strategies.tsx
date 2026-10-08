import { useMemo, useState } from 'react';
import { strategyReferences, strategySummaries, type Strategy } from '@core/index';
import { Badge, Card, Empty, PageHeader } from '../components/ui';
import { fmtMoney, fmtPct, signClass } from '../format';
import { removeRow, upsertRow, useData } from '../store';
import { usePortfolio } from '../usePortfolio';
import StrategyDetail from './strategies/StrategyDetail';
import StrategyForm from './strategies/StrategyForm';
import SummaryTable from './strategies/SummaryTable';
import { STATUS_LABEL, STATUS_TONE } from './strategies/shared';
import './strategies/strategies.css';

export default function StrategiesPage() {
  const data = useData();
  const portfolio = usePortfolio();
  const base = portfolio.valuation.baseCurrency;
  const [selectedId, setSelectedId] = useState<string>();
  const [form, setForm] = useState<{ strategy?: Strategy }>();

  const summaries = useMemo(() => strategySummaries(data, portfolio), [data, portfolio]);
  const selected = data.strategies.find((s) => s.id === selectedId);
  const summaryOf = (id: string) => summaries.strategies.find((r) => r.bucket === id);

  const close = (s: Strategy) => upsertRow('strategies', { ...s, status: 'closed' });
  const remove = (s: Strategy) => {
    const refs = strategyReferences(data, s.id);
    if (refs.total > 0) {
      if (
        window.confirm(
          `「${s.name}」已有 ${refs.transactions} 筆交易、${refs.tradeGroups} 個交易群組、${refs.rotationCycles} 個輪動週期，無法刪除。要改為「已結束」嗎？`,
        )
      ) {
        close(s);
      }
      return;
    }
    if (window.confirm(`確定刪除「${s.name}」？`)) {
      removeRow('strategies', s.id);
      if (selectedId === s.id) setSelectedId(undefined);
    }
  };

  return (
    <>
      <PageHeader
        title="Strategy Hub"
        subtitle="新增與管理自訂主動策略、資金配置與策略列表"
        actions={
          <button className="primary" onClick={() => setForm({})}>
            新增策略
          </button>
        }
      />
      {form && (
        <StrategyForm
          strategy={form.strategy}
          onClose={() => setForm(undefined)}
          onSaved={(id) => setSelectedId(id)}
        />
      )}
      <div className="str-stack">
        <Card title="策略列表">
          {!data.strategies.length ? (
            <Empty>
              還沒有策略。策略完全由你定義，不需要設定觸發條件；建立後用「撥入資金」從核心配置資金給它。
            </Empty>
          ) : (
            <div className="table-wrap">
              <table className="str-list">
                <thead>
                  <tr>
                    <th>策略</th>
                    <th>狀態</th>
                    <th className="num">配置資金</th>
                    <th className="num">權益</th>
                    <th className="num">損益</th>
                    <th className="num">Gross 曝險</th>
                    <th className="num">Net 曝險</th>
                    <th className="num">佔 NAV</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data.strategies.map((s) => {
                    const r = summaryOf(s.id);
                    return (
                      <tr
                        key={s.id}
                        className={`clickable ${s.id === selected?.id ? 'selected' : ''}`}
                        onClick={() => setSelectedId(s.id)}
                      >
                        <td>
                          {s.name}
                          {s.category && <span className="muted"> · {s.category}</span>}
                        </td>
                        <td>
                          <Badge tone={STATUS_TONE[s.status]}>{STATUS_LABEL[s.status]}</Badge>
                        </td>
                        <td className="num">{fmtMoney(r?.capital, base)}</td>
                        <td className="num">{fmtMoney(r?.equity, base)}</td>
                        <td className={`num ${signClass(r?.totalPnl)}`}>
                          {fmtMoney(r?.totalPnl, base)}
                        </td>
                        <td className="num">{fmtMoney(r?.grossExposure, base)}</td>
                        <td className="num">{fmtMoney(r?.netExposure, base)}</td>
                        <td className="num">{fmtPct(r?.shareOfNav)}</td>
                        <td onClick={(e) => e.stopPropagation()}>
                          <button className="ghost" onClick={() => setForm({ strategy: s })}>
                            編輯
                          </button>
                          {s.status !== 'closed' && (
                            <button className="ghost" onClick={() => close(s)}>
                              結束
                            </button>
                          )}
                          <button className="ghost danger" onClick={() => remove(s)}>
                            刪除
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="四層級摘要">
          <p className="str-note">
            核心、各策略、所有主動策略合計、整體組合。同一商品可同時在核心與策略內，依交易所屬的策略桶歸屬，不以代號判斷。
            貸款歸在撥款交易所屬的桶（預設核心）；權益減去負債後，各桶合計等於整體 NAV。
          </p>
          <SummaryTable rows={summaries.levels} base={base} />
        </Card>

        {selected ? (
          <StrategyDetail
            strategy={selected}
            summary={summaryOf(selected.id) ?? summaries.core}
            base={base}
          />
        ) : (
          data.strategies.length > 0 && <Empty>點選上方策略查看持倉、資金帳本與輪動週期</Empty>
        )}
      </div>
    </>
  );
}
