// Dimensões e ritmos do mundo compartilhados entre servidor e cliente (puro, sem DOM).

/** Tamanho de um tile em px de mundo. */
export const TILE = 16;

/** Deslocamento dos pés dentro do tile em que o personagem está em pé (px). */
export const FOOT_DX = TILE / 2;
export const FOOT_DY = 11;

/** Velocidades em px de mundo por segundo (5 tiles/s andando, 12 correndo). */
export const WALK_SPEED = 5 * TILE;
export const RUN_SPEED = 12 * TILE;

/** Tick da simulação autoritativa (ms) — 20 Hz. */
export const TICK_MS = 50;
/** Broadcast de deltas a cada N ticks (20 Hz: com 10 Hz os remotos andavam aos trancos). */
export const BROADCAST_EVERY = 1;
/**
 * Atraso MÍNIMO de interpolação dos avatares remotos (ms). O atraso real é adaptativo: intervalo
 * dos deltas + latência medida (p90) + folga, até INTERP_MAX_MS (ver client/world/replica/interpolation).
 */
export const INTERP_DELAY_MS = 100;
/** Teto do atraso adaptativo (ms). */
export const INTERP_MAX_MS = 400;
/** Folga somada à latência medida (ms). */
export const INTERP_MARGIN_MS = 30;
/** Raio (Chebyshev, tiles) de áudio/vídeo por proximidade. */
export const PROXIMITY_TILES = 4;
/** Raio (Chebyshev, tiles) do chat "Perto". */
export const CHAT_NEARBY_TILES = 6;
/** Duração do encaixe num assento/ponto de uso (ms). */
export const ENTER_MS = 200;
