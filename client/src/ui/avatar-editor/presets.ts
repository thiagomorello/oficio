// Presets do montador: aplicam tudo menos look, pele e nome.
import { normalizeAppearance } from '../../../../shared/validate/appearance';
import type { Appearance } from '../../art/api';
import type { MessageKey } from '../../i18n';

export type PresetValues = Omit<Appearance, 'look' | 'skin'>;

export interface Preset {
  id: string;
  /** Chaves de i18n (`avatar.preset.<id>.label` / `.description`), traduzidas na hora de desenhar. */
  label: MessageKey;
  description: MessageKey;
  values: PresetValues;
}

export const PRESETS: readonly Preset[] = [
  {
    id: 'dev',
    label: 'avatar.preset.dev.label',
    description: 'avatar.preset.dev.description',
    values: {
      hair: '#2b2530', hairStyle: 'short', eyes: '#4a2f22', top: '#3d4352', topAccent: '#e8e3d6', topStyle: 'hoodie',
      bottom: '#2c2c35', bottomStyle: 'pants', shoes: '#ececec', accessory: 'headphones', accessoryColor: '#2b2b33',
      lanyard: '#ffd800', facialHair: 'none', makeup: 'none', freckles: false,
    },
  },
  {
    id: 'executiva',
    label: 'avatar.preset.executiva.label',
    description: 'avatar.preset.executiva.description',
    values: {
      hair: '#3f2c22', hairStyle: 'side_part', eyes: '#2b2236', top: '#2f3b55', topAccent: '#f4f4f0', topStyle: 'jacket',
      bottom: '#2c2c35', bottomStyle: 'skirt', shoes: '#2b2b33', accessory: 'glasses', accessoryColor: '#2b2b33',
      lanyard: null, facialHair: 'none', makeup: 'lipstick', freckles: false,
    },
  },
  {
    id: 'criativo',
    label: 'avatar.preset.criativo.label',
    description: 'avatar.preset.criativo.description',
    values: {
      hair: '#8f6ad8', hairStyle: 'wavy', eyes: '#5a3b22', top: '#efb54a', topAccent: '#f1efe9', topStyle: 'tshirt',
      bottom: '#3f5f8c', bottomStyle: 'pants', shoes: '#d04848', accessory: 'beanie', accessoryColor: '#e2604f',
      lanyard: null, facialHair: 'none', makeup: 'none', freckles: true,
    },
  },
  {
    id: 'esportiva',
    label: 'avatar.preset.esportiva.label',
    description: 'avatar.preset.esportiva.description',
    values: {
      hair: '#5f3c28', hairStyle: 'ponytail', eyes: '#3c7a52', top: '#4a86d8', topAccent: '#f1efe9', topStyle: 'tshirt',
      bottom: '#2e3e5e', bottomStyle: 'shorts', shoes: '#ececec', accessory: 'cap', accessoryColor: '#e2604f',
      lanyard: null, facialHair: 'none', makeup: 'none', freckles: false,
    },
  },
  {
    id: 'classico',
    label: 'avatar.preset.classico.label',
    description: 'avatar.preset.classico.description',
    values: {
      hair: '#3f2c22', hairStyle: 'short', eyes: '#2b2236', top: '#d3e3f4', topAccent: '#2f4c7d', topStyle: 'shirt_tie',
      bottom: '#2e3e5e', bottomStyle: 'pants', shoes: '#6b4630', accessory: 'none', accessoryColor: '#2b2b33',
      lanyard: null, facialHair: 'none', makeup: 'none', freckles: false,
    },
  },
  {
    id: 'colorida',
    label: 'avatar.preset.colorida.label',
    description: 'avatar.preset.colorida.description',
    values: {
      hair: '#e47aa8', hairStyle: 'curly', eyes: '#2f5f9e', top: '#36b0b0', topAccent: '#f2d16b', topStyle: 'sweater',
      bottom: '#7f9cc4', bottomStyle: 'skirt', shoes: '#3f63a8', accessory: 'sunglasses', accessoryColor: '#22232b',
      lanyard: '#e2604f', facialHair: 'none', makeup: 'blush', freckles: false,
    },
  },
];

/** Aplica o preset ao rascunho preservando look e pele (o nome não faz parte da aparência). */
export function applyPreset(draft: Appearance, preset: Preset): Appearance {
  return normalizeAppearance({ ...draft, ...preset.values, look: draft.look, skin: draft.skin });
}
