import './allocation.css';

/** Target (grey) vs actual core (blue) weight on a shared, zero-centred scale. */
export function WeightBar(props: { target: number; actual: number; scale: number }) {
  const { target, actual, scale } = props;
  const span = Math.max(scale, 0.01) * 2; // -scale .. +scale
  const seg = (v: number) => {
    const left = (Math.min(0, v) + scale) / span;
    return { left: `${left * 100}%`, width: `${(Math.abs(v) / span) * 100}%` };
  };
  return (
    <div className="wbar" aria-hidden="true">
      <span className="zero" style={{ left: '50%' }} />
      <span className="fill" style={seg(target)} />
      <span className="fill actual" style={seg(actual)} />
    </div>
  );
}
