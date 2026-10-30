import type { CombatEvent } from '../combat/events';
import type { CombatSystem } from '../combat/CombatSystem';
import type { Monster } from '../combat/Monster';
import { GLOBAL_COOLDOWN, type SkillDef, type SkillIcon } from '../combat/SkillConfig';
import { weaponProfile } from '../combat/weapon';
import type { GameMessage, PlayerState } from '../game/playerState';

export interface ScreenPoint {
  x: number;
  y: number;
  visible: boolean;
}

/** What the UI needs from the outside world. The UI never decides anything: it calls these and renders combat state. */
export interface CombatUiHooks {
  /** World position -> CSS pixels in the viewport. */
  project(x: number, y: number, z: number, out: ScreenPoint): void;
  notify(m: GameMessage): void;
  useSkill(skillId: string): void;
  respawn(): void;
  clearTarget(): void;
}

const ICONS: Readonly<Record<SkillIcon, string>> = {
  slash: '<path d="M6 26 24 6" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><path d="M20 4h8v8" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 20c4 1 7 4 8 8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" opacity=".6"/>',
  strike: '<path d="M16 3 19 12h9l-7.2 5.6L24 27l-8-5.6L8 27l3.2-9.4L4 12h9z" fill="currentColor" opacity=".9"/>',
  whirl: '<path d="M16 5a11 11 0 1 1-10.4 7.4" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"/><path d="M2.5 6.5 6 13.4l6.5-3.8z" fill="currentColor"/><path d="M16 11a5 5 0 1 0 5 5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" opacity=".7"/>',
};

const MAX_NUMBERS = 24;
const NUMBER_LIFE = 1.0;
const BAR_RANGE = 30;
const TOAST_COOLDOWN = 0.8;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

interface FloatingNumber {
  readonly el: HTMLElement;
  x: number; y: number; z: number;
  drift: number;
  age: number;
  active: boolean;
}

interface MobBar {
  readonly box: HTMLElement;
  readonly fill: HTMLElement;
  lastPct: number;
  lastShown: boolean;
  lastTarget: boolean;
}

interface SlotRefs {
  readonly def: SkillDef;
  readonly button: HTMLButtonElement;
  readonly cd: HTMLElement;
  readonly cdText: HTMLElement;
  lastFraction: number;
  lastText: string;
  lastNoMana: boolean;
}

/**
 * Combat HUD (HTML/CSS, added to the existing #game-ui root next to the status / inventory panels): target frame,
 * monster health bars, floating damage numbers, hotbar with cooldowns, hit flash, defeat/respawn overlay, and the
 * combat notifications (through the existing toast). It only READS the combat state and calls hooks; per frame it
 * writes to the DOM only what changed.
 */
export class CombatUi {
  private readonly layer = el('div', 'combat-layer');
  private readonly frame = el('section', 'target-frame');
  private readonly frameName = el('span', 'tf-name');
  private readonly frameLevel = el('span', 'tf-level');
  private readonly frameTier = el('span', 'tf-tier');
  private readonly frameFill = el('div', 'fill hp');
  private readonly frameText = el('span', 'tf-hp');
  private readonly frameHint = el('div', 'tf-hint');
  private readonly numbers = el('div', 'dmg-layer');
  private readonly bars = el('div', 'mob-layer');
  private readonly hotbar = el('div', 'hotbar');
  private readonly flash = el('div', 'hurt-flash');
  private readonly death = el('section', 'death-panel');
  private readonly deathCount = el('p', 'death-count');

  private readonly pool: FloatingNumber[] = [];
  private readonly mobBars = new Map<number, MobBar>();
  private readonly slots: SlotRefs[] = [];
  private readonly off: Array<() => void> = [];
  private readonly timers = new Set<number>();
  private readonly lastToast = new Map<string, number>();
  private readonly pt: ScreenPoint = { x: 0, y: 0, visible: false };
  private time = 0;
  private shownTarget = -1;
  private lastFrameHp = -1;
  private lastHint = '';
  private deathShown = false;
  private lastCount = '';
  private disposed = false;

