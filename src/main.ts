export const version = '0.0.0';

// Guarded so the module is importable in non-DOM (node) tests.
const app = typeof document !== 'undefined' ? document.getElementById('app') : null;
if (app) app.textContent = `PEA E-Meter Reader v${version}`;
