import { useEffect, useState } from 'react';

export const CHART_TOOLTIP = {
  background: 'var(--surface)',
  border: '1px solid var(--border-strong)',
  borderRadius: '12px',
  color: 'var(--text)',
  boxShadow: 'var(--shadow)',
};

/** Recharts animates in JS, so CSS alone cannot honor reduced motion. */
export function useChartMotion() {
  const [animate, setAnimate] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setAnimate(!query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return animate;
}
