import './styles.css';
import { mountApp } from './ui/app';

export const version = '0.0.0';

// Guarded so the module is importable in non-DOM (node) tests.
const app = typeof document !== 'undefined' ? document.getElementById('app') : null;
if (app) mountApp(app);
