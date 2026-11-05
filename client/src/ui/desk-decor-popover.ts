// Popover de decoração da própria mesa (Adendo D.4). `.of-panel` de 360 px ancorado à mesa
// (modal no celular), prévia da mesa "clean" @4x sobre o piso da área, três colunas
// (Esquerda / Direita / Fundo) com os 12 itens + "Nenhum" + variantes. Salvar -> PUT
// /api/me/desk/decor; a decoração só vale localmente quando o broadcast `desk` chega.
import {
  DESK_ITEMS, DESK_ITEM_KINDS, DESK_SLOTS, deskDecorPlacements, isEmptyDecor, normalizeDecor,
  type DeskDecor, type DeskItemKind, type DeskSlot,
} from '../../../shared/desk-decor';
import type { DeskDef, OfficeAssembly } from '../../../shared/map/types';
import type { ArtModule } from '../art/api';
import { ApiError, api as defaultApi } from '../net/api';
import type { OfficeClientStore } from '../net/world-store';
import type { WorldApi } from '../world/api';
import { t, type MessageKey } from '../i18n';
import { h } from './dom';
import type { Notice } from './toasts';
import './desk-meeting.css';

const SLOT_KEY: Readonly<Record<DeskSlot, MessageKey>> = { left: 'shell.decor.slot.left', right: 'shell.decor.slot.right', back: 'shell.decor.slot.back' };
/** Nome do slot (coluna), no idioma atual. */
export function slotLabel(slot: DeskSlot): string {
  return t(SLOT_KEY[slot]);
}
/** Nome do item do catálogo, no idioma atual. */
export function itemLabel(kind: DeskItemKind): string {
  return t(DESK_ITEMS[kind].label);
}
/** Nome da variante (cor/estilo), no idioma atual; ids desconhecidos aparecem como estão. */
export function variantLabel(variant: string): string {
  const key = VARIANT_LABEL_KEYS[variant];
  return key ? t(key) : variant;
}
export const PREVIEW_SCALE = 4;
export const THUMB_SCALE = 3;

/** Cor representativa de cada variante (swatches). */
export const VARIANT_COLORS: Readonly<Record<string, string>> = {
  fern: '#4bab72', succulent: '#3f8a62', flower: '#e810b3',
  red: '#e2604f', blue: '#3f7fd8', yellow: '#ffd800', white: '#f4f2ee', black: '#2b2b33',
  wood: '#b98a5e',
  hero: '#d94141', robot: '#04d1d1', dino: '#4bab72',
  warm: '#e2604f', cool: '#4bab72', accent: '#7c9cff',
  round: '#4bab72', tall: '#3f8a62', flowering: '#e810b3',
  pink: '#e810b3', cyan: '#04d1d1',
  gold: '#f2c14e', silver: '#d9dde3', bronze: '#b88752',
  sticker: '#aeb6c2',
};

/** Chave da mensagem de cada variante (shell.decor.v.<variante>). */
const VARIANT_LABEL_KEYS: Readonly<Record<string, MessageKey>> = {
  fern: 'shell.decor.v.fern', succulent: 'shell.decor.v.succulent', flower: 'shell.decor.v.flower',
  red: 'shell.decor.v.red', blue: 'shell.decor.v.blue', yellow: 'shell.decor.v.yellow', white: 'shell.decor.v.white', black: 'shell.decor.v.black',
  wood: 'shell.decor.v.wood',
  hero: 'shell.decor.v.hero', robot: 'shell.decor.v.robot', dino: 'shell.decor.v.dino',
  warm: 'shell.decor.v.warm', cool: 'shell.decor.v.cool', accent: 'shell.decor.v.accent',
  round: 'shell.decor.v.round', tall: 'shell.decor.v.tall', flowering: 'shell.decor.v.flowering',
  pink: 'shell.decor.v.pink', cyan: 'shell.decor.v.cyan',
  gold: 'shell.decor.v.gold', silver: 'shell.decor.v.silver', bronze: 'shell.decor.v.bronze',
  sticker: 'shell.decor.v.sticker',
};

// ------------------------------------------------------------------ helpers puros

const emptyDecor = (): DeskDecor => ({ slots: {} });

/** Chave canônica de uma decoração (null e vazia são iguais). */
export function decorKey(d: DeskDecor | null | undefined): string {
  const n = normalizeDecor(d);
  if (!n) return '';
  return DESK_SLOTS.map((s) => {
    const it = n.slots[s];
    return it ? `${s}:${it.kind}:${it.variant}` : '';
  }).join('|');
}

