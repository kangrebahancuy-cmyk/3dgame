import './style.css';
import { DEFAULT_CONFIG } from './config';
import { Game } from './core/Game';
import { Hud } from './ui/Hud';
import type { PaletteName } from './world/forest/NaturePalette';

const canvas = document.getElementById('game');
if (!(canvas instanceof HTMLCanvasElement)) throw new Error('index.html is missing <canvas id="game">');

const hud = new Hud();

// Last line of defence: any uncaught error becomes a readable message instead of a silent blank screen.
window.addEventListener('error', (ev) => {
  if (/ResizeObserver loop/i.test(ev.message)) return; // benign browser notice
  hud.showError('An unexpected error occurred.', ev.error ?? ev.message);
});
window.addEventListener('unhandledrejection', (ev) => hud.showError('An unexpected error occurred.', ev.reason));

// ?palette=kenney shows the Kenney models in their authored colours instead of the natural forest recolour.
const wanted = new URLSearchParams(window.location.search).get('palette');
const palette: PaletteName = wanted === 'kenney' ? 'kenney' : DEFAULT_CONFIG.world.palette;
const config = { ...DEFAULT_CONFIG, world: { ...DEFAULT_CONFIG.world, palette } };

new Game(canvas, hud, config).start().catch((e) => hud.showError('The game failed to start.', e));
