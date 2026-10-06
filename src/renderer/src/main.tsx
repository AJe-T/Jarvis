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

const root = document.getElementById('root');
if (root)
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