/** Duas decorações são equivalentes? (usado para desabilitar "Salvar"). */
export function decorUnchanged(a: DeskDecor | null | undefined, b: DeskDecor | null | undefined): boolean {
  return decorKey(a) === decorKey(b);
}

export function slotAllows(kind: DeskItemKind, slot: DeskSlot): boolean {
  return (DESK_ITEMS[kind].slots as readonly string[]).includes(slot);
}

/** Coloca (ou remove, com `kind` null) o item de um slot. Mantém a variante se o item não mudou. */
export function withSlotItem(draft: DeskDecor | null, slot: DeskSlot, kind: DeskItemKind | null, variant?: string): DeskDecor {
  const slots = { ...(draft?.slots ?? {}) };
  if (kind === null) {
    delete slots[slot];
    return { slots };
  }
  if (!slotAllows(kind, slot)) return { slots };
  const variants = DESK_ITEMS[kind].variants as readonly string[];
  const prev = slots[slot];
  const v = variant && variants.includes(variant) ? variant : prev?.kind === kind ? prev.variant : variants[0];
  slots[slot] = { kind, variant: v };
  return { slots };
}

// ------------------------------------------------------------------ prévia

/** Janela (px de mundo) desenhada na prévia: a mesa 32x16 com folga para itens altos e o monitor. */
const PREVIEW = { w: 48, h: 44, offX: 8, offY: 26 } as const;

function drawPreview(canvas: HTMLCanvasElement, art: ArtModule, assembly: OfficeAssembly, desk: DeskDef, decor: DeskDecor | null): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const buf = document.createElement('canvas');
  buf.width = PREVIEW.w;
  buf.height = PREVIEW.h;
  const b = buf.getContext('2d');
  if (!b) return;
  const wx = desk.tx * 16 + desk.dx - PREVIEW.offX;
  const wy = desk.ty * 16 - PREVIEW.offY;
  b.fillStyle = '#d9dde2';
  b.fillRect(0, 0, PREVIEW.w, PREVIEW.h);
  b.save();
  b.translate(-wx, -wy);
  const area = assembly.areaById.get(desk.areaId);
  for (const f of area?.floors ?? []) {
    const x0 = Math.max(f.x, wx);
    const y0 = Math.max(f.y, wy);
    const x1 = Math.min(f.x + f.w, wx + PREVIEW.w);
    const y1 = Math.min(f.y + f.h, wy + PREVIEW.h);
    if (x1 <= x0 || y1 <= y0) continue;
    try {
      art.drawFloor(b, f.kind, x0, y0, x1 - x0, y1 - y0, { seed: f.seed, tint: f.tint, tint2: f.tint2, tintK: f.tintK });
    } catch {
      /* fica o fundo liso */
    }
  }
  b.restore();
  try {
    const fs = art.furnitureSprites(desk.kind, undefined, 0, { clean: true });
    const s = fs.base;
    // Footprint 2x1: âncora = centro da base.
    const fx = PREVIEW.offX;
    const fy = PREVIEW.offY;
    b.drawImage(s.canvas, Math.round(fx + 16 - s.ax), Math.round(fy + 16 - s.ay));
    if (typeof art.deskItemSprite === 'function') {
      for (const p of deskDecorPlacements(decor)) {
        const sp = art.deskItemSprite(p.kind, p.variant);
        b.drawImage(sp.canvas, Math.round(fx + p.x), Math.round(fy + p.baseY - sp.ay));
      }
    }
  } catch {
    /* sem arte: só o piso */
  }
  canvas.width = PREVIEW.w * PREVIEW_SCALE;
  canvas.height = PREVIEW.h * PREVIEW_SCALE;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(buf, 0, 0, canvas.width, canvas.height);
}

function thumb(art: ArtModule, kind: DeskItemKind, variant: string): HTMLCanvasElement {
  const { w, h: hh } = DESK_ITEMS[kind].size;
  const c = document.createElement('canvas');
  c.width = w * THUMB_SCALE;
  c.height = hh * THUMB_SCALE;
  c.className = 'of-decor__thumb-cv';
  const ctx = c.getContext('2d');
  if (ctx && typeof art.deskItemSprite === 'function') {
    ctx.imageSmoothingEnabled = false;
    try {
      ctx.drawImage(art.deskItemSprite(kind, variant).canvas, 0, 0, c.width, c.height);
    } catch {
      /* miniatura em branco */
    }
  }
  return c;
}

