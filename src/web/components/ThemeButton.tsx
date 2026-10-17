import { toggleTheme, useTheme } from '../theme';
import { IconMoon, IconSun } from './icons';

/** Sun / moon button that switches between light and dark. */
export function ThemeButton() {
  const theme = useTheme();
  const label = theme === 'light' ? '切換為深色模式' : '切換為淺色模式';
  return (
    <button
      type="button"
      className="icon-btn"
      onClick={toggleTheme}
      title={label}
      aria-label={label}
    >
      {theme === 'light' ? <IconMoon /> : <IconSun />}
    </button>
  );
}

/** The same choice as a switch, for the menu drawer on small screens. */
export function ThemeSwitch() {
  const theme = useTheme();
  return (
    <button
      type="button"
      className="theme-switch-row"
      role="switch"
      aria-checked={theme === 'dark'}
      onClick={toggleTheme}
    >
      <IconMoon />
      <span>深色模式</span>
      <span className={`theme-switch ${theme}`}>
        <span className="switch-handle" />
      </span>
    </button>
  );
}
