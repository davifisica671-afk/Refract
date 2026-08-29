import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import reportWebVitals from './reportWebVitals';

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement
);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// If you want para iniciar measuring performance in your app, pass a function
// para registro results (for example: reportWebVitals(console.log))
// ou enviar para an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
