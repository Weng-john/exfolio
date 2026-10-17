import { Logo } from './icons';

/** Logo and name, as shown in the header and on the sign-in pages. */
export function Brand(props: { suffix?: string }) {
  return (
    <span className="brand">
      <Logo />
      <span className="brand-name">Exfolio</span>
      {props.suffix && <span className="brand-suffix">{props.suffix}</span>}
    </span>
  );
}
