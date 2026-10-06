import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Fonts are bundled locally (Design-system.md §3): no CDN, works offline.
import '@fontsource/chakra-petch/600.css';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/jetbrains-mono/400.css';
import './styles/globals.css';
import { App } from './app';
import { OverlayBorder, OverlayPill } from './features/computer/overlay';

// The same bundle serves the main window and the two Computer-Control overlay windows (by hash route).
const route = window.location.hash.replace(/^#/, '');
const overlay =
  route === 'overlay-border' ? (
    <OverlayBorder />
  ) : route === 'overlay-pill' ? (
    <OverlayPill />
  ) : null;
if (overlay) document.documentElement.classList.add('overlay');

const root = document.getElementById('root');
if (root) createRoot(root).render(<StrictMode>{overlay ?? <App />}</StrictMode>);
