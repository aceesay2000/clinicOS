import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  // Lets the app open with no connection (https and localhost only).
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

const printRoot = document.createElement('div');
printRoot.id = 'print-root';
document.body.appendChild(printRoot);

createRoot(document.getElementById('root')).render(<App />);
