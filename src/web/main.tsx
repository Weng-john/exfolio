import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Sliced by unicode-range: only the slices a page needs are downloaded.
import '@fontsource/noto-sans-tc/400.css';
import App from './App';
import { DialogHost } from './components/DialogHost';
import './styles.css';
// Applies the theme on import, before the first paint, so the page never
// flashes the wrong palette.
import './theme';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <DialogHost />
  </StrictMode>,
);
