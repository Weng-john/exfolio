import { useState } from 'react';
import { Link } from 'react-router-dom';
import { IconClose } from './icons';

const STEPS = [
  {
    title: '先建立你的組合',
    body: '新增帳戶與倉位，讓淨資產與曝險有共同的起點。也可以先載入虛構示範，熟悉操作。',
    to: '/accounts',
    action: '建立帳戶與倉位',
    number: '01',
  },
  {
    title: '把配置化成目標',
    body: '設定各指數占 NAV 的目標權重，對照實際曝險與缺口。門檻只會提醒，槓桿由你決定。',
    to: '/allocation',
    action: '設定配置目標',
    number: '02',
  },
  {
    title: '讓下一筆投入更有方向',
    body: '輸入新資金，查看配置建議，再到風險實驗室評估情境。建議不會下單，也不會建立交易。',
    to: '/new-money',
    action: '試算新資金',
    number: '03',
  },
] as const;

/** UI preference only, kept in memory; financial data is never persisted. */
let dismissedThisVisit = false;
export function Onboarding() {
  const [visible, setVisible] = useState(!dismissedThisVisit);
  const [index, setIndex] = useState(0);
  const step = STEPS[index];
  const dismiss = () => {
    dismissedThisVisit = true;
    setVisible(false);
  };
  if (!visible)
    return (
      <button type="button" className="guide-reopen ghost" onClick={() => setVisible(true)}>
        使用指南 ↗
      </button>
    );
  return (
    <section
      className="onboarding"
      role="region"
      aria-roledescription="輪播"
      aria-label="試算入門指南"
    >
      <div className="guide-visual" aria-hidden="true">
        <span>{step.number}</span>
        <div className="guide-orbit" />
        <div className="guide-bars">
          <i />
          <i />
          <i />
          <i />
        </div>
      </div>
      <div className="guide-content">
        <span className="eyebrow">從看懂，到掌握</span>
        <div aria-live="polite" aria-atomic="true">
          <h2>{step.title}</h2>
          <p>{step.body}</p>
        </div>
        <div className="guide-bottom">
          <Link className="button primary" to={step.to}>
            {step.action} <span aria-hidden="true">↗</span>
          </Link>
          <div className="guide-pagination">
            <button
              type="button"
              aria-label="上一步"
              disabled={index === 0}
              onClick={() => setIndex(index - 1)}
            >
              ←
            </button>
            <span>
              {index + 1} / {STEPS.length}
            </span>
            <button
              type="button"
              aria-label={index === STEPS.length - 1 ? '完成指南' : '下一步'}
              onClick={() => (index === STEPS.length - 1 ? dismiss() : setIndex(index + 1))}
            >
              {index === STEPS.length - 1 ? '完成' : '→'}
            </button>
          </div>
        </div>
      </div>
      <button
        type="button"
        className="icon-btn guide-close"
        aria-label="略過指南"
        onClick={dismiss}
      >
        <IconClose />
      </button>
    </section>
  );
}
