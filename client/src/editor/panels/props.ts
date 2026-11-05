// Propriedades da seleção: móvel, item de parede, tapete, passagem, área, zona, ponto, entrada; com
// várias coisas selecionadas, ações em lote; sem seleção, o próprio mapa (nome, tamanho, contagens).
import { absId } from '../../../../shared/map/spots';
import type { AreaKind, MapArea, MapZone, OfficeMapDoc, ZoneKind } from '../../../../shared/map/doc';
import { FURNITURE, type Dir, type WallStyle } from '../../../../shared/map/furniture';
import { WALLS } from '../../../../shared/map/palette';
import { t, type MessageKey } from '../../i18n';
import { h } from '../../ui/dom';
import type { EditorCtx } from '../context';
import { areaRectProblem, moveAreaOps, refBounds, resizeArea } from '../geometry';
import { AREA_KINDS, areaKindLabel, dirLabel, furnitureLabel, spotLabel, wallPresetLabel, ZONE_KINDS, zoneKindLabel } from '../labels';
import { batch, propOp, updateOp } from '../ops';
import type { SelectTool } from '../tools/select';
import { refKey, resolve, type Ref, type Resolved } from '../types';
import { doorwayProblem } from '../tools/doorway';
import { button, checkbox, colorInput, numInput, row, section, selectInput, textInput } from './ui';

const DIR_FURN = new Set(['stool', 'bench', 'beanbag']);

export interface PropsPanel {
  el: HTMLElement;
  refresh(force?: boolean): void;
  focus(name: string): void;
}

