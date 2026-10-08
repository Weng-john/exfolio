import { useMemo, useState } from 'react';
import {
  allowedInstrumentViolations,
  strategyCapitalFlows,
  type BucketSummary,
  type Strategy,
} from '@core/index';
import { Badge, Card, Empty, Stat } from '../../components/ui';
import { fmtMoney, fmtNum, fmtPct, fmtX, signClass } from '../../format';
import { useData } from '../../store';
import { usePortfolio } from '../../usePortfolio';
import RotationSection from './RotationSection';
import TransferModal from './TransferModal';
import { bucketName, FLOW_LABEL, STATUS_LABEL, STATUS_TONE, symbolOf } from './shared';

export default function StrategyDetail(props: { strategy: Strategy; summary: BucketSummary; base: string }) {
  const { strategy, summary: s, base } = props;
  const data = useData();
  const { valuation } = usePortfolio();
  const [transfer, setTransfer] = useState<'in' | 'out'>();

  const positions = valuation.positions.filter((p) => p.bucket === strategy.id);
  const flows = useMemo(() => strategyCapitalFlows(data, strategy.id), [data, strategy.id]);
  const violations = useMemo(() => allowedInstrumentViolations(data, strategy.id), [data, strategy.id]);
  const benchIndex = data.indices.find((i) => i.id === strategy.benchmarkIndexId);
  const tone = (v: number) => (v > 0 ? 'pos' : v < 0 ? 'neg' : undefined);

  return (
    <div className="str-stack">
      <Card
        title={strategy.name}
        actions={
          <>
            <button className="primary" onClick={() => setTransfer('in')}>撥入資金</button>
            <button onClick={() => setTransfer('out')}>撥出資金</button>
          </>
        }
      >
        <p className="muted" style={{ marginTop: 0 }}>
          <Badge tone={STATUS_TONE[strategy.status]}>{STATUS_LABEL[strategy.status]}</Badge>{' '}
          {strategy.category && <>分類：{strategy.category} · </>}
          基準：{[benchIndex?.name, strategy.benchmarkInstrumentId && symbolOf(data, strategy.benchmarkInstrumentId)].filter(Boolean).join(' / ') || '未設定'}
          {strategy.allowedInstrumentIds?.length ? <> · 允許商品：{strategy.allowedInstrumentIds.map((i) => symbolOf(data, i)).join('、')}</> : <> · 商品不限</>}
        </p>
        {strategy.description && <p>{strategy.description}</p>}
        {strategy.rules && <p className="str-note" style={{ whiteSpace: 'pre-wrap' }}>規則：{strategy.rules}</p>}
        {strategy.riskNotes && <p className="str-note" style={{ whiteSpace: 'pre-wrap' }}>風險：{strategy.riskNotes}</p>}
        {violations.length > 0 && (
          <div className="notice warn">有 {violations.length} 筆交易的商品不在這個策略的允許清單內（僅提醒，不阻擋）。</div>
        )}
        <div className="stats">
          <Stat label={`配置資金（${base}）`} value={fmtMoney(s.capital, base)} hint={`外部 ${fmtMoney(s.externalCapital, base)} · 內部 ${fmtMoney(s.transferNet, base)}`} />
          <Stat label="權益" value={fmtMoney(s.equity, base)} hint={`現金 ${fmtMoney(s.cashValue, base)} · 證券 ${fmtMoney(s.securitiesValue, base)} · 衍生品 ${fmtMoney(s.derivativesEquity, base)}`} />
          <Stat label="總損益" value={fmtMoney(s.totalPnl, base)} tone={tone(s.totalPnl)} hint={`報酬 ${fmtPct(s.capital > 0 ? s.totalPnl / s.capital : undefined)}（對配置資金）`} />
          <Stat label="已實現 / 未實現" value={`${fmtMoney(s.realizedPnl, base)} / ${fmtMoney(s.unrealizedPnl, base)}`} />
          <Stat label="股息 / 費用 / 資金成本" value={`${fmtMoney(s.dividends, base)} / ${fmtMoney(s.fees, base)} / ${fmtMoney(s.fundingCost, base)}`} />
          <Stat label="Gross / Net 曝險" value={`${fmtMoney(s.grossExposure, base)} / ${fmtMoney(s.netExposure, base)}`} hint={`對權益 ${fmtX(s.grossToEquity)} / ${fmtX(s.netToEquity)} · 對 NAV ${fmtX(s.grossToNav)} / ${fmtX(s.netToNav)}`} />
          <Stat label="佔 NAV" value={fmtPct(s.shareOfNav)} />
        </div>
        {s.cash.length > 0 && (
          <p className="str-note">
            現金：{s.cash.map((c) => `${c.currency} ${fmtMoney(c.amount, c.currency)}`).join('；')}
          </p>
        )}
      </Card>

      <Card title="持倉">
        {!positions.length ? (
          <Empty>這個策略目前沒有持倉</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>商品</th>
                  <th>帳戶</th>
                  <th className="num">數量</th>
                  <th className="num">成本</th>
                  <th className="num">現價</th>
                  <th className="num">市值（{base}）</th>
                  <th className="num">未實現</th>
                  <th className="num">曝險（{base}）</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((p) => (
                  <tr key={p.key}>
                    <td>{p.instrument.symbol}</td>
                    <td>{data.accounts.find((a) => a.id === p.accountId)?.name ?? p.accountId}</td>
                    <td className="num">{fmtNum(p.quantity, 4)}</td>
                    <td className="num">{fmtNum(p.avgCost, 2)}</td>
                    <td className="num">{fmtNum(p.price, 2)}</td>
                    <td className="num">{fmtMoney(p.marketValue, base)}</td>
                    <td className={`num ${signClass(p.unrealizedPnl)}`}>{fmtMoney(p.unrealizedPnl, base)}</td>
                    <td className="num">{fmtMoney(p.exposure, base)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="策略資金帳本">
        <p className="str-note">
          只記資金進出。內部撥入撥出是組合內部的調度，不是獲利，也不改變整體 NAV；外部入出金才會改變整體累積投入。
        </p>
        {!flows.length ? (
          <Empty>尚無資金異動。用「撥入資金」從核心配置一筆資金給這個策略。</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>日期</th>
                  <th>類型</th>
                  <th>對方</th>
                  <th className="num">金額</th>
                  <th>幣別</th>
                  <th className="num">約當 {base}</th>
                  <th className="num">累計配置資金</th>
                  <th>備註</th>
                </tr>
              </thead>
              <tbody>
                {flows.map((f) => (
                  <tr key={f.txId}>
                    <td>{f.date}</td>
                    <td>{FLOW_LABEL[f.kind]}{f.source === 'loan_repay' ? '（貸款還款）' : ''}</td>
                    <td>{f.counterparty ? bucketName(data, f.counterparty) : '外部'}</td>
                    <td className="num">{fmtMoney(f.amount, f.currency)}</td>
                    <td>{f.currency}</td>
                    <td className="num">{fmtMoney(f.baseAmount, base)}</td>
                    <td className="num">{fmtMoney(f.runningCapital, base)}</td>
                    <td>{f.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <RotationSection strategy={strategy} base={base} />
      {transfer && <TransferModal strategy={strategy} direction={transfer} onClose={() => setTransfer(undefined)} />}
    </div>
  );
}
