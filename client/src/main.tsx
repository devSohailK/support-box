import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/nunito-sans';
import { App } from './App';
import './styles/tokens.css';
import './styles/app.css';
import './styles/layout.css';
import './styles/login.css';
import './styles/tickets.css';
import './styles/detail.css';
import './styles/forms.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
