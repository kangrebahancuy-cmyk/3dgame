import { EQUIP_SLOTS, equipSlotOf, getItem, ITEM_TYPE_LABEL, type EquipSlot, type IconShape, type ItemDef } from '../game/items';
import type { Pickup } from '../game/pickups';
import type { GameMessage } from '../game/playerState';
import type { GameSession } from '../game/session';
import { ATTRIBUTE_IDS, ATTRIBUTE_LABEL, deriveStats, MAX_NAME_LENGTH } from '../game/stats';
import { iconSvg, slotSilhouette } from './icons';

type Selection = { kind: 'bag'; index: number } | { kind: 'worn'; slot: EquipSlot } | null;

export interface PlayerPose {
  x: number;
  z: number;
  yaw: number;
}

const SLOT_LABEL: Readonly<Record<EquipSlot, string>> = { weapon: 'Weapon', helmet: 'Helmet', armor: 'Armor', boots: 'Boots' };
const SLOT_SHAPE: Readonly<Record<EquipSlot, IconShape>> = { weapon: 'sword', helmet: 'helmet', armor: 'armor', boots: 'boots' };
const MAX_TOASTS = 4;
const TOAST_MS = 3200;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** "+4 Attack, +8 % Move speed" for an item; empty string if it has no bonuses. */
export function bonusLines(def: ItemDef): string[] {
  const b = def.bonus;
  if (!b) return [];
  const out: string[] = [];
  if (b.attack) out.push(`+${b.attack} Attack`);
  if (b.defense) out.push(`+${b.defense} Defense`);
  if (b.maxHp) out.push(`+${b.maxHp} Max HP`);
  if (b.moveSpeed) out.push(`+${Math.round(b.moveSpeed * 100)}% Move speed`);
  return out;
}

function tooltip(def: ItemDef, qty?: number): string {
  const lines = [`${def.name}${qty && qty > 1 ? ` ×${qty}` : ''}`, ITEM_TYPE_LABEL[def.type], ...bonusLines(def), def.description];
  return lines.join('\n');
}

/**
 * All DOM UI of the character system: status panel, inventory + equipment + details panel, toasts, interaction prompt.
 * It owns no game data: it renders `session.state` and calls its actions. Updates are event-driven (state changes),
 * except the interaction prompt, which is checked each frame but only touches the DOM when the target changes.
 */
export class GameUi {
  private readonly status = el('section', 'ui-panel');
  private readonly invPanel = el('aside', 'ui-panel inv-panel');
  private readonly toasts = el('div', 'toasts');
  private readonly prompt = el('div', 'prompt');
  private readonly invToggle = el('button', 'inv-toggle');
  private selection: Selection = null;
  private promptUid = -1;
  private renaming = false;
  private open = false;

  private readonly nameSlot = el('div', 'name-row');
  private readonly hpFill = el('div', 'fill hp');
  private readonly mpFill = el('div', 'fill mp');
  private readonly xpFill = el('div', 'fill xp');
  private readonly hpText = el('span');
  private readonly mpText = el('span');
  private readonly xpText = el('span');
  private readonly levelText = el('span', 'level');
  private readonly statsBox = el('div', 'stats-grid');
  private readonly wornBox = el('div', 'worn');
  private readonly grid = el('div', 'grid');
  private readonly details = el('div', 'details');

  constructor(root: HTMLElement, private readonly session: GameSession, private readonly pose: () => PlayerPose) {
    root.append(this.status, this.invPanel, this.toasts, this.prompt);
    this.buildStatus();
    this.buildInventory();
    session.state.onChange(() => this.render());
    session.state.onMessage((m) => this.toast(m));
    // Pickups appearing/disappearing can change what the prompt shows, even when the player stands still.
    session.pickups.onAdd(() => (this.promptUid = -2));
    session.pickups.onRemove(() => (this.promptUid = -2));
    this.prompt.hidden = true;
    this.render();
    this.setOpen(false);
  }

  // ------------------------------------------------------------------------------------------------ public

  get isOpen(): boolean {
    return this.open;
  }

  toggleInventory(): void {
    this.setOpen(!this.open);
  }

