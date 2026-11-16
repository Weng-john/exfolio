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
