// Uma instância de cada ferramenta por editor, indexada pelo modo.
import type { EditorCtx, Tool } from '../context';
import { stampTool } from '../stamps-ui';
import type { ModeKind } from '../state';
import { areaTool } from './area';
import { doorwayTool } from './doorway';
import { floorTool } from './floor';
import { placeTool } from './place';
import { rugTool } from './rug';
import { selectTool, type SelectTool } from './select';
import { spawnTool } from './spawn';
import { spotTool } from './spot';
import { wallItemTool } from './wall-item';
import { zoneTool } from './zone';

export interface Tools {
  byMode: Record<ModeKind, Tool>;
  select: SelectTool;
}

export function createTools(ctx: EditorCtx): Tools {
  const select = selectTool(ctx);
  return {
    select,
    byMode: {
      select,
      place: placeTool(ctx),
      floor: floorTool(ctx),
      rug: rugTool(ctx),
      area: areaTool(ctx),
      zone: zoneTool(ctx),
      doorway: doorwayTool(ctx),
      spawn: spawnTool(ctx),
      wallItem: wallItemTool(ctx),
      spot: spotTool(ctx),
      stamp: stampTool(ctx),
    },
  };
}