  /** Escape: cancel a rename, otherwise close the inventory. */
  closePanels(): void {
    if (this.renaming) return; // the input handles its own Escape
    this.setOpen(false);
  }

  /** Call every frame with the player's ground position. */
  update(x: number, z: number): void {
    const t = this.session.promptTarget(x, z);
    const uid = t ? t.uid : -1;
    if (uid === this.promptUid) return;
    this.promptUid = uid;
    this.showPrompt(t);
  }

  // ------------------------------------------------------------------------------------------------ status

  private buildStatus(): void {
    const bar = (fill: HTMLElement, label: string, text: HTMLElement): HTMLElement => {
      const row = el('div', 'bar-row');
      const track = el('div', 'track');
      track.append(fill);
      const l = el('span', 'bar-label', label);
      text.classList.add('bar-text');
      row.append(l, track, text);
      return row;
    };
    this.invToggle.type = 'button';
    this.invToggle.append('Inventory ', Object.assign(el('kbd'), { textContent: 'I' }));
    this.invToggle.addEventListener('click', () => this.toggleInventory());
    this.status.append(
      this.nameSlot,
      bar(this.hpFill, 'HP', this.hpText),
      bar(this.mpFill, 'MP', this.mpText),
      bar(this.xpFill, 'XP', this.xpText),
      this.invToggle,
    );
    this.status.classList.add('status-panel');
  }

  private renderName(): void {
    if (this.renaming) return;
    const state = this.session.state;
    this.nameSlot.replaceChildren();
    const name = el('button', 'name-btn');
    name.type = 'button';
    name.title = 'Click to rename';
    name.textContent = state.profile.name; // user text: always textContent
    name.addEventListener('click', () => this.startRename());
    this.levelText.textContent = `Lv ${state.profile.level}`;
    this.nameSlot.append(name, this.levelText);
  }

