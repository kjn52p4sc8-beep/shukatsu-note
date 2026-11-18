import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ToastHost } from './ui/toast';
import { UpdatePrompt } from './ui/UpdatePrompt';
import './ui/install';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <UpdatePrompt />
    <ToastHost />
  </StrictMode>,
);
