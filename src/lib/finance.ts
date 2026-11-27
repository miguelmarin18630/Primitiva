import {
  SYNDICATE_APP_NAME,
  createInitialSyndicateData,
  type BetLine,
  type DistributionRecord,
  type DrawRecord,
  type ExtraContribution,
  type FixedQuery,
  type Member,
  type MonthlyPaymentRecord,
  type SyndicateData,
  type WinningCombination,
} from '../data/initialSyndicateData.ts';

/** Reglas puras de negocio: sin React, sin servidor, fácilmente testeable. */

export const roundMoney = (value: number): number =>
  Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;

export const money = (value: number): string => `${roundMoney(value).toFixed(2)} €`;

const sum = (values: number[]): number => roundMoney(values.reduce((acc, n) => acc + (Number.isFinite(n) ? n : 0), 0));

const numberOr = (value: unknown, fallback: number): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const stringOr = (value: unknown, fallback = ''): string => (typeof value === 'string' ? value : fallback);

const arrayOr = <T>(value: unknown, fallback: T[]): T[] => (Array.isArray(value) ? (value as T[]) : fallback);

const isIsoDate = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);

export function formatDateShort(iso: string): string {
  return isIsoDate(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(2, 4)}` : iso;
}

export function todayISO(): string {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

export function weekdayFromDate(iso: string): string {
  if (!isIsoDate(iso)) return 'Jueves';
  const date = new Date(`${iso}T12:00:00Z`);
  const name = new Intl.DateTimeFormat('es-ES', { weekday: 'long', timeZone: 'UTC' }).format(date);
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export function monthNameFromKey(key: string): string {
  const [year, month] = key.split('-').map(Number);
  if (!year || !month || month < 1 || month > 12) return key;
  const name = new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(Date.UTC(year, month - 1, 1)),
  );
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export interface Totals {
  /** Histórico de socios + extras + cuotas mensuales registradas desde ahora. */
  totalPagado: number;
  totalHistórico: number;
  totalExtras: number;
  totalCuotas: number;
  totalJugado: number;
  totalPremiosSorteos: number;
  totalPremiosExtra: number;
  totalPremios: number;
  totalDistribuido: number;
  /** Aportaciones - apuestas + premios - repartos ya abonados. */
  totalCaja: number;
  futureDrawsPossible: number;
  paidMembers: number;
  pendingMembers: number;
}

export function computeTotals(data: SyndicateData): Totals {
  const totalHistórico = sum(data.members.map((m) => m.totalPaid));
  const totalExtras = sum(data.extraContributions.map((e) => e.amount));
  const totalCuotas = sum(data.monthlyPayments.filter((p) => !p.historical).map((p) => p.amount));
  const totalPagado = roundMoney(totalHistórico + totalExtras + totalCuotas);
  const totalJugado = sum(data.draws.map((d) => d.betCost));
  const totalPremiosSorteos = sum(data.draws.map((d) => d.prizeWon));
  const totalPremiosExtra = sum(data.extraPrizes.map((ep) => ep.amount));
  const totalPremios = roundMoney(totalPremiosSorteos + totalPremiosExtra);
  const totalDistribuido = sum(data.distributions.map((d) => d.amount));
  const totalCaja = roundMoney(totalPagado - totalJugado + totalPremios - totalDistribuido);
  const cost = data.costPerDraw > 0 ? data.costPerDraw : 0;

  return {
    totalPagado,
    totalHistórico,
    totalExtras,
    totalCuotas,
    totalJugado,
    totalPremiosSorteos,
    totalPremiosExtra,
    totalPremios,
    totalDistribuido,
    totalCaja,
    futureDrawsPossible: cost > 0 && totalCaja > 0 ? Math.floor(totalCaja / cost) : 0,
    paidMembers: data.members.filter((m) => m.isUpToDate).length,
    pendingMembers: data.members.filter((m) => !m.isUpToDate).length,
  };
}

/** Cuotas pagadas de un mes, contando también las ya incluidas en el histórico. */
export function paidMembersInMonth(data: SyndicateData, monthKey: string): Set<string> {
  return new Set(data.monthlyPayments.filter((p) => p.month === monthKey).map((p) => p.memberId));
}

export interface MonthlyData {
  monthKey: string;
  monthName: string;
  drawsCount: number;
  contributions: number;
  cost: number;
  prizes: number;
  distributed: number;
  netResult: number;
  carriedBalance: number;
}

export function computeMonthlyData(data: SyndicateData, totals: Totals): MonthlyData[] {
  const months = new Map<string, MonthlyData>();
  const ensure = (key: string): MonthlyData => {
    let entry = months.get(key);
    if (!entry) {
      entry = { monthKey: key, monthName: monthNameFromKey(key), drawsCount: 0, contributions: 0, cost: 0, prizes: 0, distributed: 0, netResult: 0, carriedBalance: 0 };
      months.set(key, entry);
    }
    return entry;
  };

  data.extraContributions.forEach((extra) => {
    if (!isIsoDate(extra.date)) return;
    const entry = ensure(extra.date.slice(0, 7));
    entry.contributions = roundMoney(entry.contributions + extra.amount);
  });

  data.monthlyPayments.filter((p) => !p.historical).forEach((payment) => {
    if (!isIsoDate(payment.date)) return;
    const entry = ensure(payment.date.slice(0, 7));
    entry.contributions = roundMoney(entry.contributions + payment.amount);
  });

  data.draws.forEach((draw) => {
    if (!isIsoDate(draw.date)) return;
    const entry = ensure(draw.date.slice(0, 7));
    entry.drawsCount += 1;
    entry.cost = roundMoney(entry.cost + draw.betCost);
    entry.prizes = roundMoney(entry.prizes + draw.prizeWon);
  });

  data.extraPrizes.forEach((prize) => {
    if (!isIsoDate(prize.date)) return;
    ensure(prize.date.slice(0, 7)).prizes = roundMoney(ensure(prize.date.slice(0, 7)).prizes + prize.amount);
  });

  data.distributions.forEach((distribution) => {
    if (!isIsoDate(distribution.date)) return;
    ensure(distribution.date.slice(0, 7)).distributed = roundMoney(ensure(distribution.date.slice(0, 7)).distributed + distribution.amount);
  });

  let carriedBalance = totals.totalHistórico;
  return [...months.values()]
    .sort((a, b) => a.monthKey.localeCompare(b.monthKey))
    .map((entry) => {
      carriedBalance = roundMoney(carriedBalance + entry.contributions - entry.cost + entry.prizes - entry.distributed);
      return {
        ...entry,
        netResult: roundMoney(entry.contributions + entry.prizes - entry.cost - entry.distributed),
        carriedBalance,
      };
    });
}

/** Siguiente número de sorteo: max + 1, para no repetir índices tras borrar uno. */
export function nextDrawIndex(draws: DrawRecord[]): number {
  return draws.reduce((max, draw) => Math.max(max, numberOr(draw.index, 0)), 0) + 1;
}

export function isValidWinningCombination(value: WinningCombination): boolean {
  const numbers = value.numbers;
  const inRange = (n: number) => Number.isInteger(n) && n >= 1 && n <= 49;
  return (
    Array.isArray(numbers) &&
    numbers.length === 6 &&
    numbers.every(inRange) &&
    new Set(numbers).size === 6 &&
    inRange(value.complementario) &&
    !numbers.includes(value.complementario) &&
    Number.isInteger(value.reintegro) &&
    value.reintegro >= 0 &&
    value.reintegro <= 9 &&
    (!value.joker || /^\d{1,9}$/.test(value.joker))
  );
}

/** Convierte un objeto arbitrario en una combinación válida y ordenada, o undefined. */
export function normalizeCombination(value: unknown): WinningCombination | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as Partial<WinningCombination>;
  const combination: WinningCombination = {
    numbers: arrayOr<unknown>(candidate.numbers, []).map((n) => numberOr(n, 0)),
    complementario: numberOr(candidate.complementario, 0),
    reintegro: numberOr(candidate.reintegro, -1),
    joker:
      typeof candidate.joker === 'string' && /^\d{1,9}$/.test(candidate.joker.trim())
        ? candidate.joker.trim()
        : undefined,
  };
  return isValidWinningCombination(combination)
    ? { ...combination, numbers: [...combination.numbers].sort((a, b) => a - b) }
    : undefined;
}

const isValidBetLineNumbers = (numbers: number[]): boolean =>
  numbers.length === 6 &&
  numbers.every((n) => Number.isInteger(n) && n >= 1 && n <= 49) &&
  new Set(numbers).size === 6;

/** Normaliza las líneas de un boleto. Descarta las que no tienen 6 números válidos. */
export function normalizeBetLines(value: unknown): BetLine[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const lines: BetLine[] = [];
  for (const raw of value as Partial<BetLine>[]) {
    if (!raw || typeof raw !== 'object') continue;
    const numbers = arrayOr<unknown>(raw.numbers, []).map((n) => numberOr(n, 0));
    if (!isValidBetLineNumbers(numbers)) continue;
    const reintegro = numberOr(raw.reintegro, -1);
    lines.push({
      line: Math.max(1, Math.round(numberOr(raw.line, lines.length + 1))),
      numbers: [...numbers].sort((a, b) => a - b),
      reintegro: reintegro >= 0 && reintegro <= 9 ? reintegro : undefined,
    });
  }
  lines.sort((a, b) => a.line - b.line);
  return lines.length > 0 ? lines : undefined;
}

/** Líneas jugadas en un sorteo, con compatibilidad para boletos antiguos de una sola apuesta. */
export function drawBetLines(draw: DrawRecord): BetLine[] {
  if (draw.lines?.length) return draw.lines;
  if (draw.winningCombination) {
    return [{ line: 1, numbers: [...draw.winningCombination.numbers].sort((a, b) => a - b) }];
  }
  return [];
}

/** Cada apuesta cuesta 1 €, con independencia de cuántas líneas tenga el boleto. */
export const betLinesCost = (lines: BetLine[]): number => lines.length;

export interface TicketExtraction {
  date?: string;
  dayOfWeek?: string;
  betCost?: number;
  notes?: string;
  reintegro?: number;
  joker?: string;
  jokerPlayed?: boolean;
  lines?: BetLine[];
  winningCombination?: WinningCombination;
}

/** La IA puede devolver campos parciales o corruptos: sólo se aplican los válidos. */
export function sanitizeTicketExtraction(raw: unknown): TicketExtraction {
  if (!raw || typeof raw !== 'object') return {};
  const source = raw as Record<string, unknown>;
  const result: TicketExtraction = {};

  if (isIsoDate(source.date)) result.date = source.date;
  const weekdays = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
  if (typeof source.dayOfWeek === 'string' && weekdays.includes(source.dayOfWeek)) {
    result.dayOfWeek = source.dayOfWeek;
  } else if (result.date) {
    result.dayOfWeek = weekdayFromDate(result.date);
  }
  const cost = numberOr(source.betCost, 0);
  if (cost > 0 && cost < 10_000) result.betCost = roundMoney(cost);
  if (typeof source.notes === 'string' && source.notes.trim()) result.notes = source.notes.trim().slice(0, 300);

  const rawReintegro = numberOr(source.reintegro, -1);
  if (rawReintegro >= 0 && rawReintegro <= 9) {
    result.reintegro = rawReintegro;
  }
  if (typeof source.joker === 'string' && source.joker.trim()) {
    result.joker = source.joker.trim();
  }
  if (typeof source.jokerPlayed === 'boolean') {
    result.jokerPlayed = source.jokerPlayed;
  }

  // Sanitizar líneas de apuestas (múltiples bloques o apuestas del boleto)
  if (Array.isArray(source.lines) && source.lines.length > 0) {
    const lines: BetLine[] = [];
    source.lines.forEach((item, idx) => {
      if (item && typeof item === 'object') {
        const itemObj = item as Record<string, unknown>;
        const rawNumbers = Array.isArray(itemObj.numbers) ? itemObj.numbers : [];
        const cleanNums = rawNumbers
          .map((n) => Number(n))
          .filter((n) => Number.isInteger(n) && n >= 1 && n <= 49);
        const uniqueNums = [...new Set(cleanNums)].sort((a, b) => a - b);
        if (uniqueNums.length === 6) {
          const lineNum = Math.max(1, Math.round(numberOr(itemObj.line, idx + 1)));
          const r = numberOr(itemObj.reintegro, -1);
          lines.push({
            line: lineNum,
            numbers: uniqueNums,
            reintegro: r >= 0 && r <= 9 ? r : (result.reintegro !== undefined ? result.reintegro : undefined),
          });
        }
      }
    });
    if (lines.length > 0) {
      lines.sort((a, b) => a.line - b.line);
      result.lines = lines;
      if (!result.betCost) result.betCost = lines.length;
    }
  }

  const combination = normalizeCombination(source.winningCombination);
  if (combination) {
    result.winningCombination = combination;
    if (result.reintegro === undefined && combination.reintegro >= 0 && combination.reintegro <= 9) {
      result.reintegro = combination.reintegro;
    }
    if (!result.lines || result.lines.length === 0) {
      result.lines = [{
        line: 1,
        numbers: combination.numbers,
        reintegro: combination.reintegro,
      }];
    }
  } else if (result.lines && result.lines.length > 0) {
    result.winningCombination = {
      numbers: result.lines[0].numbers,
      complementario: 0,
      reintegro: result.lines[0].reintegro ?? (result.reintegro ?? 0),
      joker: result.joker,
    };
  }

  return result;
}

/** Normaliza un estado venido de localStorage o de la API antes de usarlo. */
export function normalizeSyndicate(raw: unknown): SyndicateData {
  const base = createInitialSyndicateData();
  if (!raw || typeof raw !== 'object') return base;
  const source = raw as Partial<SyndicateData>;

  const members: Member[] = arrayOr<Partial<Member>>(source.members, base.members).map((member, index) => {
    const rawId = stringOr(member.id) || `m_${index}`;
    const rawName = stringOr(member.name).trim() || `Socio ${index + 1}`;
    const isLegacyMariaJose = rawId === 'm_mariajose' || /^mar[ií]a\s*jos[eé]$/i.test(rawName);
    const rawNotes = stringOr(member.notes).trim();
    const notes = isLegacyMariaJose && rawNotes
      ? rawNotes.replace(/Socia fundadora/gi, 'Socio fundador')
      : rawNotes;

    return {
      id: isLegacyMariaJose ? 'm_antonio' : rawId,
      name: isLegacyMariaJose ? 'ANTONIO' : rawName,
      totalPaid: Math.max(0, roundMoney(numberOr(member.totalPaid, 0))),
      joinedDate: isIsoDate(member.joinedDate) ? member.joinedDate : base.members[0].joinedDate,
      isUpToDate: member.isUpToDate !== false,
      notes: notes || undefined,
      balance: roundMoney(numberOr(member.balance, 0)),
      paymentsHistory: arrayOr<Partial<Member['paymentsHistory'][number]>>(member.paymentsHistory, []).map((payment, paymentIndex) => {
        const rawPaymentId = stringOr(payment.id) || `p_${index}_${paymentIndex}`;
        return {
          id: isLegacyMariaJose && rawPaymentId === 'p_mj_1' ? 'p_ant_1' : rawPaymentId,
          date: isIsoDate(payment.date) ? payment.date : todayISO(),
          amount: Math.max(0, roundMoney(numberOr(payment.amount, 0))),
          concept: stringOr(payment.concept).trim() || 'Aportación a la peña',
        };
      }),
    };
  });

  const verifiedDrawById = new Map(base.draws.filter((d) => d.lines?.length).map((d) => [d.id, d]));
  const verifiedDrawByDate = new Map(base.draws.filter((d) => d.lines?.length).map((d) => [d.date, d]));

  const draws: DrawRecord[] = arrayOr<Partial<DrawRecord>>(source.draws, base.draws).map((draw, index) => {
    const id = stringOr(draw.id) || `d_${index}`;
    const date = isIsoDate(draw.date) ? draw.date : todayISO();
    const verified = verifiedDrawById.get(id) ?? verifiedDrawByDate.get(date);
    const lines = verified?.lines
      ? verified.lines.map((line) => ({ ...line, numbers: [...line.numbers] }))
      : normalizeBetLines(draw.lines);
    const rawNotes = stringOr(draw.notes).trim();
    const cleanNotes = verified && /pendientes de verificar|lectura automática/i.test(rawNotes)
      ? verified.notes
      : (rawNotes || undefined);

    return {
      id,
      index: numberOr(draw.index, index + 1),
      date,
      displayDate: stringOr(draw.displayDate).trim() || formatDateShort(date),
      dayOfWeek: stringOr(draw.dayOfWeek).trim() || weekdayFromDate(date),
      betCost: lines ? betLinesCost(lines) : Math.max(0, roundMoney(numberOr(draw.betCost, 0))),
      prizeWon: Math.max(0, roundMoney(numberOr(draw.prizeWon, 0))),
      notes: cleanNotes,
      lines,
      winningCombination: verified ? undefined : normalizeCombination(draw.winningCombination),
      officialCombination: normalizeCombination(draw.officialCombination) ?? verified?.officialCombination,
      jokerPlayed: typeof draw.jokerPlayed === 'boolean' ? draw.jokerPlayed : (verified ? false : undefined),
      createdBy: draw.createdBy === 'socio' || draw.createdBy === 'admin' ? draw.createdBy : undefined,
      ticketImage: stringOr(draw.ticketImage) || verified?.ticketImage || undefined,
      status: (draw.status === 'pendiente' ? 'pendiente' : 'jugado') as DrawRecord['status'],
    };
  }).sort((a, b) => b.date.localeCompare(a.date) || b.index - a.index);

  const distributions: DistributionRecord[] = arrayOr<Partial<DistributionRecord>>(source.distributions, []).map((item, index) => ({
    id: stringOr(item.id) || `dist_${index}`,
    date: isIsoDate(item.date) ? item.date : todayISO(),
    type: item.type === 'caja' || item.type === 'custom' ? item.type : 'premios',
    amount: Math.max(0, roundMoney(numberOr(item.amount, 0))),
    perMember: Math.max(0, roundMoney(numberOr(item.perMember, 0))),
  }));

  const normalizeExtras = (value: unknown, fallback: ExtraContribution[]): ExtraContribution[] =>
    arrayOr<Partial<ExtraContribution>>(value, fallback).map((item, index) => ({
      id: stringOr(item.id) || `ec_${index}`,
      memberOrConcept: stringOr(item.memberOrConcept).trim() || 'Aportación extraordinaria',
      amount: Math.max(0, roundMoney(numberOr(item.amount, 0))),
      date: isIsoDate(item.date) ? item.date : todayISO(),
      notes: stringOr(item.notes).trim(),
    }));

  const extraPrizes = normalizeExtras(source.extraPrizes, base.extraPrizes);
  const extraContributions = normalizeExtras(source.extraContributions, base.extraContributions);

  const months = arrayOr<string>(source.months, base.months)
    .filter((key): key is string => typeof key === 'string' && /^\d{4}-\d{2}$/.test(key))
    .filter((key, index, all) => all.indexOf(key) === index)
    .sort((a, b) => a.localeCompare(b));

  const monthlyPayments: MonthlyPaymentRecord[] = arrayOr<Partial<MonthlyPaymentRecord>>(
    source.monthlyPayments,
    base.monthlyPayments,
  ).map((payment, index) => {
    const rawId = stringOr(payment.id) || `mp_${index}`;
    const rawMemberId = stringOr(payment.memberId) || members[0]?.id || `m_${index}`;
    return {
      id: rawId === 'mp_2026-11_mariajose' ? 'mp_2026-11_antonio' : rawId,
      month: typeof payment.month === 'string' && /^\d{4}-\d{2}$/.test(payment.month) ? payment.month : months[0] || todayISO().slice(0, 7),
      memberId: rawMemberId === 'm_mariajose' ? 'm_antonio' : rawMemberId,
      amount: Math.max(0, roundMoney(numberOr(payment.amount, 0))),
      date: isIsoDate(payment.date) ? payment.date : todayISO(),
      notes: stringOr(payment.notes).trim() || undefined,
      historical: payment.historical === true,
    };
  });

  const fixedQueries: FixedQuery[] = arrayOr<Partial<FixedQuery>>(source.fixedQueries, []).map((query, index) => ({
    id: stringOr(query.id) || `fq_${index}`,
    title: stringOr(query.title).trim() || `Consulta ${index + 1}`,
    description: stringOr(query.description).trim(),
    result: stringOr(query.result).trim(),
  })).filter((query) => query.result.length > 0);

  return {
    name: /vs\s+park/i.test(stringOr(source.name)) ? SYNDICATE_APP_NAME : stringOr(source.name).trim() || base.name,
    costPerDraw: Math.max(0, roundMoney(numberOr(source.costPerDraw, base.costPerDraw))),
    monthlyFee: Math.max(0, roundMoney(numberOr(source.monthlyFee, base.monthlyFee))),
    members,
    draws,
    extraPrizes,
    extraContributions,
    months,
    monthlyPayments,
    distributions,
    fixedQueries,
  };
}