// ------------------------------------------------------------------ componente

export interface DeskDecorPopoverDeps {
  store: OfficeClientStore;
  world: Pick<WorldApi, 'minimapSource' | 'screenPositionOf'>;
  art: ArtModule;
  toast?: { push(n: Notice): void };
  /** Injetável nos testes; padrão: cliente HTTP da API. */
  api?: Pick<typeof defaultApi, 'put'>;
}

export interface DeskDecorPopoverHandle {
  /** Abre para a MINHA mesa `deskId`, perto do ponto (px CSS) ou da mesa na tela. */
  open(deskId: string, anchor?: { x: number; y: number }): void;
  close(): void;
  isOpen(): boolean;
  destroy(): void;
}

const MOBILE_QUERY = '(max-width: 640px)';

export function mountDeskDecorPopover(slot: HTMLElement, deps: DeskDecorPopoverDeps): DeskDecorPopoverHandle {
  const { store, art } = deps;
  const http = deps.api ?? defaultApi;
  let root: HTMLElement | null = null;
  let offs: Array<() => void> = [];

  const close = (): void => {
    for (const f of offs) f();
    offs = [];
    root?.remove();
    root = null;
  };

  const open = (deskId: string, anchor?: { x: number; y: number }): void => {
    close();
    const assembly = deps.world.minimapSource().assembly;
    const desk = assembly.deskById.get(deskId);
    const state = store.desks.get(deskId);
    if (!desk || !state || state.userId !== store.selfId) return;

    let baseline: DeskDecor | null = normalizeDecor(state.decor);
    let draft: DeskDecor = baseline ?? emptyDecor();
    let saving = false;

    const preview = h('canvas', { class: 'of-decor__preview', attrs: { 'aria-label': t('shell.decor.preview'), role: 'img' } });
    const cols = h('div', { class: 'of-decor__cols' });
    const save = h('button', { class: 'of-btn of-btn--primary of-btn--sm', type: 'button', text: t('common.save') });
    const clear = h('button', { class: 'of-btn of-btn--transparent of-btn--sm', type: 'button', text: t('shell.decor.clear') });
    const cancel = h('button', { class: 'of-btn of-btn--secondary of-btn--sm', type: 'button', text: t('common.cancel') });
    const err = h('p', { class: 'of-decor__err', role: 'alert', hidden: true });

    const panel = h(
      'div',
      { class: 'of-panel of-panel--float of-decor', role: 'dialog', attrs: { 'aria-label': t('shell.decor.dialogLabel', { label: desk.label }), 'aria-modal': 'true' } },
      h('h3', { class: 'of-decor__title', text: t('shell.decor.title', { label: desk.label }) }),
      preview,
      cols,
      err,
      h('div', { class: 'of-decor__actions' }, clear, h('span', { class: 'of-decor__spacer' }), cancel, save),
    );

    const mobile = typeof matchMedia === 'function' && matchMedia(MOBILE_QUERY).matches;
    if (mobile) {
      const overlay = h('div', { class: 'of-modal-overlay of-decor__overlay' }, panel);
      overlay.addEventListener('pointerdown', (ev) => {
        if (ev.target === overlay) close();
      });
      panel.classList.add('of-decor--modal');
      root = overlay;
    } else {
      root = panel;
    }

    const refresh = (): void => {
      drawPreview(preview, art, assembly, desk, draft);
      save.disabled = saving || decorUnchanged(draft, baseline);
      clear.disabled = saving || isEmptyDecor(draft);
      cancel.disabled = saving;
      renderCols();
    };

    const renderCols = (): void => {
      cols.replaceChildren();
      for (const slotId of DESK_SLOTS) {
        const cur = draft.slots[slotId];
        const col = h('div', { class: 'of-decor__col' }, h('h4', { class: 'of-decor__col-title', text: slotLabel(slotId) }));
        const grid = h('div', { class: 'of-decor__grid', role: 'radiogroup', attrs: { 'aria-label': slotLabel(slotId) } });
        const none = h('button', {
          class: `of-decor__thumb of-decor__thumb--none${cur ? '' : ' is-selected'}`,
          type: 'button',
          title: t('shell.decor.none'),
          role: 'radio',
          text: t('shell.decor.none'),
          attrs: { 'aria-checked': !cur },
          on: {
            click: () => {
              draft = withSlotItem(draft, slotId, null);
              refresh();
            },
          },
        });
        grid.append(none);
        for (const kind of DESK_ITEM_KINDS) {
          const ok = slotAllows(kind, slotId);
          const selected = cur?.kind === kind;
          const b = h('button', {
            class: `of-decor__thumb${selected ? ' is-selected' : ''}${ok ? '' : ' is-disabled'}`,
            type: 'button',
            title: ok ? itemLabel(kind) : t('shell.decor.notHere', { label: itemLabel(kind) }),
            role: 'radio',
            attrs: { 'aria-checked': selected, 'aria-disabled': !ok, 'aria-label': itemLabel(kind) },
            on: {
              click: () => {
                if (!ok) return;
                draft = withSlotItem(draft, slotId, kind);
                refresh();
              },
            },
          });
          if (!ok) b.disabled = true;
          b.append(thumb(art, kind, cur?.kind === kind ? cur.variant : DESK_ITEMS[kind].variants[0]));
          grid.append(b);
        }
        col.append(grid);
        const sw = h('div', { class: 'of-decor__swatches', role: 'radiogroup', attrs: { 'aria-label': t('shell.decor.variant', { slot: slotLabel(slotId) }) } });
        if (cur) {
          for (const v of DESK_ITEMS[cur.kind].variants as readonly string[]) {
            const s = h('button', {
              class: `of-swatch${cur.variant === v ? ' is-selected' : ''}`,
              type: 'button',
              title: variantLabel(v),
              role: 'radio',
              style: `--swatch:${VARIANT_COLORS[v] ?? '#8a8f98'}`,
              attrs: { 'aria-checked': cur.variant === v, 'aria-label': variantLabel(v) },
              on: {
                click: () => {
                  draft = withSlotItem(draft, slotId, cur.kind, v);
                  refresh();
                },
              },
            });
            sw.append(s);
          }
        }
        col.append(sw);
        cols.append(col);
      }
    };

    clear.addEventListener('click', () => {
      draft = emptyDecor();
      refresh();
    });
    cancel.addEventListener('click', close);
    save.addEventListener('click', () => {
      if (saving || decorUnchanged(draft, baseline)) return;
      saving = true;
      err.hidden = true;
      refresh();
      http
        .put('/api/me/desk/decor', { decor: draft })
        .then(() => {
          deps.toast?.push({ level: 'success', text: t('shell.decor.saved'), at: Date.now() });
          close();
        })
        .catch((e: unknown) => {
          saving = false;
          err.textContent = e instanceof ApiError ? e.message : t('shell.decor.saveError');
          err.hidden = false;
          refresh();
        });
    });

    // A decoração real só muda quando o `desk` chega do servidor.
    offs.push(
      store.on('desk', (d) => {
        if (d.id !== deskId) return;
        if (d.userId !== store.selfId) return close();
        const wasUnchanged = decorUnchanged(draft, baseline);
        baseline = normalizeDecor(d.decor);
        if (wasUnchanged) draft = baseline ?? emptyDecor();
        refresh();
      }),
    );
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === 'Escape') {
        ev.stopPropagation();
        close();
      }
    };
    document.addEventListener('keydown', onKey, true);
    offs.push(() => document.removeEventListener('keydown', onKey, true));
    if (!mobile) {
      const onDown = (ev: PointerEvent): void => {
        if (root && !root.contains(ev.target as Node) && !(ev.target as HTMLElement).closest?.('.of-ctx')) close();
      };
      // Registrado no próximo tick: o clique que abriu não pode fechar.
      const t = setTimeout(() => document.addEventListener('pointerdown', onDown, true), 0);
      offs.push(() => {
        clearTimeout(t);
        document.removeEventListener('pointerdown', onDown, true);
      });
    }

    slot.append(root);
    refresh();

    if (!mobile) {
      const pt = anchor ?? deps.world.screenPositionOf(store.selfId ?? -1) ?? { x: innerWidth / 2, y: innerHeight / 2 };
      const w = panel.offsetWidth || 360;
      const hgt = panel.offsetHeight;
      const left = pt.x + 24 + w > innerWidth - 8 ? pt.x - 24 - w : pt.x + 24;
      panel.style.left = `${Math.round(Math.max(8, Math.min(left, innerWidth - w - 8)))}px`;
      panel.style.top = `${Math.round(Math.max(8, Math.min(pt.y - hgt / 2, innerHeight - hgt - 8)))}px`;
    }
    (panel.querySelector('.of-decor__thumb:not([disabled])') as HTMLElement | null)?.focus({ preventScroll: true });
  };

  return {
    open,
    close,
    isOpen: () => root !== null,
    destroy: close,
  };
}
