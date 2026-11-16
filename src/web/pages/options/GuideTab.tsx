import { Card } from '../../components/ui';
import { Accordion } from '../../components/Primitives';

const TERMS: Array<[string, string]> = [
  ['買權 Call', '在到期日以履約價買進標的的權利。標的上漲時獲利，買方損失以權利金為限。'],
  ['賣權 Put', '在到期日以履約價賣出標的的權利。標的下跌時獲利，常用來為持股避險。'],
  ['權利金', '買方付給賣方的價格。乘上合約乘數就是一口的金額。'],
  [
    '內含價值與時間價值',
    '內含價值是立即履約可得的金額；權利金扣掉內含價值就是時間價值，會隨到期接近而遞減。',
  ],
  ['隱含波動率', '讓模型價格等於市場價格的波動率。越高代表市場預期的波動越大，權利金也越貴。'],
];

export function GuideTab() {
  return (
    <div className="opt-guide">
      <Card title="名詞">
        <dl className="opt-terms">
          {TERMS.map(([term, text]) => (
            <div key={term}>
              <dt>{term}</dt>
              <dd>{text}</dd>
            </div>
          ))}
        </dl>
      </Card>
      <Card title="模型與限制">
        <Accordion title="Black-Scholes-Merton 模型" open>
          <p>
            價格以歐式選擇權的 Black-Scholes-Merton
            公式計算：波動率與利率在到期前固定，標的報酬呈對數常態分配，股利以連續殖利率表示（本頁與持倉計算取
            0）。
          </p>
          <p className="opt-formula">
            C = S·e<sup>−qT</sup>·N(d₁) − K·e<sup>−rT</sup>·N(d₂)，d₁ = [ln(S/K) + (r − q + σ²/2)T]
            / σ√T，d₂ = d₁ − σ√T
          </p>
        </Accordion>
        <Accordion title="美式選擇權與提前履約">
          <p>
            美股個股與 ETF
            選擇權多為美式，可提前履約。深度價內的賣權、或除息前的買權，實際價值可能高於本模型；臺指選擇權等歐式契約則無此差異。
          </p>
        </Accordion>
        <Accordion title="獲利機率不是預測">
          <p>
            獲利機率依輸入的波動率、以風險中立的對數常態分配估算。真實市場的大幅波動比模型更常見，波動率也會改變；請把它當作比較不同策略的參考，而不是勝率。
          </p>
        </Accordion>
        <Accordion title="多個到期日">
          <p>
            各腿到期日不同時（例如日曆價差），「到期損益」指最早一隻腿到期時的損益，較晚到期的腿仍以模型估值；此時最大損益與兩平點不另計算。
          </p>
        </Accordion>
        <Accordion title="不會下單，也不限制操作">
          <p>試算結果只供參考，網站不會建立交易或下單；持倉曝險也只用於提醒，沒有任何強制上限。</p>
        </Accordion>
      </Card>
    </div>
  );
}
