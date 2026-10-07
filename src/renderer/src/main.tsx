import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Fonts are bundled locally via styles/fonts.css (Design-system.md §4): no CDN, works offline.
import './styles/globals.css';
import { App } from './app';
import { OverlayBorder, OverlayPill } from './features/computer/overlay';
import { MiniOrb } from './features/mini/mini-orb';

// The same bundle serves the main window and the two Computer-Control overlay windows (by hash route).
const route = window.location.hash.replace(/^#/, '');
const SPECIAL: Record<string, () => React.JSX.Element> = {
  'overlay-border': OverlayBorder,
  'overlay-pill': OverlayPill,
  mini: MiniOrb,
};
const Special = SPECIAL[route];
const overlay = Special ? <Special /> : null;
if (overlay) document.documentElement.classList.add('overlay');

const root = document.getElementById('root');
if (root) createRoot(root).render(<StrictMode>{overlay ?? <App />}</StrictMode>);