  constructor(
    root: HTMLElement,
    private readonly combat: CombatSystem,
    private readonly state: PlayerState,
    private readonly hooks: CombatUiHooks,
  ) {
    this.buildFrame();
    this.buildHotbar();
    this.buildDeath();
    this.layer.append(this.bars, this.numbers, this.frame, this.hotbar, this.flash, this.death);
    root.append(this.layer);
    this.frame.hidden = true;
    this.death.hidden = true;
    this.off.push(combat.events.on((e) => this.onEvent(e)));
  }

  // ------------------------------------------------------------------------------------------------ build

  private buildFrame(): void {
    const head = el('div', 'tf-head');
    const close = el('button', 'secondary icon-btn tf-close', '✕');
    close.type = 'button';
    close.title = 'Clear target (Esc)';
    close.setAttribute('aria-label', 'Clear target');
    close.addEventListener('click', () => this.hooks.clearTarget());
    head.append(this.frameName, this.frameLevel, this.frameTier, close);
    const track = el('div', 'track');
    track.append(this.frameFill);
    const row = el('div', 'tf-bar');
    row.append(track, this.frameText);
    this.frame.append(head, row, this.frameHint);
    this.frame.setAttribute('aria-label', 'Target');
  }

  private buildHotbar(): void {
    this.hotbar.setAttribute('role', 'toolbar');
    this.hotbar.setAttribute('aria-label', 'Skills');
    for (const def of this.combat.skills.all()) {
      const b = el('button', 'skill');
      b.type = 'button';
      b.dataset.skill = def.id;
      b.setAttribute('aria-label', `${def.name} (key ${def.slot})`);
      b.title = `${def.name} [${def.slot}]${def.manaCost > 0 ? ` · ${def.manaCost} mana` : ''}\n${def.description}`;
      const icon = el('span', 'skill-icon');
      icon.innerHTML = `<svg viewBox="0 0 32 32" width="100%" height="100%" aria-hidden="true" focusable="false">${ICONS[def.icon]}</svg>`; // our own constants
      const key = el('span', 'skill-key', String(def.slot));
      const cd = el('span', 'skill-cd');
      const cdText = el('span', 'skill-cd-text');
      b.append(icon, cd, cdText, key);
      if (def.manaCost > 0) b.append(el('span', 'skill-cost', String(def.manaCost)));
      b.addEventListener('click', () => {
        this.hooks.useSkill(def.id);
        (document.getElementById('game') as HTMLElement | null)?.focus(); // keep the keyboard on the game
      });
      this.hotbar.append(b);
      this.slots.push({ def, button: b, cd, cdText, lastFraction: -1, lastText: '', lastNoMana: false });
    }
  }

  private buildDeath(): void {
    const b = el('button', undefined, 'Respawn now');
    b.type = 'button';
    b.addEventListener('click', () => this.hooks.respawn());
    this.death.append(el('h2', undefined, 'You were defeated'), el('p', undefined, 'Your items and experience are safe.'), this.deathCount, b);
    this.death.setAttribute('role', 'alertdialog');
    this.death.setAttribute('aria-label', 'Defeated');
  }

  // ------------------------------------------------------------------------------------------------ events

  private onEvent(e: CombatEvent): void {
    switch (e.type) {
      case 'damage':
        this.spawnNumber(e.x, e.height, e.z, String(e.amount) + (e.crit ? '!' : ''), e.target.kind === 'player' ? 'to-player' : e.crit ? 'crit' : 'to-monster');
        if (e.target.kind === 'player') this.flashHurt();
        break;
      case 'miss':
        this.spawnNumber(e.x, e.height, e.z, e.target.kind === 'player' ? 'Dodged' : 'Miss', 'miss');
        break;
      case 'monsterKilled':
        this.hooks.notify({ kind: 'success', text: `${e.name} defeated · +${e.xp} XP` });
        break;
      case 'lootDropped': {
        const list = e.drops.map((d) => `${d.name}${d.qty > 1 ? ` ×${d.qty}` : ''}`).join(', ');
        this.hooks.notify(e.backpackFull
          ? { kind: 'warning', text: `Loot: ${list}. Backpack full: it stays on the ground.` }
          : { kind: 'info', text: `Loot: ${list} · press E next to it` });
        break;
      }
      case 'skillFailed': {
        const slot = this.slots.find((s) => s.def.id === e.skillId);
        if (slot) this.pulse(slot.button, 'fail');
        if (e.reason === 'playerDead') break;
        this.toastOnce({ kind: e.reason === 'cooldown' ? 'info' : 'warning', text: e.message });
        if (e.reason === 'outOfRange') this.pulse(this.frame, 'far-pulse');
        break;
      }
      case 'skillUsed': {
        const slot = this.slots.find((s) => s.def.id === e.skillId);
        if (slot) this.pulse(slot.button, 'used');
        break;
      }
      case 'playerDied':
        this.hooks.notify({ kind: 'error', text: 'You were defeated.' });
        break;
      case 'playerRespawned':
        this.hooks.notify({ kind: 'info', text: 'You are back on your feet.' });
        break;
      default:
        break;
    }
  }

