// Formatação de tempos e números no idioma atual (shared/i18n). Funções puras: sem DOM, testadas em ui/format.test.ts.
import { getLocale, t } from '../i18n';

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Formatadores Intl por idioma (cache): o idioma pode mudar em tempo de execução. */
const fmtCache = new Map<string, Intl.NumberFormat | Intl.DateTimeFormat>();
function integerFmt(): Intl.NumberFormat {
  const key = `${getLocale()}|int`;
  let f = fmtCache.get(key) as Intl.NumberFormat | undefined;
  if (!f) fmtCache.set(key, (f = new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 0 })));
  return f;
}
function clockFmt(withSeconds: boolean): Intl.DateTimeFormat {
  const key = `${getLocale()}|clock|${withSeconds ? 's' : 'm'}`;
  let f = fmtCache.get(key) as Intl.DateTimeFormat | undefined;
  if (!f) fmtCache.set(key, (f = new Intl.DateTimeFormat(getLocale(), { hour: '2-digit', minute: '2-digit', ...(withSeconds ? { second: '2-digit' } : {}) })));
  return f;
}

/** Hora do dia no idioma atual: "14:30" (ou "14:30:05" com segundos). */
export function formatClock(ts: number, withSeconds = false): string {
  return clockFmt(withSeconds).format(ts);
}

/** Inteiro com separador de milhar do idioma atual. */
export function formatInt(n: number): string {
  return integerFmt().format(n);
}

/** "3 mesas" / "1 mesa": número formatado + forma singular/plural. */
export function plural(n: number, singular: string, pluralForm: string): string {
  return `${formatInt(n)} ${n === 1 ? singular : pluralForm}`;
}

/** Tempo relativo no passado: "agora", "há 5 s", "há 3 min", "há 2 h", "há 4 d". */
export function relativeTime(at: number, now: number): string {
  const diff = now - at;
  if (!Number.isFinite(diff) || diff < 5 * SECOND) return t('common.now');
  if (diff < MINUTE) return t('common.ago.seconds', { n: Math.floor(diff / SECOND) });
  if (diff < HOUR) return t('common.ago.minutes', { n: Math.floor(diff / MINUTE) });
  if (diff < DAY) return t('common.ago.hours', { n: Math.floor(diff / HOUR) });
  return t('common.ago.days', { n: Math.floor(diff / DAY) });
}

/** Duração legível: "12 s", "3 min", "2 h 10 min", "3 d 4 h". */
export function formatDuration(ms: number): string {
  const v = Math.max(0, ms);
  if (v < MINUTE) return `${Math.floor(v / SECOND)} s`;
  if (v < HOUR) return `${Math.floor(v / MINUTE)} min`;
  if (v < DAY) {
    const h = Math.floor(v / HOUR);
    const m = Math.floor((v % HOUR) / MINUTE);
    return m ? `${h} h ${m} min` : `${h} h`;
  }
  const d = Math.floor(v / DAY);
  const h = Math.floor((v % DAY) / HOUR);
  return h ? `${d} d ${h} h` : `${d} d`;
}

/**
 * Cronômetro de algo que ainda está rodando: "0:07", "12:31", "1:02:10"; a partir de 1 dia, "1 d 2 h".
 * Valores negativos (relógios fora de sincronia) viram "0:00".
 */
export function formatElapsed(ms: number): string {
  const v = Number.isFinite(ms) ? Math.max(0, ms) : 0;
  if (v >= DAY) return formatDuration(v);
  const total = Math.floor(v / SECOND);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** Contagem regressiva: "em 2 h 10 min", "em 5 min", "em menos de 1 min", "agora". */
export function formatCountdown(target: number, now: number): string {
  const diff = target - now;
  if (diff <= 0) return t('common.now');
  if (diff < MINUTE) return t('common.in.lessThanMinute');
  return t('common.in.duration', { duration: formatDuration(diff) });
}