export function createProps(ctx: EditorCtx, sel: SelectTool): PropsPanel {
  const el = h('div', { class: 'med-props' });
  let lastKey = '';
  let lastDoc: OfficeMapDoc | null = null;
  let pending = false;
  let wantFocus: string | null = null;

  const dirs = (): readonly (readonly [Dir, string])[] => (['down', 'up', 'left', 'right'] as const).map((d) => [d, dirLabel(d)] as const);

  /** Troca o item da referência (resolvido de novo no documento atual). `label` = chave `editor.op.*`. */
  const commit = (ref: Ref, label: MessageKey, patch: (r: Resolved) => unknown): void => {
    if (ctx.readOnly()) return;
    const doc = ctx.doc();
    const r = resolve(doc, ref);
    if (!r) return;
    const after = patch(r);
    if (after === undefined || JSON.stringify(after) === JSON.stringify(r.item)) return;
    ctx.exec(batch(label, [updateOp(doc, r.at, r.index, after)]));
  };

  const clean = <T extends object>(o: T): T => {
    const out = { ...o } as Record<string, unknown>;
    for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
    return out as T;
  };

  function render(): void {
    const doc = ctx.doc();
    const refs = ctx.state.selection;
    el.replaceChildren();
    const ro = ctx.readOnly();
    if (!refs.length) el.append(...docProps(doc));
    else if (refs.length > 1) el.append(...multiProps(refs));
    else {
      const r = resolve(doc, refs[0]);
      if (!r) el.append(h('p', { class: 'med-hint', text: t('editor.props.gone') }));
      else el.append(...itemProps(doc, refs[0], r));
    }
    if (ro) for (const i of el.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>('input,select,button')) i.disabled = true;
    if (wantFocus) {
      const f = el.querySelector<HTMLElement>(`[data-prop="${wantFocus}"]`);
      wantFocus = null;
      if (f) {
        f.focus();
        if (f instanceof HTMLInputElement) f.select();
      }
    }
  }

  function docProps(doc: OfficeMapDoc): HTMLElement[] {
    const c = ctx.scene.counts();
    const sizeOk = (w: number, hh: number) => doc.areas.every((a) => a.rect.x + a.rect.w <= w && a.rect.y + a.rect.h <= hh);
    return [
      section(
        t('editor.props.map'),
        row(t('editor.props.name'), textInput(doc.name, (v) => v.trim() && ctx.exec(batch('editor.op.renameMap', [propOp(doc, 'name', v.trim().slice(0, 64))])), { name: 'name', max: 64 })),
        h(
          'div',
          { class: 'med-row2' },
          row(t('editor.props.width'), numInput(doc.size.w, (v) => {
            if (v === undefined || v < 8 || v > 200 || !sizeOk(v, doc.size.h)) return ctx.toast(t('editor.props.widthRange'), 'error');
            ctx.exec(batch('editor.op.mapSize', [propOp(doc, 'size', { w: Math.round(v), h: doc.size.h })]));
          }, { min: 8, max: 200 })),
          row(t('editor.props.height'), numInput(doc.size.h, (v) => {
            if (v === undefined || v < 8 || v > 200 || !sizeOk(doc.size.w, v)) return ctx.toast(t('editor.props.heightRange'), 'error');
            ctx.exec(batch('editor.op.mapSize', [propOp(doc, 'size', { w: doc.size.w, h: Math.round(v) })]));
          }, { min: 8, max: 200 })),
        ),
        h(
          'dl',
          { class: 'med-stats' },
          ...([
            [t('editor.props.stat.areas'), c.areas],
            [t('editor.props.stat.furniture'), c.furniture],
            [t('editor.props.stat.desks'), c.desks],
            [t('editor.props.stat.seats'), c.seats],
            [t('editor.props.stat.zones'), c.zones],
            [t('editor.props.stat.spawns'), doc.spawn.length],
          ] as const).flatMap(([k, v]) => [h('dt', { text: k }), h('dd', { text: String(v) })]),
        ),
        h('p', { class: 'med-hint', text: t('editor.props.selectHint') }),
      ),
    ];
  }

  function multiProps(refs: readonly Ref[]): HTMLElement[] {
    return [
      section(
        t('editor.props.multi', { n: refs.length }),
        h('div', { class: 'med-actions' }, button(t('editor.props.rotate'), () => sel.rotate(false)), button(t('editor.props.variant'), () => sel.cycle(1)), button(t('editor.props.duplicate'), () => sel.duplicate()), button(t('editor.props.delete'), () => sel.del(), 'danger')),
      ),
    ];
  }

  function head(title: string, sub: string): HTMLElement {
    return h('div', { class: 'med-props__head' }, h('strong', { text: title }), h('code', { class: 'med-id', text: sub }));
  }

  function itemProps(doc: OfficeMapDoc, ref: Ref, r: Resolved): HTMLElement[] {
    const actions = (...extra: HTMLElement[]) => h('div', { class: 'med-actions' }, ...extra, button(t('editor.props.center'), () => {
      const b = refBounds(ctx.doc(), ref);
      if (b) ctx.centerOn(b);
    }), button(t('editor.props.delete'), () => sel.del(), 'danger'));
    switch (r.t) {
      case 'furn': {
        const f = r.item;
        const def = FURNITURE[f.kind];
        const out: HTMLElement[] = [head(furnitureLabel(f.kind), absId(r.area.id, f.id))];
        const fields: HTMLElement[] = [];
        if (def.variants?.length) fields.push(row(t('editor.props.variant'), selectInput(f.variant ?? def.variants[0], def.variants.map((v) => [v, v] as const), (v) => commit(ref, 'editor.op.variant', (x) => ({ ...x.item, variant: v })), { name: 'variant' })));
        if (DIR_FURN.has(f.kind)) fields.push(row(t('editor.props.sitDir'), selectInput(f.dir ?? 'down', dirs(), (v) => commit(ref, 'editor.op.direction', (x) => ({ ...x.item, dir: v })), { name: 'dir' })));
        fields.push(
          h(
            'div',
            { class: 'med-row2' },
            row(t('editor.props.xLocal'), numInput(f.lx, (v) => v !== undefined && commit(ref, 'editor.op.position', (x) => ({ ...x.item, lx: Math.round(v) })))),
            row(t('editor.props.yLocal'), numInput(f.ly, (v) => v !== undefined && commit(ref, 'editor.op.position', (x) => ({ ...x.item, ly: Math.round(v) })))),
          ),
          h(
            'div',
            { class: 'med-row2' },
            row(t('editor.props.offsetX'), numInput(f.dx, (v) => commit(ref, 'editor.op.offset', (x) => clean({ ...x.item, dx: v === undefined || v === 0 ? undefined : Math.max(-32, Math.min(32, Math.round(v))) })), { min: -32, max: 32, placeholder: '0' })),
            row(t('editor.props.offsetY'), numInput(f.dy, (v) => commit(ref, 'editor.op.offset', (x) => clean({ ...x.item, dy: v === undefined || v === 0 ? undefined : Math.max(-32, Math.min(32, Math.round(v))) })), { min: -32, max: 32, placeholder: '0' })),
          ),
        );
        if (f.kind === 'desk' || f.kind === 'desk_back') {
          const deskId = absId(r.area.id, f.id);
          const desk = ctx.scene.assembly()?.deskById.get(deskId);
          const cur = doc.deskLabels?.[deskId] ?? '';
          fields.push(
            row(
              t('editor.props.deskLabel'),
              textInput(cur, (v) => {
                const d = ctx.doc();
                const labels = { ...(d.deskLabels ?? {}) };
                if (v.trim()) labels[deskId] = v.trim().slice(0, 48);
                else delete labels[deskId];
                ctx.exec(batch('editor.op.deskLabel', [propOp(d, 'deskLabels', Object.keys(labels).length ? labels : undefined)]));
              }, { name: 'deskLabel', max: 48, placeholder: desk?.code ?? t('editor.props.autoCode') }),
              desk ? t('editor.props.code', { code: desk.code }) : t('editor.props.noChair'),
            ),
          );
        }
        out.push(section(t('editor.props.furniture'), ...fields), actions(button(t('editor.props.rotate'), () => sel.rotate(false))));
        return out;
      }
      case 'wall': {
        const w = r.item;
        const def = FURNITURE[w.kind];
        const fields: HTMLElement[] = [];
        if (def.variants?.length) fields.push(row(t('editor.props.variant'), selectInput(w.variant ?? def.variants[0], def.variants.map((v) => [v, v] as const), (v) => commit(ref, 'editor.op.variant', (x) => ({ ...x.item, variant: v })), { name: 'variant' })));
        if (w.kind === 'sign') fields.push(row(t('editor.props.signText'), textInput(w.label ?? '', (v) => commit(ref, 'editor.op.signText', (x) => clean({ ...x.item, label: v.trim() ? v.trim().slice(0, 48) : undefined })), { name: 'label', max: 48, placeholder: r.area.name })));
        fields.push(
          h(
            'div',
            { class: 'med-row2' },
            row(t('editor.props.centerLocal'), numInput(w.lcx, (v) => v !== undefined && commit(ref, 'editor.op.position', (x) => ({ ...x.item, lcx: Math.round(v * 4) / 4 })), { step: 0.25 })),
            row(t('editor.props.wall'), selectInput(w.on, [['face', t('editor.props.wallNorth')], ['south', t('editor.props.wallSouth')]] as const, (v) => commit(ref, 'editor.op.wall', (x) => ({ ...x.item, on: v })))),
          ),
        );
        if (w.kind === 'sign') {
          const isAreaSign = r.area.signId === w.id;
          fields.push(checkbox(t('editor.props.areaSign'), isAreaSign, (v) => {
            const d = ctx.doc();
            const i = d.areas.findIndex((a) => a.id === r.area.id);
            if (i < 0) return;
            const a = d.areas[i];
            ctx.exec(batch('editor.op.areaSign', [updateOp(d, { doc: 'areas' }, i, clean({ ...a, signId: v ? w.id : a.signId === w.id ? undefined : a.signId }))]));
          }));
        }
        return [head(furnitureLabel(w.kind), absId(r.area.id, w.id)), section(t('editor.props.wallItem'), ...fields), actions()];
      }
      case 'rug': {
        const g = r.item;
        const q = (v: number | undefined) => (v === undefined ? undefined : Math.round(v * 4) / 4);
        return [
          head(t('editor.props.rug'), absId(r.area.id, g.id)),
          section(
            t('editor.props.rug'),
            row(t('editor.props.color'), colorInput(g.color, (v) => v && commit(ref, 'editor.op.rugColor', (x) => ({ ...x.item, color: v })))),
            h('div', { class: 'med-row2' }, row('x', numInput(g.lx, (v) => v !== undefined && commit(ref, 'editor.op.rug', (x) => ({ ...x.item, lx: q(v) })), { step: 0.25 })), row('y', numInput(g.ly, (v) => v !== undefined && commit(ref, 'editor.op.rug', (x) => ({ ...x.item, ly: q(v) })), { step: 0.25 }))),
            h('div', { class: 'med-row2' }, row(t('editor.props.width'), numInput(g.w, (v) => v !== undefined && v > 0 && commit(ref, 'editor.op.rug', (x) => ({ ...x.item, w: q(v) })), { step: 0.25, min: 0.25 })), row(t('editor.props.height'), numInput(g.h, (v) => v !== undefined && v > 0 && commit(ref, 'editor.op.rug', (x) => ({ ...x.item, h: q(v) })), { step: 0.25, min: 0.25 }))),
          ),
          actions(),
        ];
      }
      case 'door': {
        const d = r.item;
        const set = (patch: Partial<typeof d>) =>
          commit(ref, 'editor.op.doorway', (x) => {
            const next = { ...d, ...patch };
            const p = doorwayProblem((x as Extract<Resolved, { t: 'door' }>).area, next, x.index);
            if (p) {
              ctx.toast(t('editor.tool.invalidDoorway', { problem: p }), 'error');
              return undefined;
            }
            return next;
          });
        return [
          head(t('editor.props.doorway'), `${r.area.id} · ${d.side === 'north' ? t('editor.props.north') : t('editor.props.south')}`),
          section(
            t('editor.props.doorway'),
            row(t('editor.props.wall'), selectInput(d.side, [['north', t('editor.props.North')], ['south', t('editor.props.South')]] as const, (v) => set({ side: v }))),
            h('div', { class: 'med-row2' }, row(t('editor.props.column'), numInput(d.lx, (v) => v !== undefined && set({ lx: Math.round(v) }), { min: 1 })), row(t('editor.props.width'), numInput(d.w, (v) => v !== undefined && set({ w: Math.round(v) }), { min: 1, max: 4 }))),
            h('p', { class: 'med-hint', text: t('editor.props.doorwayHint') }),
          ),
          actions(),
        ];
      }
      case 'area':
        return areaProps(doc, ref, r.item);
      case 'zone':
        return zoneProps(doc, ref, r.item);
      case 'spot': {
        const s = r.item;
        return [
          head(t('editor.props.spot'), s.id),
          section(
            t('editor.props.spot'),
            row(t('editor.props.type'), selectInput(s.kind, (['talk', 'stand', 'watch'] as const).map((k) => [k, spotLabel(k)] as const), (v) => commit(ref, 'editor.op.spotKind', (x) => ({ ...x.item, kind: v })))),
            row(t('editor.props.facing'), selectInput(s.dir, dirs(), (v) => commit(ref, 'editor.op.direction', (x) => ({ ...x.item, dir: v })))),
            h('div', { class: 'med-row2' }, row('x', numInput(s.tx, (v) => v !== undefined && commit(ref, 'editor.op.position', (x) => ({ ...x.item, tx: Math.round(v) })))), row('y', numInput(s.ty, (v) => v !== undefined && commit(ref, 'editor.op.position', (x) => ({ ...x.item, ty: Math.round(v) }))))),
            row(t('editor.props.group'), textInput(s.group ?? '', (v) => commit(ref, 'editor.op.group', (x) => clean({ ...x.item, group: v.trim() ? v.trim().slice(0, 48) : undefined })), { max: 48, placeholder: t('editor.props.noGroup') })),
          ),
          actions(button(t('editor.props.rotate'), () => sel.rotate(false))),
        ];
      }
      case 'spawn': {
        const p = r.item;
        return [
          head(t('editor.props.spawn'), `#${r.index}`),
          section(
            t('editor.props.spawnSection'),
            h('div', { class: 'med-row2' }, row('x', numInput(p.x, (v) => v !== undefined && commit(ref, 'editor.op.entry', () => ({ x: Math.round(v), y: p.y })))), row('y', numInput(p.y, (v) => v !== undefined && commit(ref, 'editor.op.entry', () => ({ x: p.x, y: Math.round(v) }))))),
            h('p', { class: 'med-hint', text: r.index === 0 ? t('editor.props.spawnFirst') : t('editor.props.spawnReach') }),
          ),
          actions(),
        ];
      }
    }
  }

  function areaProps(doc: OfficeMapDoc, ref: Ref, a: MapArea): HTMLElement[] {
    const setArea = (label: MessageKey, fn: (a: MapArea) => MapArea) => commit(ref, label, (x) => clean(fn(x.item as MapArea)));
    const setRect = (patch: Partial<MapArea['rect']>) => {
      const d = ctx.doc();
      const i = d.areas.findIndex((x) => x.id === a.id);
      if (i < 0) return;
      const cur = d.areas[i];
      const rect = { ...cur.rect, ...patch };
      const p = areaRectProblem(d, rect, a.id);
      if (p) return ctx.toast(t('editor.tool.invalidArea', { problem: p }), 'error');
      if (rect.w === cur.rect.w && rect.h === cur.rect.h) ctx.exec(batch('editor.op.moveArea', moveAreaOps(d, a.id, rect.x - cur.rect.x, rect.y - cur.rect.y)));
      else ctx.exec(batch('editor.op.resizeArea', [updateOp(d, { doc: 'areas' }, i, resizeArea(cur, rect))]));
    };
    const presets = Object.entries(WALLS) as [string, WallStyle][];
    const curPreset = presets.find(([, s]) => JSON.stringify(s) === JSON.stringify(a.walls.style))?.[0];
    const signs = a.wallItems.filter((w) => w.kind === 'sign');
    const wallBox = (side: 'north' | 'south' | 'west' | 'east', label: string) => checkbox(label, a.walls[side], (v) => setArea('editor.op.walls', (x) => ({ ...x, walls: { ...x.walls, [side]: v } })));
    const hidden = ctx.state.hiddenAreas.has(a.id);
    return [
      head(a.name, a.id),
      section(
        t('editor.props.area'),
        row(t('editor.props.name'), textInput(a.name, (v) => v.trim() && setArea('editor.op.areaName', (x) => ({ ...x, name: v.trim().slice(0, 64) })), { name: 'name', max: 64 })),
        h(
          'div',
          { class: 'med-row2' },
          row(t('editor.props.deskCode'), textInput(a.code ?? '', (v) => {
            const tt = v.trim();
            if (tt && !/^[A-Za-z0-9]{1,6}$/.test(tt)) return ctx.toast(t('editor.props.codeFormat'), 'error');
            setArea('editor.op.areaCode', (x) => ({ ...x, code: tt || undefined }));
          }, { max: 6, placeholder: t('editor.props.initials') })),
          row(t('editor.props.type'), selectInput<AreaKind>(a.kind, AREA_KINDS.map((k) => [k, areaKindLabel(k)] as const), (v) => setArea('editor.op.areaKind', (x) => ({ ...x, kind: v })))),
        ),
        h('div', { class: 'med-row2' }, row('x', numInput(a.rect.x, (v) => v !== undefined && setRect({ x: Math.round(v) }))), row('y', numInput(a.rect.y, (v) => v !== undefined && setRect({ y: Math.round(v) })))),
        h('div', { class: 'med-row2' }, row(t('editor.props.width'), numInput(a.rect.w, (v) => v !== undefined && setRect({ w: Math.round(v) }), { min: 4 })), row(t('editor.props.height'), numInput(a.rect.h, (v) => v !== undefined && setRect({ h: Math.round(v) }), { min: 4 }))),
        row(t('editor.props.floorTone'), colorInput(a.floorTint, (v) => setArea('editor.op.floorTint', (x) => ({ ...x, floorTint: v })), { clearable: true })),
      ),
      section(
        t('editor.props.walls'),
        h('div', { class: 'med-checks' }, wallBox('north', t('editor.props.North')), wallBox('south', t('editor.props.South')), wallBox('west', t('editor.props.West')), wallBox('east', t('editor.props.East'))),
        row(t('editor.props.style'), selectInput(curPreset ?? '', presets.map(([k]) => [k, wallPresetLabel(k)] as const), (v) => {
          const s = WALLS[v as keyof typeof WALLS];
          if (s) setArea('editor.op.wallStyle', (x) => ({ ...x, walls: { ...x.walls, style: { ...s } } }));
        }, { empty: t('editor.props.custom') })),
        h(
          'div',
          { class: 'med-row2' },
          row(t('editor.props.color'), colorInput(a.walls.style.base, (v) => v && setArea('editor.op.wallColor', (x) => ({ ...x, walls: { ...x.walls, style: { ...x.walls.style, base: v } } })))),
          row(t('editor.props.trim'), colorInput(a.walls.style.trim, (v) => setArea('editor.op.wallTrim', (x) => ({ ...x, walls: { ...x.walls, style: clean({ ...x.walls.style, trim: v }) } })), { clearable: true })),
        ),
        signs.length ? row(t('editor.props.areaSignSelect'), selectInput(a.signId ?? '', signs.map((s) => [s.id, `${s.label ?? a.name} (${s.id})`] as const), (v) => setArea('editor.op.areaSign', (x) => ({ ...x, signId: v || undefined })), { empty: t('editor.props.none') })) : null,
        h('p', { class: 'med-hint', text: t('editor.props.areaHint') }),
      ),
      h(
        'div',
        { class: 'med-actions' },
        button(t('editor.props.center'), () => ctx.centerOn(a.rect)),
        button(hidden ? t('editor.layers.show') : t('editor.layers.hide'), () => {
          if (ctx.state.hiddenAreas.has(a.id)) ctx.state.hiddenAreas.delete(a.id);
          else ctx.state.hiddenAreas.add(a.id);
          ctx.state.changed();
        }),
        button(t('editor.props.deleteArea'), () => sel.del(), 'danger'),
      ),
    ];
  }

  function zoneProps(doc: OfficeMapDoc, ref: Ref, z: MapZone): HTMLElement[] {
    const setZone = (label: MessageKey, fn: (z: MapZone) => MapZone) => commit(ref, label, (x) => clean(fn(x.item as MapZone)));
    const signs: (readonly [string, string])[] = [];
    for (const a of doc.areas) for (const w of a.wallItems) if (w.kind === 'sign') signs.push([`${a.id}/${w.id}`, `${w.label ?? a.name} · ${a.name}`]);
    const asm = ctx.scene.assembly();
    const def = asm?.zoneById.get(z.id);
    return [
      head(z.name, z.id),
      section(
        t('editor.props.zone'),
        row(t('editor.props.name'), textInput(z.name, (v) => v.trim() && setZone('editor.op.zoneName', (x) => ({ ...x, name: v.trim().slice(0, 64) })), { name: 'name', max: 64 })),
        row(t('editor.props.type'), selectInput<ZoneKind>(z.kind, ZONE_KINDS.map((k) => [k, zoneKindLabel(k)] as const), (v) => setZone('editor.op.zoneKind', (x) => ({ ...x, kind: v })))),
        h('div', { class: 'med-checks' }, checkbox(t('editor.props.private'), z.private, (v) => setZone('editor.op.zonePrivate', (x) => ({ ...x, private: v, lockable: v ? x.lockable : false }))), checkbox(t('editor.props.lockable'), z.lockable, (v) => setZone('editor.op.zoneLockable', (x) => ({ ...x, lockable: v, private: v ? true : x.private })))),
        h(
          'div',
          { class: 'med-row2' },
          row(t('editor.props.capacity'), numInput(z.capacity, (v) => setZone('editor.op.capacity', (x) => ({ ...x, capacity: v === undefined ? undefined : Math.max(1, Math.min(500, Math.round(v))) })), { min: 1, max: 500, placeholder: t('editor.props.free') })),
          row(t('editor.props.color'), colorInput(z.color, (v) => setZone('editor.op.zoneColor', (x) => ({ ...x, color: v })), { clearable: true })),
        ),
        row(t('editor.props.doorSign'), selectInput(z.signId ?? '', signs, (v) => setZone('editor.op.zoneSign', (x) => ({ ...x, signId: v || undefined })), { empty: t('editor.props.none') })),
        h('p', { class: 'med-hint', text: t('editor.props.zoneHint', { rects: z.rects.length, detail: def ? t('editor.props.zoneDetail', { tiles: def.count, doors: def.doorTiles.length }) : '' }) }),
      ),
      h(
        'div',
        { class: 'med-actions' },
        button(t('editor.props.editRects'), () => ctx.setMode({ k: 'zone', id: z.id })),
        button(t('editor.props.center'), () => {
          const b = refBounds(ctx.doc(), ref);
          if (b) ctx.centerOn(b);
        }),
        button(t('editor.props.deleteZone'), () => sel.del(), 'danger'),
      ),
    ];
  }

  el.addEventListener('focusout', () => {
    if (!pending) return;
    setTimeout(() => {
      if (el.contains(document.activeElement)) return;
      pending = false;
      render();
    }, 0);
  });

  return {
    el,
    refresh(force = false) {
      const key = `${ctx.state.selection.map(refKey).join('|')}::${ctx.readOnly()}`;
      const docKey = ctx.doc();
      const same = key === lastKey && docKey === lastDoc;
      if (same && !force && !wantFocus) return;
      // não derruba o campo em edição: re-renderiza quando o foco sair do painel
      if (key === lastKey && el.contains(document.activeElement) && !force) {
        pending = true;
        lastDoc = docKey;
        return;
      }
      lastKey = key;
      lastDoc = docKey;
      render();
    },
    focus(name) {
      wantFocus = name;
      lastKey = '';
    },
  };
}