  /** The same message is shown at most once per TOAST_COOLDOWN seconds, so mashing a key never floods the screen. */
  private toastOnce(m: GameMessage): void {
    const last = this.lastToast.get(m.text);
    if (last !== undefined && this.time - last < TOAST_COOLDOWN) return;
    this.lastToast.set(m.text, this.time);
    this.hooks.notify(m);
  }

  private pulse(target: HTMLElement, cls: string): void {
    target.classList.remove(cls);
    void target.offsetWidth; // restart the CSS animation
    target.classList.add(cls);
    const id = window.setTimeout(() => {
      this.timers.delete(id);
      target.classList.remove(cls);
    }, 450);
    this.timers.add(id);
  }

  private flashHurt(): void {
    this.pulse(this.flash, 'on');
  }

  private spawnNumber(x: number, height: number, z: number, text: string, cls: string): void {
    let n = this.pool.find((p) => !p.active);
    if (!n) {
      if (this.pool.length < MAX_NUMBERS) {
        n = { el: el('div', 'dmg'), x: 0, y: 0, z: 0, drift: 0, age: 0, active: false };
        this.pool.push(n);
        this.numbers.append(n.el);
      } else {
        n = this.pool.reduce((a, b) => (a.age > b.age ? a : b)); // recycle the oldest
      }
    }
    n.active = true;
    n.age = 0;
    n.x = x;
    n.y = height + 0.4;
    n.z = z;
    n.drift = ((this.pool.indexOf(n) % 5) - 2) * 7; // fan out so simultaneous numbers do not overlap
    n.el.className = `dmg ${cls}`;
    n.el.textContent = text;
    n.el.hidden = false;
  }

  // ------------------------------------------------------------------------------------------------ per frame

  update(dt: number): void {
    if (this.disposed) return;
    this.time += dt;
    this.updateNumbers(dt);
    this.updateFrame();
    this.updateBars();
    this.updateHotbar();
    this.updateDeath();
  }

  private updateNumbers(dt: number): void {
    for (const n of this.pool) {
      if (!n.active) continue;
      n.age += dt;
      if (n.age >= NUMBER_LIFE) {
        n.active = false;
        n.el.hidden = true;
        continue;
      }
      this.hooks.project(n.x, n.y, n.z, this.pt);
      if (!this.pt.visible) {
        n.el.style.opacity = '0';
        continue;
      }
      const t = n.age / NUMBER_LIFE;
      const rise = 46 * (1 - (1 - t) * (1 - t));
      n.el.style.transform = `translate(${Math.round(this.pt.x + n.drift)}px, ${Math.round(this.pt.y - rise)}px) translate(-50%, -50%)`;
      n.el.style.opacity = t < 0.6 ? '1' : String(1 - (t - 0.6) / 0.4);
    }
  }

  private updateFrame(): void {
    const t = this.combat.targeting.target;
    if (!t) {
      if (!this.frame.hidden) this.frame.hidden = true;
      this.shownTarget = -1;
      return;
    }
    if (this.shownTarget !== t.id) {
      this.shownTarget = t.id;
      this.lastFrameHp = -1;
      this.frameName.textContent = t.name;
      this.frameLevel.textContent = `Lv ${t.config.level}`;
      this.frameLevel.className = `tf-level ${this.levelClass(t)}`;
      this.frameTier.textContent = t.config.tier === 'normal' ? '' : t.config.tier;
      this.frameTier.className = `tf-tier ${t.config.tier}`;
      this.frame.hidden = false;
    }
    const hp = Math.ceil(t.hp);
    if (hp !== this.lastFrameHp) {
      this.lastFrameHp = hp;
      this.frameFill.style.width = `${(t.hp / t.maxHp) * 100}%`;
      this.frameText.textContent = `${hp} / ${t.maxHp}`;
    }
    const weapon = weaponProfile(this.combat.equipment);
    const far = this.combat.surfaceDistance(t) > weapon.range;
    const hint = far ? 'Out of range: move closer' : '';
    if (hint !== this.lastHint) {
      this.lastHint = hint;
      this.frameHint.textContent = hint;
      this.frame.classList.toggle('far', far);
    }
  }

