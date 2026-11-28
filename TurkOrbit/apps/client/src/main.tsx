import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { initNativeShell } from './platform/shell';
import './styles/global.css';

// Mobil uygulamada geri tuşu, arka plan/ön plan ve sistem çubukları (web'de hiçbir şey yapmaz)
initNativeShell();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
