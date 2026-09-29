import React from 'react';
import ReactDOM from 'react-dom/client';
import { SovereignProvider } from '@sovereigns3nc/react';
import App from './App';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <SovereignProvider
      config={{
        userId: 'dev-user',
        password: 'demo-password-123',
        syncMode: 'offline'
      }}
    >
      <App />
    </SovereignProvider>
  </React.StrictMode>
);