  /** Colour class by level difference (grey = easy, yellow = even, red = dangerous). */
  private levelClass(m: Monster): string {
    const diff = m.config.level - this.state.profile.level;
    return diff >= 3 ? 'hard' : diff <= -3 ? 'easy' : 'even';
  }

  private updateBars(): void {
    const target = this.combat.targeting.targetId;
    for (const m of this.combat.monsters.all) {
      let bar = this.mobBars.get(m.id);
      const relevant = m.alive && (m.id === target || m.hp < m.maxHp || m.state === 'aggro' || m.state === 'chase' || m.state === 'attack');
      if (!relevant) {
        if (bar && bar.lastShown) {
          bar.box.hidden = true;
          bar.lastShown = false;
        }
        continue;
      }
      this.hooks.project(m.x, m.height + 0.35, m.z, this.pt);
      const inRange = m.id === target || this.combat.surfaceDistance(m) <= BAR_RANGE;
      const visible = this.pt.visible && inRange;
      if (!bar) {
        const box = el('div', 'mob-bar');
        const track = el('div', 'track');
        const fill = el('div', 'fill hp');
        track.append(fill);
        box.append(track);
        this.bars.append(box);
        bar = { box, fill, lastPct: -1, lastShown: false, lastTarget: false };
        this.mobBars.set(m.id, bar);
      }
      if (visible !== bar.lastShown) {
        bar.lastShown = visible;
        bar.box.hidden = !visible;
      }
      if (!visible) continue;
      const pct = Math.round((m.hp / m.maxHp) * 100);
      if (pct !== bar.lastPct) {
        bar.lastPct = pct;
        bar.fill.style.width = `${pct}%`;
      }
      const isTarget = m.id === target;
      if (isTarget !== bar.lastTarget) {
        bar.lastTarget = isTarget;
        bar.box.classList.toggle('targeted', isTarget);
      }
      bar.box.style.transform = `translate(${Math.round(this.pt.x)}px, ${Math.round(this.pt.y)}px) translate(-50%, -100%)`;
    }
  }

  private updateHotbar(): void {
    const mana = this.state.profile.mana;
    for (const s of this.slots) {
      const f = this.combat.skills.fraction(s.def.id);
      const q = Math.round(f * 50) / 50;
      if (q !== s.lastFraction) {
        s.lastFraction = q;
        s.cd.style.height = `${q * 100}%`;
        s.button.classList.toggle('cooling', q > 0);
      }
      const rem = this.combat.skills.remaining(s.def.id);
      const text = rem > GLOBAL_COOLDOWN + 0.05 ? String(Math.ceil(rem)) : '';
      if (text !== s.lastText) {
        s.lastText = text;
        s.cdText.textContent = text;
      }
      const noMana = mana < s.def.manaCost;
      if (noMana !== s.lastNoMana) {
        s.lastNoMana = noMana;
        s.button.classList.toggle('nomana', noMana);
      }
    }
  }

  private updateDeath(): void {
    const dead = this.combat.playerDead;
    if (dead !== this.deathShown) {
      this.deathShown = dead;
      this.death.hidden = !dead;
      this.hotbar.classList.toggle('disabled', dead);
      this.lastCount = '';
    }
    if (dead) {
      const text = `Respawning in ${Math.ceil(this.combat.respawnIn)} s`;
      if (text !== this.lastCount) {
        this.lastCount = text;
        this.deathCount.textContent = text;
      }
    }
  }

  // ------------------------------------------------------------------------------------------------ lifecycle

  dispose(): void {
    this.disposed = true;
    for (const off of this.off) off();
    this.off.length = 0;
    for (const id of this.timers) window.clearTimeout(id);
    this.timers.clear();
    this.layer.remove();
    this.pool.length = 0;
    this.mobBars.clear();
    this.slots.length = 0;
  }
}
