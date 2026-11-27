/**
 * Recuperación de las combinaciones oficiales de La Primitiva.
 *
 * La fuente es histórica y pública: https://www.laprimitiva.info/historico/
 * No se usa la api de loteriasyapuestas.es porque devuelve 403 a las peticiones
 * del servidor. Este módulo no depende del DOM para poder ejecutarse también en
 * el scheduled handler del Worker de Cloudflare.
 */

import type { SyndicateData, WinningCombination } from '../data/initialSyndicateData.ts';
import { isValidWinningCombination } from './finance.ts';

const MONTHS: Record<string, string> = {
  ene: '01', feb: '02', mar: '03', abr: '04', may: '05', jun: '06',
  jul: '07', ago: '08', sep: '09', oct: '10', nov: '11', dic: '12',
};

export function resultsUrlForYear(year: number): string {
  return `https://www.laprimitiva.info/historico/sorteos-la-primitiva-${year}.html`;
}

function cleanCell(value: string): string {
  return value
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .trim();
}

/** Parsea la tabla histórica y devuelve las combinaciones indexadas por YYYY-MM-DD. */
export function parsePrimitivaResults(html: string, year: number): Map<string, WinningCombination> {
  const results = new Map<string, WinningCombination>();
  const rows = html.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi) ?? [];

  for (const row of rows) {
    const cells = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((match) => cleanCell(match[1]));
    const dateIndex = cells.findIndex((cell) => /^\d{1,2}-[a-z]{3}$/i.test(cell));
    if (dateIndex < 0) continue;

    const [day, monthName] = cells[dateIndex].toLowerCase().split('-');
    const month = MONTHS[monthName];
    if (!month) continue;

    // Tras la fecha vienen 6 números, complementario, reintegro y joker.
    // Las celdas anteriores pueden contener el número de semana (rowspan), por eso
    // no se puede simplemente filtrar todos los valores numéricos de la fila.
    const values = cells.slice(dateIndex + 1, dateIndex + 9);
    if (values.length < 8 || values.some((value) => !/^\d{1,2}$/.test(value))) continue;

    const jokerCell = cells[dateIndex + 9] ?? '';
    const combination: WinningCombination = {
      numbers: values.slice(0, 6).map(Number).sort((a, b) => a - b),
      complementario: Number(values[6]),
      reintegro: Number(values[7]),
      joker: /^\d{1,9}$/.test(jokerCell) ? jokerCell : undefined,
    };
    if (!isValidWinningCombination(combination)) continue;

    results.set(`${year}-${month}-${day.padStart(2, '0')}`, combination);
  }

  return results;
}

