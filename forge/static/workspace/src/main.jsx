import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { view } from '@forge/bridge';
import App from './App.jsx';
import './styles.css';

// Follow the Atlassian theme (light/dark) of the host product.
view.theme.enable();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
