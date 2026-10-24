import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  // Only available on localhost / https (see README: "Tablets and offline start-up").
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

const printRoot = document.createElement('div');
printRoot.id = 'print-root';
document.body.appendChild(printRoot);

createRoot(document.getElementById('root')).render(<App />);
