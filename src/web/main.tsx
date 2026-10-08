import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Sliced by unicode-range: only the slices a page needs are downloaded.
import '@fontsource/noto-sans-tc/400.css';
import App from './App';
import './styles.css';
import { applyTheme, loadTheme } from './theme';

// Before the first paint, so the page never flashes the wrong palette.
applyTheme(loadTheme());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
