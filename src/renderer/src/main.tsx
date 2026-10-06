import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/globals.css';

function App(): React.JSX.Element {
  return <main className="app-shell">Jarvis</main>;
}

const root = document.getElementById('root');
if (root)
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
