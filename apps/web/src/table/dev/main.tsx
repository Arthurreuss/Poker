// Eigene Vite-Entry für die Testseite der Tischansicht (table-dev.html), unabhängig vom App-Router.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { TableDevPage } from './TableDevPage';

const root = document.getElementById('root');
if (root === null) {
  throw new Error('#root fehlt in table-dev.html');
}
document.body.style.margin = '0';
createRoot(root).render(
  <StrictMode>
    <TableDevPage />
  </StrictMode>,
);
