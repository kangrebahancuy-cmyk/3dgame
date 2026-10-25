import './style.css';
import { DEFAULT_CONFIG } from './config';
import { Game } from './core/Game';
import { Hud } from './ui/Hud';

const canvas = document.getElementById('game');
if (!(canvas instanceof HTMLCanvasElement)) throw new Error('index.html is missing <canvas id="game">');

const hud = new Hud();

// Last line of defence: any uncaught error becomes a readable message instead of a silent blank screen.
window.addEventListener('error', (ev) => {
  if (/ResizeObserver loop/i.test(ev.message)) return; // benign browser notice
  hud.showError('An unexpected error occurred.', ev.error ?? ev.message);
});
window.addEventListener('unhandledrejection', (ev) => hud.showError('An unexpected error occurred.', ev.reason));

new Game(canvas, hud, DEFAULT_CONFIG).start().catch((e) => hud.showError('The game failed to start.', e));