/** Descarga los años que aparecen en los boletos de la peña. */
export async function fetchOfficialResults(syndicate: SyndicateData): Promise<Map<string, WinningCombination>> {
  const years = [...new Set(
    syndicate.draws.map((draw) => draw.date.slice(0, 4)).filter((year) => /^\d{4}$/.test(year)),
  )].sort();

  const merged = new Map<string, WinningCombination>();
  for (const year of years) {
    try {
      const response = await fetch(resultsUrlForYear(Number(year)), { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const html = await response.text();
      for (const [date, combination] of parsePrimitivaResults(html, Number(year))) {
        merged.set(date, combination);
      }
    } catch (error) {
      // Un año caído no debe impedir rellenar los demás.
      console.error(`No se pudo recuperar el histórico de ${year}:`, error);
    }
  }
  return merged;
}

/** Rellena sólo las combinaciones oficiales que faltan; nunca toca nuestra apuesta. */
export function applyOfficialResults(
  syndicate: SyndicateData,
  results: Map<string, WinningCombination>,
): { syndicate: SyndicateData; updated: number } {
  let updated = 0;
  const draws = syndicate.draws.map((draw) => {
    if (draw.officialCombination) return draw;
    const official = results.get(draw.date);
    if (!official) return draw;
    updated += 1;
    return {
      ...draw,
      status: 'jugado' as const,
      officialCombination: draw.jokerPlayed ? official : { ...official, joker: undefined },
    };
  });
  return { syndicate: updated ? { ...syndicate, draws } : syndicate, updated };
}

export interface OfficialDrawResult {
  date: string;
  combination: WinningCombination;
}

export interface OfficialHistoryLastYear {
  fromDate: string;
  toDate: string;
  draws: OfficialDrawResult[];
}

const historyCache = new Map<string, { expiresAt: number; data: OfficialHistoryLastYear }>();

/** Descarga todos los sorteos oficiales de La Primitiva comprendidos entre fromDate y toDate. */
export async function fetchOfficialHistoryRange(fromDate: string, toDate: string): Promise<OfficialHistoryLastYear> {
  const cleanFrom = fromDate <= toDate ? fromDate : toDate;
  const cleanTo = fromDate <= toDate ? toDate : fromDate;
  const startYear = Math.max(1985, parseInt(cleanFrom.slice(0, 4), 10) || 2025);
  const endYear = Math.min(2030, parseInt(cleanTo.slice(0, 4), 10) || 2026);

  const cacheKey = `${cleanFrom}_${cleanTo}`;
  const cached = historyCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() && cached.data.draws.length > 0) {
    return cached.data;
  }

  const years: number[] = [];
  for (let y = Math.min(startYear, endYear); y <= Math.max(startYear, endYear); y++) {
    years.push(y);
  }

  const merged = new Map<string, WinningCombination>();
  const responses = await Promise.allSettled(
    years.map(async (year) => {
      const response = await fetch(resultsUrlForYear(year), { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return { year, html: await response.text() };
    }),
  );

  for (const item of responses) {
    if (item.status !== 'fulfilled') {
      console.error('No se pudo recuperar el histórico oficial:', item.reason);
      continue;
    }
    for (const [date, combination] of parsePrimitivaResults(item.value.html, item.value.year)) {
      if (date >= cleanFrom && date <= cleanTo) {
        merged.set(date, combination);
      }
    }
  }

  const draws = [...merged.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([date, combination]) => ({ date, combination }));

  const data: OfficialHistoryLastYear = { fromDate: cleanFrom, toDate: cleanTo, draws };
  if (draws.length > 0) {
    historyCache.set(cacheKey, { expiresAt: Date.now() + 30 * 60_000, data });
  }
  return data;
}

/** Descarga todos los sorteos oficiales de La Primitiva de los últimos 12 meses. */
export async function fetchOfficialHistoryLastYear(now = new Date()): Promise<OfficialHistoryLastYear> {
  const toDate = madridDateTime(now).dateKey;
  const [yearStr, monthStr, dayStr] = toDate.split('-');
  const currentYear = Number(yearStr);
  const fromYear = currentYear - 1;
  // Mismo mes y día del año anterior (ajustando 29 de febrero si aplica).
  const maxDayInFromMonth = new Date(Date.UTC(fromYear, Number(monthStr), 0)).getUTCDate();
  const clampedDay = String(Math.min(Number(dayStr), maxDayInFromMonth)).padStart(2, '0');
  const fromDate = `${fromYear}-${monthStr}-${clampedDay}`;

  return fetchOfficialHistoryRange(fromDate, toDate);
}

export async function refreshOfficialResults(syndicate: SyndicateData): Promise<{ syndicate: SyndicateData; updated: number }> {
  const results = await fetchOfficialResults(syndicate);
  return applyOfficialResults(syndicate, results);
}

/** Hora local de la peña. Cloudflare ejecuta los crons en UTC. */
export function madridDateTime(now = new Date()): { dateKey: string; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('es-ES', {
    timeZone: 'Europe/Madrid',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return {
    dateKey: `${get('year')}-${get('month')}-${get('day')}`,
    hour: Number(get('hour')),
    minute: Number(get('minute')),
  };
}

/** Se ejecuta a las 23:00 de Madrid; tolera unos minutos de retraso del cron. */
export function isScheduledResultsTime(now = new Date()): boolean {
  const { hour, minute } = madridDateTime(now);
  return hour === 23 && minute <= 5;
}
