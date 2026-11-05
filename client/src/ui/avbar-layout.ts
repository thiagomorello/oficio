// Layout da barra de A/V (puro, sem DOM): tamanho dos tiles, linhas da grade e ordem (fixar/ampliar).

export interface TileSize {
  w: number;
  h: number;
}

/** 16:9. Poucos tiles = grandes; muitos = pequenos. */
export function tileSize(count: number): TileSize {
  if (count <= 3) return { w: 208, h: 117 };
  if (count > 6) return { w: 144, h: 81 };
  return { w: 176, h: 99 };
}

/** Tamanho dos tiles da faixa quando há um ampliado. */
export const STRIP_TILE: TileSize = { w: 160, h: 90 };

/** 1 linha se couber; senão 2 (a partir daí a faixa rola na horizontal). */
export function gridRows(count: number, availableWidth: number, tileW: number, gap = 8): number {
  const perRow = Math.max(1, Math.floor((availableWidth + gap) / (tileW + gap)));
  return count > perRow ? 2 : 1;
}

export interface TilePlan {
  /** Tile ampliado (null se não há, ou se a chave não existe mais). */
  expanded: string | null;
  /** Ordem da faixa (sem o ampliado): fixado primeiro, resto estável. */
  strip: string[];
}

export function planTiles(keys: readonly string[], pinned: string | null, expanded: string | null): TilePlan {
  const exp = expanded !== null && keys.includes(expanded) ? expanded : null;
  const rest = keys.filter((k) => k !== exp);
  const strip = pinned !== null && rest.includes(pinned) ? [pinned, ...rest.filter((k) => k !== pinned)] : rest;
  return { expanded: exp, strip };
}