  private startRename(): void {
    if (this.renaming) return;
    this.renaming = true;
    const input = el('input', 'name-input');
    input.type = 'text';
    input.maxLength = MAX_NAME_LENGTH;
    input.value = this.session.state.profile.name;
    input.setAttribute('aria-label', 'Character name');
    input.autocomplete = 'off';
    input.spellcheck = false;
    const finish = (commit: boolean): void => {
      if (!this.renaming) return;
      this.renaming = false;
      if (commit && input.value.trim() !== this.session.state.profile.name) this.session.state.rename(input.value);
      this.renderName(); // also restores the name button if the new name was rejected
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') finish(true);
      else if (e.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
    this.nameSlot.replaceChildren(input, this.levelText);
    input.focus();
    input.select();
  }

  // ------------------------------------------------------------------------------------------------ inventory

  private buildInventory(): void {
    const head = el('div', 'panel-head');
    const close = el('button', 'secondary icon-btn', '✕');
    close.type = 'button';
    close.title = 'Close (Esc or I)';
    close.setAttribute('aria-label', 'Close inventory');
    close.addEventListener('click', () => this.setOpen(false));
    head.append(el('h2', undefined, 'Inventory'), close);
    this.invPanel.append(head, el('h3', undefined, 'Equipment'), this.wornBox, this.statsBox, el('h3', undefined, 'Backpack'), this.grid, this.details);
    this.invPanel.setAttribute('role', 'dialog');
    this.invPanel.setAttribute('aria-label', 'Inventory');
  }

  private setOpen(open: boolean): void {
    this.open = open;
    this.invPanel.hidden = !open;
    this.invToggle.setAttribute('aria-expanded', String(open));
    if (open) this.render();
  }

  private slotButton(opts: { def: ItemDef | null; qty?: number; label?: string; selected: boolean; emptyShape?: IconShape; onClick: () => void }): HTMLButtonElement {
    const b = el('button', 'slot');
    b.type = 'button';
    if (opts.selected) b.classList.add('selected');
    if (opts.def) {
      b.classList.add('filled');
      b.innerHTML = iconSvg(opts.def.icon.shape, opts.def.icon.color); // our own SVG constants
      b.title = tooltip(opts.def, opts.qty);
      b.setAttribute('aria-label', `${opts.def.name}${opts.qty && opts.qty > 1 ? ` ×${opts.qty}` : ''}`);
      if (opts.qty && opts.qty > 1) b.append(el('span', 'qty', String(opts.qty)));
    } else {
      b.classList.add('empty');
      if (opts.emptyShape) {
        b.innerHTML = slotSilhouette(opts.emptyShape);
        b.title = `${opts.label ?? 'Empty'} (empty)`;
      } else b.title = 'Empty slot';
      b.setAttribute('aria-label', opts.label ? `${opts.label}, empty` : 'Empty slot');
    }
    b.addEventListener('click', opts.onClick);
    return b;
  }

  private select(sel: Selection): void {
    this.selection = sel;
    this.renderInventory();
  }

  private renderInventory(): void {
    const state = this.session.state;
    const sel = this.selection;

    // equipment
    this.wornBox.replaceChildren();
    for (const slot of EQUIP_SLOTS) {
      const id = state.equipment.get(slot);
      const cell = el('div', 'worn-cell');
      const btn = this.slotButton({
        def: id ? getItem(id) : null,
        label: SLOT_LABEL[slot],
        emptyShape: SLOT_SHAPE[slot],
        selected: sel?.kind === 'worn' && sel.slot === slot,
        onClick: () => this.select(id ? { kind: 'worn', slot } : null),
      });
      cell.append(btn, el('span', 'cell-label', id ? getItem(id).name : SLOT_LABEL[slot]));
      this.wornBox.append(cell);
    }

    // final stats (what the equipment adds is shown in brackets)
    const s = state.stats;
    const base = deriveStats(state.profile, []);
    const add = (label: string, value: string, extra?: string): void => {
      const row = el('div', 'stat');
      row.append(el('span', 'k', label), el('span', 'v', value));
      if (extra) row.lastElementChild!.append(el('em', undefined, ` ${extra}`));
      this.statsBox.append(row);
    };
    this.statsBox.replaceChildren();
    add('Attack', String(s.attack), s.attack !== base.attack ? `(+${s.attack - base.attack})` : undefined);
    add('Defense', String(s.defense), s.defense !== base.defense ? `(+${s.defense - base.defense})` : undefined);
    add('Max HP', String(s.maxHp), s.maxHp !== base.maxHp ? `(+${s.maxHp - base.maxHp})` : undefined);
    const spd = Math.round((s.moveSpeedMultiplier - 1) * 100);
    add('Move speed', `${100 + spd}%`, spd > 0 ? `(+${spd}%)` : undefined);
    for (const a of ATTRIBUTE_IDS) add(ATTRIBUTE_LABEL[a], String(state.profile.attributes[a]));

    // backpack grid
    this.grid.replaceChildren();
    for (let i = 0; i < state.inventory.capacity; i++) {
      const st = state.inventory.at(i);
      this.grid.append(
        this.slotButton({
          def: st ? getItem(st.id) : null,
          qty: st?.qty,
          selected: sel?.kind === 'bag' && sel.index === i,
          onClick: () => this.select(st ? { kind: 'bag', index: i } : null),
        }),
      );
    }
    this.grid.setAttribute('aria-label', `Backpack, ${state.inventory.capacity - state.inventory.freeSlots} of ${state.inventory.capacity} slots used`);
    this.renderDetails();
  }

  private renderDetails(): void {
    const state = this.session.state;
    const sel = this.selection;
    this.details.replaceChildren();
    let def: ItemDef | null = null;
    let qty = 1;
    if (sel?.kind === 'bag') {
      const st = state.inventory.at(sel.index);
      if (st) { def = getItem(st.id); qty = st.qty; }
    } else if (sel?.kind === 'worn') {
      const id = state.equipment.get(sel.slot);
      if (id) def = getItem(id);
    }
    if (!def || !sel) {
      this.selection = null;
      this.details.append(el('p', 'hint', `Select an item to see its details. ${state.inventory.capacity - state.inventory.freeSlots}/${state.inventory.capacity} slots used.`));
      return;
    }

    const top = el('div', 'detail-top');
    const icon = el('div', 'detail-icon');
    icon.innerHTML = iconSvg(def.icon.shape, def.icon.color);
    const text = el('div');
    text.append(
      el('div', 'detail-name', `${def.name}${qty > 1 ? ` ×${qty}` : ''}`),
      el('div', 'detail-type', sel.kind === 'worn' ? `${ITEM_TYPE_LABEL[def.type]} · equipped` : ITEM_TYPE_LABEL[def.type]),
    );
    top.append(icon, text);
    this.details.append(top, el('p', 'detail-desc', def.description));
    const bl = bonusLines(def);
    if (bl.length) this.details.append(el('p', 'detail-bonus', bl.join(' · ')));

    const actions = el('div', 'actions');
    const button = (label: string, onClick: () => void, disabledReason?: string, secondary = false): void => {
      const b = el('button', secondary ? 'secondary' : undefined, label);
      b.type = 'button';
      if (disabledReason) {
        b.disabled = true;
        b.title = disabledReason;
      }
      b.addEventListener('click', onClick);
      actions.append(b);
    };

    if (sel.kind === 'worn') {
      const slot = sel.slot;
      button('Unequip', () => {
        if (state.unequip(slot).ok) this.selection = null;
        this.renderInventory();
      }, state.inventory.isFull ? 'Inventory full: free a slot first' : undefined);
    } else {
      const index = sel.index;
      if (def.type === 'consumable') {
        const full = def.use?.healHp !== undefined && state.profile.hp >= state.stats.maxHp;
        button('Use', () => {
          state.use(index);
          if (!state.inventory.at(index)) this.selection = null;
          this.renderInventory();
        }, full ? 'HP is already full' : undefined);
      }
      const target = equipSlotOf(def);
      if (target) {
        button('Equip', () => {
          if (state.equip(index).ok) this.selection = { kind: 'worn', slot: target };
          this.renderInventory();
        });
      }
      const drop = (n: number | 'all'): void => {
        const p = this.pose();
        this.session.drop(index, n, p.x, p.z, p.yaw);
        if (!state.inventory.at(index)) this.selection = null;
        this.renderInventory();
      };
      button(qty > 1 ? 'Drop 1' : 'Drop', () => drop(1), undefined, true);
      if (qty > 1) button(`Drop all (${qty})`, () => drop('all'), undefined, true);
    }
    this.details.append(actions);
  }

  // ------------------------------------------------------------------------------------------------ render

  private render(): void {
    const state = this.session.state;
    const p = state.profile, s = state.stats;
    this.renderName();
    const pct = (v: number, max: number): string => `${Math.max(0, Math.min(100, max > 0 ? (v / max) * 100 : 0)).toFixed(1)}%`;
    this.hpFill.style.width = pct(p.hp, s.maxHp);
    this.mpFill.style.width = pct(p.mana, s.maxMana);
    this.xpFill.style.width = pct(p.xp, s.xpToNext);
    this.hpText.textContent = `${Math.round(p.hp)} / ${s.maxHp}`;
    this.mpText.textContent = `${Math.round(p.mana)} / ${s.maxMana}`;
    this.xpText.textContent = `${p.xp} / ${s.xpToNext}`;
    this.hpFill.classList.toggle('low', p.hp / s.maxHp < 0.25);
    if (this.open) this.renderInventory();
  }

  // ------------------------------------------------------------------------------------------------ toasts / prompt

  private toast(m: GameMessage): void {
    const t = el('div', `toast ${m.kind}`, m.text);
    this.toasts.append(t);
    while (this.toasts.childElementCount > MAX_TOASTS) this.toasts.firstElementChild?.remove();
    window.setTimeout(() => {
      t.classList.add('out');
      window.setTimeout(() => t.remove(), 300);
    }, TOAST_MS);
  }

  private showPrompt(p: Pickup | null): void {
    if (!p) {
      this.prompt.hidden = true;
      return;
    }
    const def = getItem(p.id);
    this.prompt.replaceChildren(el('kbd', undefined, 'E'), ` Pick up `, el('strong', undefined, `${def.name}${p.qty > 1 ? ` ×${p.qty}` : ''}`));
    this.prompt.hidden = false;
  }
}
