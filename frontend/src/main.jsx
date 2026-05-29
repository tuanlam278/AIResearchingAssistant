import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css'; // <-- Mạng sống của Tailwind CSS nằm ở đây!

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
);
