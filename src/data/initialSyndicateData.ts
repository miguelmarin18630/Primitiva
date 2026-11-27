/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/** Nombre corto y oficial de la aplicación. */
export const SYNDICATE_APP_NAME = 'Primitiva Temes vs Parkinson';

export interface Member {
  id: string;
  name: string;
  totalPaid: number; // Total aportado a la peña
  joinedDate: string;
  isUpToDate: boolean;
  notes?: string;
  balance: number; // Saldo individual atribuible o arrastrado
  // Historial de pagos individuales
  paymentsHistory: {
    id: string;
    date: string;
    amount: number;
    concept: string;
  }[];
}

export interface WinningCombination {
  numbers: number[]; // 6 números (1-49)
  complementario: number; // 1-49
  reintegro: number; // 0-9
  joker?: string;
}

/** Una apuesta jugada: cada línea del boleto (1..5) cuesta 1 €. */
export interface BetLine {
  line: number; // Orden de la apuesta dentro del boleto (1, 2, 3, 4 o 5)
  numbers: number[]; // 6 números distintos del 1 al 49
  reintegro?: number; // 0-9, cuando se puede leer en el resguardo
}

export interface DrawRecord {
  id: string;
  index: number;
  date: string; // Formato YYYY-MM-DD
  displayDate: string; // Formato DD/MM/AA
  dayOfWeek: string; // Lunes, Jueves, Sábado
  betCost: number; // Importe jugado = número de líneas × 1 €
  prizeWon: number; // Premio obtenido (0 €, 5 €, 8 €, etc.)
  notes?: string;
  /** Nuestra apuesta tal como se registró (el nombre histórico del campo es confuso). */
  /** Todas las apuestas jugadas en este sorteo (una por línea del boleto). */
  lines?: BetLine[];
  /** Apuesta única heredada de versiones anteriores; se usa como respaldo si no hay lines. */
  winningCombination?: WinningCombination;
  /** Combinación oficial del sorteo, recuperada de la fuente pública. */
  officialCombination?: WinningCombination;
  /** Si jugamos al Joker en este boleto (false = JOKER: NO). */
  jokerPlayed?: boolean;
  /** Quién registró la apuesta: permite que un socio borre sólo la suya. */
  createdBy?: 'admin' | 'socio';
  ticketImage?: string; // Foto del boleto jugado (Data URL o URL)
  status: 'jugado' | 'pendiente';
}

export interface DistributionRecord {
  id: string;
  date: string;
  type: 'premios' | 'caja' | 'custom';
  amount: number;      // Total repartido
  perMember: number;   // Importe abonado a cada socio
}

export interface MonthlyPaymentRecord {
  id: string;
  month: string; // YYYY-MM
  memberId: string;
  amount: number;
  date: string;
  notes?: string;
  /** Los registros ya incluidos en el histórico no se vuelven a sumar a la caja. */
  historical?: boolean;
}

export interface ExtraContribution {
  id: string;
  memberOrConcept: string;
  amount: number;
  date: string;
  notes: string;
}

/** Opción fija de la pestaña de herramientas, creada por el administrador. */
export interface FixedQuery {
  id: string;
  title: string;
  description: string;
  result: string;
}

export interface SyndicateData {
  name: string;
  costPerDraw: number;
  monthlyFee: number; // Cuota mensual por socio (por defecto 5 €)
  members: Member[];
  draws: DrawRecord[];
  extraPrizes: ExtraContribution[]; // Premios recibidos (ingresos por premio)
  extraContributions: ExtraContribution[]; // Aportaciones fuera de la cuota mensual
  months: string[]; // Meses controlados en el tablero de cuotas (YYYY-MM)
  monthlyPayments: MonthlyPaymentRecord[]; // Cuotas marcadas como pagadas
  distributions: DistributionRecord[];
  fixedQueries: FixedQuery[]; // Consultas fijas añadidas por el administrador
}

export const REAL_SYNDICATE_DATA: SyndicateData = {
  name: SYNDICATE_APP_NAME,
  costPerDraw: 5.0,
  monthlyFee: 5.0,
  distributions: [],
  fixedQueries: [],
  extraPrizes: [],
  extraContributions: [
    {
      id: "ec_leti_1",
      memberOrConcept: "LETI",
      amount: 3.0,
      date: "2026-11-14",
      notes: "Aportación extra de LETI (no es una cuota mensual)"
    }
  ],
  months: ["2026-11"],
  monthlyPayments: [
    { id: "mp_2026-11_ana", month: "2026-11", memberId: "m_ana", amount: 5.0, date: "2026-11-01", historical: true },
    { id: "mp_2026-11_antonio", month: "2026-11", memberId: "m_antonio", amount: 5.0, date: "2026-11-01", historical: true },
    { id: "mp_2026-11_jacinto", month: "2026-11", memberId: "m_jacinto", amount: 5.0, date: "2026-11-01", historical: true },
    { id: "mp_2026-11_juan", month: "2026-11", memberId: "m_juan", amount: 5.0, date: "2026-11-01", historical: true },
    { id: "mp_2026-11_leti", month: "2026-11", memberId: "m_leti", amount: 5.0, date: "2026-11-01", historical: true },
    { id: "mp_2026-11_miguel", month: "2026-11", memberId: "m_miguel", amount: 5.0, date: "2026-11-01", historical: true },
    { id: "mp_2026-11_pablo", month: "2026-11", memberId: "m_pablo", amount: 5.0, date: "2026-11-01", historical: true },
    { id: "mp_2026-11_sofia", month: "2026-11", memberId: "m_sofia", amount: 5.0, date: "2026-11-01", historical: true },
    { id: "mp_2026-11_jorge", month: "2026-11", memberId: "m_jorge", amount: 5.0, date: "2026-11-01", historical: true },
    { id: "mp_2026-11_joseramon", month: "2026-11", memberId: "m_joseramon", amount: 5.0, date: "2026-11-01", historical: true },
  ],
  members: [
    {
      id: "m_ana",
      name: "ANA",
      totalPaid: 30.0,
      joinedDate: "2026-03-16",
      isUpToDate: true,
      balance: 0.0,
      notes: "Socia fundadora. Cuota completa al día.",
      paymentsHistory: [
        { id: "p_ana_1", date: "2026-03-15", amount: 30.0, concept: "Aportación de cuota completa" }
      ]
    },
    {
      id: "m_antonio",
      name: "ANTONIO",
      totalPaid: 30.0,
      joinedDate: "2026-03-16",
      isUpToDate: true,
      balance: 0.0,
      notes: "Socio fundador. Cuota completa al día.",
      paymentsHistory: [
        { id: "p_ant_1", date: "2026-03-15", amount: 30.0, concept: "Aportación de cuota completa" }
      ]
    },
    {
      id: "m_jacinto",
      name: "JACINTO",
      totalPaid: 30.0,
      joinedDate: "2026-03-16",
      isUpToDate: true,
      balance: 0.0,
      notes: "Socio fundador. Cuota completa al día.",
      paymentsHistory: [
        { id: "p_jac_1", date: "2026-03-15", amount: 30.0, concept: "Aportación de cuota completa" }
      ]
    },
    {
      id: "m_juan",
      name: "JUAN",
      totalPaid: 30.0,
      joinedDate: "2026-03-16",
      isUpToDate: true,
      balance: 0.0,
      notes: "Socio fundador. Cuota completa al día.",
      paymentsHistory: [
        { id: "p_juan_1", date: "2026-03-15", amount: 30.0, concept: "Aportación de cuota completa" }
      ]
    },
    {
      id: "m_leti",
      name: "LETI",
      totalPaid: 30.0,
      joinedDate: "2026-03-16",
      isUpToDate: true,
      balance: 0.0,
      notes: "Socia fundadora. Cuota completa al día.",
      paymentsHistory: [
        { id: "p_leti_1", date: "2026-03-15", amount: 30.0, concept: "Aportación de cuota completa" }
      ]
    },
    {
      id: "m_miguel",
      name: "MIGUEL",
      totalPaid: 30.0,
      joinedDate: "2026-03-16",
      isUpToDate: true,
      balance: 0.0,
      notes: "Socio fundador. Cuota completa al día.",
      paymentsHistory: [
        { id: "p_mig_1", date: "2026-03-15", amount: 30.0, concept: "Aportación de cuota completa" }
      ]
    },
    {
      id: "m_pablo",
      name: "PABLO",
      totalPaid: 30.0,
      joinedDate: "2026-03-16",
      isUpToDate: true,
      balance: 0.0,
      notes: "Socio fundador. Cuota completa al día.",
      paymentsHistory: [
        { id: "p_pab_1", date: "2026-03-15", amount: 30.0, concept: "Aportación de cuota completa" }
      ]
    },
    {
      id: "m_sofia",
      name: "SOFÍA",
      totalPaid: 30.0,
      joinedDate: "2026-03-16",
      isUpToDate: true,
      balance: 0.0,
      notes: "Socia fundadora. Cuota completa al día.",
      paymentsHistory: [
        { id: "p_sof_1", date: "2026-03-15", amount: 30.0, concept: "Aportación de cuota completa" }
      ]
    },
    {
      id: "m_jorge",
      name: "JORGE",
      totalPaid: 30.0,
      joinedDate: "2026-03-16",
      isUpToDate: true,
      balance: 0.0,
      notes: "Socio fundador. Cuota completa al día.",
      paymentsHistory: [
        { id: "p_jor_1", date: "2026-03-15", amount: 30.0, concept: "Aportación de cuota completa" }
      ]
    },
    {
      id: "m_joseramon",
      name: "JOSÉ RAMÓN",
      totalPaid: 22.0, // Cuota proporcional real abonada al incorporarse en mayo de 2026.
      joinedDate: "2026-05-14",
      isUpToDate: true,
      balance: 0.0,
      notes: "Cuota proporcional de 22 € abonada al incorporarse en mayo de 2026. Al corriente según acuerdo de la peña; no se contabiliza ningún ingreso ficticio de 8 €.",
      paymentsHistory: [
        { id: "p_jr_1", date: "2026-05-14", amount: 22.0, concept: "Aportación de incorporación (cuota proporcional)" }
      ]
    }
  ],
  draws: [
    { id: "d_1", index: 1, date: "2026-03-16", ticketImage: "/assets/boletos/2026-03-16.jpg", displayDate: "16/03/26", dayOfWeek: "Lunes", betCost: 5.0, prizeWon: 0.0, jokerPlayed: false, status: "jugado",
      lines: [
        { line: 1, numbers: [14, 19, 32, 37, 48, 49], reintegro: 5 },
        { line: 2, numbers: [3, 9, 18, 35, 36, 41] },
        { line: 3, numbers: [10, 24, 25, 33, 36, 48] },
        { line: 4, numbers: [5, 19, 22, 32, 39, 49] },
        { line: 5, numbers: [2, 6, 24, 28, 30, 49] }
      ],
      officialCombination: { numbers: [5, 8, 23, 28, 40, 44], complementario: 18, reintegro: 6, joker: "4706895" }
    },
    { id: "d_2", index: 2, date: "2026-03-19", ticketImage: "/assets/boletos/2026-03-19.jpg", displayDate: "19/03/26", dayOfWeek: "Jueves", betCost: 5.0, prizeWon: 8.0, notes: "¡Premio de 8 €!", jokerPlayed: false, status: "jugado",
      lines: [
        { line: 1, numbers: [3, 14, 21, 23, 24, 33], reintegro: 0 },
        { line: 2, numbers: [4, 8, 13, 23, 42, 44] },
        { line: 3, numbers: [4, 10, 22, 24, 39, 44] },
        { line: 4, numbers: [9, 17, 18, 22, 24, 45] },
        { line: 5, numbers: [1, 2, 25, 26, 31, 49] }
      ],
      officialCombination: { numbers: [10, 17, 18, 30, 34, 45], complementario: 6, reintegro: 6, joker: "9618596" }
    },
    { id: "d_3", index: 3, date: "2026-03-26", ticketImage: "/assets/boletos/2026-03-26.jpg", displayDate: "26/03/26", dayOfWeek: "Jueves", betCost: 5.0, prizeWon: 0.0, jokerPlayed: false, status: "jugado",
      lines: [
        { line: 1, numbers: [8, 15, 17, 23, 31, 43], reintegro: 9 },
        { line: 2, numbers: [2, 14, 16, 18, 30, 48] },
        { line: 3, numbers: [2, 6, 9, 22, 26, 47] },
        { line: 4, numbers: [4, 15, 18, 28, 42, 43] },
        { line: 5, numbers: [4, 8, 12, 27, 30, 35] }
      ],
      officialCombination: { numbers: [3, 15, 25, 38, 44, 46], complementario: 21, reintegro: 6, joker: "3929930" }
    },
    { id: "d_4", index: 4, date: "2026-04-02", ticketImage: "/assets/boletos/2026-04-02.jpg", displayDate: "02/04/26", dayOfWeek: "Jueves", betCost: 5.0, prizeWon: 0.0, jokerPlayed: false, status: "jugado",
      lines: [
        { line: 1, numbers: [11, 12, 30, 34, 46, 47], reintegro: 2 },
        { line: 2, numbers: [2, 5, 21, 29, 35, 40] },
        { line: 3, numbers: [2, 9, 15, 35, 47, 48] },
        { line: 4, numbers: [1, 17, 32, 34, 47, 49] },
        { line: 5, numbers: [12, 33, 37, 39, 44, 46] }
      ],
      officialCombination: { numbers: [5, 11, 18, 22, 38, 44], complementario: 12, reintegro: 3, joker: "6317039" }
    },
    { id: "d_5", index: 5, date: "2026-04-09", ticketImage: "/assets/boletos/2026-04-09.jpg", displayDate: "09/04/26", dayOfWeek: "Jueves", betCost: 5.0, prizeWon: 0.0, jokerPlayed: false, status: "jugado",
      lines: [
        { line: 1, numbers: [11, 12, 30, 34, 46, 47], reintegro: 2 },
        { line: 2, numbers: [2, 5, 21, 29, 35, 40] },
        { line: 3, numbers: [2, 9, 15, 35, 47, 48] },
        { line: 4, numbers: [1, 17, 32, 34, 47, 49] },
        { line: 5, numbers: [12, 33, 37, 39, 44, 46] }
      ],
      officialCombination: { numbers: [4, 23, 24, 30, 38, 40], complementario: 45, reintegro: 4, joker: "1533357" }
    },
    { id: "d_6", index: 6, date: "2026-04-16", ticketImage: "/assets/boletos/2026-04-16.jpg", displayDate: "16/04/26", dayOfWeek: "Jueves", betCost: 5.0, prizeWon: 0.0, jokerPlayed: false, status: "jugado",
      lines: [
        { line: 1, numbers: [4, 31, 37, 41, 47, 49], reintegro: 6 },
        { line: 2, numbers: [4, 10, 20, 21, 38, 46] },
        { line: 3, numbers: [6, 18, 23, 27, 34, 42] },
        { line: 4, numbers: [9, 15, 16, 21, 47, 48] },
        { line: 5, numbers: [2, 5, 7, 32, 38, 39] }
      ],
      officialCombination: { numbers: [9, 10, 16, 36, 42, 43], complementario: 31, reintegro: 8, joker: "5121352" }
    },
    { id: "d_7", index: 7, date: "2026-04-23", ticketImage: "/assets/boletos/2026-04-23.jpg", displayDate: "23/04/26", dayOfWeek: "Jueves", betCost: 5.0, prizeWon: 0.0, jokerPlayed: false, status: "jugado",
      lines: [
        { line: 1, numbers: [7, 15, 28, 42, 44, 49], reintegro: 7 },
        { line: 2, numbers: [22, 30, 33, 38, 45, 49] },
        { line: 3, numbers: [18, 21, 31, 33, 40, 42] },
        { line: 4, numbers: [7, 17, 18, 19, 21, 49] },
        { line: 5, numbers: [8, 16, 23, 34, 37, 45] }
      ],
      officialCombination: { numbers: [11, 13, 20, 26, 27, 34], complementario: 10, reintegro: 8, joker: "2819883" }
    },
    { id: "d_8", index: 8, date: "2026-04-30", ticketImage: "/assets/boletos/2026-04-30.jpg", displayDate: "30/04/26", dayOfWeek: "Jueves", betCost: 5.0, prizeWon: 5.0, notes: "Premio de 5 €", jokerPlayed: false, status: "jugado",
      lines: [
        { line: 1, numbers: [1, 9, 28, 36, 37, 46], reintegro: 6 },
        { line: 2, numbers: [5, 12, 17, 32, 41, 42] },
        { line: 3, numbers: [1, 4, 7, 13, 21, 28] },
        { line: 4, numbers: [9, 20, 22, 38, 41, 42] },
        { line: 5, numbers: [19, 21, 22, 23, 30, 41] }
      ],
      officialCombination: { numbers: [7, 8, 9, 13, 28, 42], complementario: 29, reintegro: 8, joker: "0754026" }
    },
    { id: "d_9", index: 9, date: "2026-05-07", ticketImage: "/assets/boletos/2026-05-07.jpg", displayDate: "07/05/26", dayOfWeek: "Jueves", betCost: 5.0, prizeWon: 8.0, notes: "¡Premio de 8 €!", jokerPlayed: false, status: "jugado",
      lines: [
        { line: 1, numbers: [10, 17, 25, 28, 39, 43], reintegro: 5 },
        { line: 2, numbers: [8, 17, 24, 25, 32, 35] },
        { line: 3, numbers: [7, 12, 19, 28, 30, 32] },
        { line: 4, numbers: [1, 11, 14, 21, 39, 40] },
        { line: 5, numbers: [1, 4, 18, 28, 35, 45] }
      ],
      officialCombination: { numbers: [1, 6, 7, 13, 25, 48], complementario: 5, reintegro: 5, joker: "6842292" }
    },
    { id: "d_10", index: 10, date: "2026-05-14", ticketImage: "/assets/boletos/2026-05-14.jpg", displayDate: "14/05/26", dayOfWeek: "Jueves", betCost: 5.0, prizeWon: 0.0, jokerPlayed: false, status: "jugado",
      lines: [
        { line: 1, numbers: [2, 8, 26, 28, 33, 38], reintegro: 7 },
        { line: 2, numbers: [8, 19, 36, 38, 41, 43] },
        { line: 3, numbers: [5, 14, 17, 20, 46, 48] },
        { line: 4, numbers: [2, 13, 16, 23, 32, 38] },
        { line: 5, numbers: [1, 4, 18, 19, 21, 42] }
      ],
      officialCombination: { numbers: [2, 5, 8, 20, 21, 22], complementario: 44, reintegro: 3, joker: "4947408" }
    },
    { id: "d_11", index: 11, date: "2026-05-21", ticketImage: "/assets/boletos/2026-05-21.jpg", displayDate: "21/05/26", dayOfWeek: "Jueves", betCost: 5.0, prizeWon: 0.0, jokerPlayed: false, status: "jugado",
      lines: [
        { line: 1, numbers: [2, 8, 26, 28, 33, 38], reintegro: 7 },
        { line: 2, numbers: [8, 19, 36, 38, 41, 43] },
        { line: 3, numbers: [5, 14, 17, 20, 46, 48] },
        { line: 4, numbers: [2, 13, 16, 23, 32, 38] },
        { line: 5, numbers: [1, 4, 18, 19, 21, 42] }
      ],
      officialCombination: { numbers: [9, 12, 18, 33, 37, 49], complementario: 31, reintegro: 3, joker: "7680567" }
    },
    { id: "d_12", index: 12, date: "2026-05-28", ticketImage: "/assets/boletos/2026-05-28.jpg", displayDate: "28/05/26", dayOfWeek: "Jueves", betCost: 5.0, prizeWon: 8.0, notes: "¡Premio de 8 €!", jokerPlayed: false, status: "jugado",
      lines: [
        { line: 1, numbers: [10, 13, 26, 29, 37, 43], reintegro: 1 },
        { line: 2, numbers: [8, 13, 16, 24, 46, 47] },
        { line: 3, numbers: [2, 7, 22, 40, 46, 49] },
        { line: 4, numbers: [3, 21, 31, 42, 43, 44] },
        { line: 5, numbers: [23, 26, 29, 38, 46, 48] }
      ],
      officialCombination: { numbers: [3, 9, 10, 26, 43, 46], complementario: 5, reintegro: 4, joker: "3066493" }
    },
    { id: "d_13", index: 13, date: "2026-06-06", ticketImage: "/assets/boletos/2026-06-06.jpg", displayDate: "06/06/26", dayOfWeek: "Sábado", betCost: 5.0, prizeWon: 0.0, jokerPlayed: false, status: "jugado",
      lines: [
        { line: 1, numbers: [10, 13, 26, 29, 37, 43], reintegro: 1 },
        { line: 2, numbers: [8, 13, 16, 24, 46, 47] },
        { line: 3, numbers: [2, 7, 22, 40, 46, 49] },
        { line: 4, numbers: [3, 21, 31, 42, 43, 44] },
        { line: 5, numbers: [23, 26, 29, 38, 46, 48] }
      ],
      officialCombination: { numbers: [1, 6, 16, 17, 37, 43], complementario: 5, reintegro: 7, joker: "9910395" }
    },
    { id: "d_14", index: 14, date: "2026-06-11", ticketImage: "/assets/boletos/2026-06-11.jpg", displayDate: "11/06/26", dayOfWeek: "Jueves", betCost: 5.0, prizeWon: 0.0, jokerPlayed: false, status: "jugado",
      lines: [
        { line: 1, numbers: [2, 5, 18, 21, 28, 38], reintegro: 2 },
        { line: 2, numbers: [4, 8, 17, 21, 26, 34] },
        { line: 3, numbers: [7, 20, 23, 29, 47, 49] },
        { line: 4, numbers: [1, 6, 8, 24, 35, 38] },
        { line: 5, numbers: [6, 15, 31, 33, 34, 46] }
      ],
      officialCombination: { numbers: [12, 15, 22, 30, 32, 49], complementario: 33, reintegro: 8, joker: "3449409" }
    },
    { id: "d_15", index: 15, date: "2026-06-18", ticketImage: "/assets/boletos/2026-06-18.jpg", displayDate: "18/06/26", dayOfWeek: "Jueves", betCost: 5.0, prizeWon: 0.0, jokerPlayed: false, status: "jugado",
      lines: [
        { line: 1, numbers: [10, 13, 26, 29, 37, 43], reintegro: 1 },
        { line: 2, numbers: [8, 13, 16, 24, 46, 47] },
        { line: 3, numbers: [2, 7, 22, 40, 46, 49] },
        { line: 4, numbers: [3, 21, 31, 42, 43, 44] },
        { line: 5, numbers: [23, 26, 29, 38, 46, 48] }
      ],
      officialCombination: { numbers: [1, 10, 13, 25, 27, 38], complementario: 33, reintegro: 6, joker: "6452737" }
    },
    { id: "d_16", index: 16, date: "2026-07-02", ticketImage: "/assets/boletos/2026-07-02.jpg", displayDate: "02/07/26", dayOfWeek: "Jueves", betCost: 5.0, prizeWon: 0.0, jokerPlayed: false, status: "jugado",
      lines: [
        { line: 1, numbers: [10, 13, 26, 29, 37, 43], reintegro: 1 },
        { line: 2, numbers: [8, 13, 16, 24, 46, 47] },
        { line: 3, numbers: [2, 7, 22, 40, 46, 49] },
        { line: 4, numbers: [3, 21, 31, 42, 43, 44] },
        { line: 5, numbers: [23, 26, 29, 38, 46, 48] }
      ],
      officialCombination: { numbers: [5, 12, 14, 33, 35, 40], complementario: 9, reintegro: 5, joker: "9423082" }
    },
    { id: "d_17", index: 17, date: "2026-07-09", ticketImage: "/assets/boletos/2026-07-09.jpg", displayDate: "09/07/26", dayOfWeek: "Jueves", betCost: 5.0, prizeWon: 0.0, jokerPlayed: false, status: "jugado",
      lines: [
        { line: 1, numbers: [1, 20, 21, 27, 32, 36], reintegro: 1 },
        { line: 2, numbers: [7, 30, 31, 32, 33, 40] },
        { line: 3, numbers: [1, 6, 8, 23, 41, 49] },
        { line: 4, numbers: [2, 5, 14, 15, 31, 45] },
        { line: 5, numbers: [6, 8, 28, 32, 46, 47] }
      ],
      officialCombination: { numbers: [22, 28, 30, 35, 38, 43], complementario: 3, reintegro: 8, joker: "1482783" }
    },
    { id: "d_18", index: 18, date: "2026-08-01", ticketImage: "/assets/boletos/2026-08-01.jpg", displayDate: "01/08/26", dayOfWeek: "Sábado", betCost: 5.0, prizeWon: 0.0, jokerPlayed: false, status: "jugado",
      lines: [
        { line: 1, numbers: [2, 12, 22, 31, 33, 45], reintegro: 2 },
        { line: 2, numbers: [3, 6, 25, 32, 39, 46] },
        { line: 3, numbers: [8, 20, 25, 27, 28, 35] },
        { line: 4, numbers: [5, 8, 9, 20, 27, 47] },
        { line: 5, numbers: [5, 10, 22, 33, 39, 43] }
      ],
      officialCombination: { numbers: [3, 7, 15, 42, 43, 49], complementario: 44, reintegro: 9, joker: "7265376" }
    },
    { id: "d_19", index: 19, date: "2026-08-06", ticketImage: "/assets/boletos/2026-08-06.jpg", displayDate: "06/08/26", dayOfWeek: "Jueves", betCost: 5.0, prizeWon: 0.0, jokerPlayed: false, status: "jugado",
      lines: [
        { line: 1, numbers: [3, 8, 20, 26, 30, 40], reintegro: 8 },
        { line: 2, numbers: [14, 18, 21, 23, 43, 49] },
        { line: 3, numbers: [1, 7, 9, 36, 45, 47] },
        { line: 4, numbers: [12, 17, 29, 31, 36, 47] },
        { line: 5, numbers: [10, 16, 17, 26, 32, 43] }
      ],
      officialCombination: { numbers: [3, 9, 14, 19, 22, 26], complementario: 13, reintegro: 4, joker: "0559707" }
    },
    { id: "d_20", index: 20, date: "2026-08-13", ticketImage: "/assets/boletos/2026-08-13.jpg", displayDate: "13/08/26", dayOfWeek: "Jueves", betCost: 5.0, prizeWon: 0.0, jokerPlayed: false, status: "jugado",
      lines: [
        { line: 1, numbers: [3, 8, 20, 26, 30, 40], reintegro: 8 },
        { line: 2, numbers: [14, 18, 21, 23, 43, 49] },
        { line: 3, numbers: [1, 7, 9, 36, 45, 47] },
        { line: 4, numbers: [12, 17, 29, 31, 36, 47] },
        { line: 5, numbers: [10, 16, 17, 26, 32, 43] }
      ],
      officialCombination: { numbers: [21, 27, 33, 41, 48, 49], complementario: 11, reintegro: 2, joker: "8219703" }
    },
    { id: "d_21", index: 21, date: "2026-08-22", ticketImage: "/assets/boletos/2026-08-22.jpg", displayDate: "22/08/26", dayOfWeek: "Sábado", betCost: 5.0, prizeWon: 5.0, notes: "Premio de 5 €", jokerPlayed: false, status: "jugado",
      lines: [
        { line: 1, numbers: [18, 20, 27, 39, 40, 45], reintegro: 8 },
        { line: 2, numbers: [1, 18, 23, 30, 38, 42] },
        { line: 3, numbers: [4, 30, 33, 42, 44, 45] },
        { line: 4, numbers: [2, 3, 18, 19, 41, 42] },
        { line: 5, numbers: [2, 18, 24, 27, 39, 46] }
      ],
      officialCombination: { numbers: [5, 22, 30, 34, 45, 49], complementario: 46, reintegro: 8, joker: "8352771" }
    },
    { id: "d_22", index: 22, date: "2026-08-27", ticketImage: "/assets/boletos/2026-08-27.jpg", displayDate: "27/08/26", dayOfWeek: "Jueves", betCost: 5.0, prizeWon: 0.0, jokerPlayed: false, status: "jugado",
      lines: [
        { line: 1, numbers: [16, 18, 19, 23, 35, 40], reintegro: 9 },
        { line: 2, numbers: [14, 15, 16, 26, 28, 37] },
        { line: 3, numbers: [3, 18, 24, 32, 34, 49] },
        { line: 4, numbers: [9, 12, 18, 36, 41, 49] },
        { line: 5, numbers: [8, 9, 21, 23, 39, 48] }
      ],
      officialCombination: { numbers: [2, 8, 9, 33, 36, 38], complementario: 48, reintegro: 3, joker: "7016152" }
    },
    { id: "d_23", index: 23, date: "2026-09-03", ticketImage: "/assets/boletos/2026-09-03.jpg", displayDate: "03/09/26", dayOfWeek: "Jueves", betCost: 5.0, prizeWon: 0.0, jokerPlayed: false, status: "jugado",
      lines: [
        { line: 1, numbers: [1, 2, 3, 4, 14, 42], reintegro: 0 },
        { line: 2, numbers: [5, 6, 14, 15, 38, 42] },
        { line: 3, numbers: [4, 7, 8, 10, 22, 29] },
        { line: 4, numbers: [7, 19, 24, 25, 30, 44] },
        { line: 5, numbers: [11, 12, 34, 35, 36, 41] }
      ],
      officialCombination: { numbers: [20, 24, 29, 34, 39, 40], complementario: 13, reintegro: 5, joker: "6686741" }
    },
    { id: "d_24", index: 24, date: "2026-09-05", ticketImage: "/assets/boletos/2026-09-05.jpg", displayDate: "05/09/26", dayOfWeek: "Sábado", betCost: 5.0, prizeWon: 0.0, jokerPlayed: false, status: "jugado",
      lines: [
        { line: 1, numbers: [4, 19, 24, 31, 37, 46], reintegro: 0 },
        { line: 2, numbers: [2, 22, 37, 40, 47, 48] },
        { line: 3, numbers: [2, 19, 28, 29, 43, 48] },
        { line: 4, numbers: [4, 9, 20, 21, 28, 32] },
        { line: 5, numbers: [5, 8, 13, 31, 44, 49] }
      ],
      officialCombination: { numbers: [3, 12, 19, 31, 45, 47], complementario: 1, reintegro: 3, joker: "6414438" }
    },
    { id: "d_25", index: 25, date: "2026-09-10", ticketImage: "/assets/boletos/2026-09-10.jpg", displayDate: "10/09/26", dayOfWeek: "Jueves", betCost: 5.0, prizeWon: 0.0, jokerPlayed: false, status: "jugado",
      lines: [
        { line: 1, numbers: [5, 12, 28, 34, 42, 49], reintegro: 1 },
        { line: 2, numbers: [12, 23, 36, 41, 45, 48] },
        { line: 3, numbers: [2, 4, 30, 39, 41, 48] },
        { line: 4, numbers: [15, 16, 21, 31, 32, 35] },
        { line: 5, numbers: [2, 6, 17, 37, 40, 45] }
      ],
      officialCombination: { numbers: [17, 26, 35, 44, 45, 48], complementario: 3, reintegro: 5, joker: "3341852" }
    },
    { id: "d_26", index: 26, date: "2026-09-17", ticketImage: "/assets/boletos/2026-09-17.jpg", displayDate: "17/09/26", dayOfWeek: "Jueves", betCost: 5.0, prizeWon: 0.0, jokerPlayed: false, status: "jugado",
      lines: [
        { line: 1, numbers: [1, 2, 6, 12, 18, 32], reintegro: 7 },
        { line: 2, numbers: [8, 27, 28, 30, 43, 48] },
        { line: 3, numbers: [3, 9, 17, 24, 36, 47] },
        { line: 4, numbers: [12, 13, 24, 32, 48, 49] },
        { line: 5, numbers: [1, 3, 8, 10, 21, 39] }
      ],
      officialCombination: { numbers: [19, 20, 24, 25, 43, 46], complementario: 47, reintegro: 8, joker: "1024255" }
    },
    { id: "d_27", index: 27, date: "2026-09-19", ticketImage: "/assets/boletos/2026-09-19.jpg", displayDate: "19/09/26", dayOfWeek: "Sábado", betCost: 5.0, prizeWon: 0.0, jokerPlayed: false, status: "jugado",
      lines: [
        { line: 1, numbers: [2, 9, 27, 37, 40, 43], reintegro: 7 },
        { line: 2, numbers: [2, 9, 13, 19, 31, 42] },
        { line: 3, numbers: [10, 12, 19, 30, 36, 44] },
        { line: 4, numbers: [5, 19, 26, 32, 47, 48] },
        { line: 5, numbers: [3, 6, 9, 16, 23, 29] }
      ],
      officialCombination: { numbers: [7, 10, 40, 44, 45, 46], complementario: 19, reintegro: 4, joker: "8810028" }
    },
    { id: "d_45", index: 28, date: "2026-09-21", ticketImage: "/assets/boletos/2026-09-21.jpg", displayDate: "21/09/26", dayOfWeek: "Lunes", betCost: 5.0, prizeWon: 0.0, jokerPlayed: false, status: "jugado",
      lines: [
        { line: 1, numbers: [3, 13, 26, 32, 41, 44], reintegro: 6 },
        { line: 2, numbers: [5, 9, 23, 31, 43, 47] },
        { line: 3, numbers: [1, 5, 24, 30, 39, 45] },
        { line: 4, numbers: [1, 10, 12, 17, 25, 46] },
        { line: 5, numbers: [4, 20, 42, 44, 48, 49] }
      ],
      officialCombination: { numbers: [1, 4, 20, 34, 36, 37], complementario: 18, reintegro: 1, joker: "1147192" }
    },
    { id: "d_28", index: 29, date: "2026-09-26", ticketImage: "/assets/boletos/2026-09-26.jpg", displayDate: "26/09/26", dayOfWeek: "Sábado", betCost: 5.0, prizeWon: 5.0, notes: "Premio de 5 €", jokerPlayed: false, status: "jugado",
      lines: [
        { line: 1, numbers: [3, 6, 18, 25, 28, 44], reintegro: 4 },
        { line: 2, numbers: [12, 15, 19, 30, 34, 49] },
        { line: 3, numbers: [3, 20, 28, 30, 38, 40] },
        { line: 4, numbers: [5, 8, 9, 13, 15, 43] },
        { line: 5, numbers: [1, 11, 16, 38, 41, 45] }
      ],
      officialCombination: { numbers: [3, 9, 10, 30, 36, 45], complementario: 26, reintegro: 4, joker: "7368894" }
    },
    { id: "d_29", index: 30, date: "2026-10-01", ticketImage: "/assets/boletos/2026-10-01.jpg", displayDate: "01/10/26", dayOfWeek: "Jueves", betCost: 5.0, prizeWon: 0.0, jokerPlayed: false, status: "jugado",
      lines: [
        { line: 1, numbers: [3, 12, 22, 24, 25, 46], reintegro: 3 },
        { line: 2, numbers: [20, 23, 26, 28, 34, 37] },
        { line: 3, numbers: [15, 17, 19, 39, 43, 49] },
        { line: 4, numbers: [9, 32, 37, 39, 41, 47] },
        { line: 5, numbers: [2, 3, 20, 34, 38, 39] }
      ],
      officialCombination: { numbers: [4, 14, 16, 22, 33, 45], complementario: 46, reintegro: 7, joker: "6965325" }
    },
    { id: "d_30", index: 31, date: "2026-10-03", ticketImage: "/assets/boletos/2026-10-03.jpg", displayDate: "03/10/26", dayOfWeek: "Sábado", betCost: 5.0, prizeWon: 0.0, jokerPlayed: false, status: "jugado",
      lines: [
        { line: 1, numbers: [2, 3, 27, 28, 30, 43], reintegro: 5 },
        { line: 2, numbers: [2, 15, 17, 31, 38, 42] },
        { line: 3, numbers: [14, 15, 22, 23, 41, 49] },
        { line: 4, numbers: [6, 12, 13, 32, 43, 46] },
        { line: 5, numbers: [18, 25, 26, 31, 36, 48] }
      ],
      officialCombination: { numbers: [6, 20, 24, 27, 44, 45], complementario: 12, reintegro: 2, joker: "7407593" }
    },
    { id: "d_31", index: 32, date: "2026-10-05", ticketImage: "/assets/boletos/2026-10-05.jpg", displayDate: "05/10/26", dayOfWeek: "Lunes", betCost: 5.0, prizeWon: 0.0, jokerPlayed: false, status: "jugado",
      lines: [
        { line: 1, numbers: [3, 21, 23, 30, 34, 41], reintegro: 6 },
        { line: 2, numbers: [9, 19, 24, 26, 36, 46] },
        { line: 3, numbers: [8, 13, 22, 23, 24, 42] },
        { line: 4, numbers: [7, 31, 33, 37, 44, 49] },
        { line: 5, numbers: [5, 10, 15, 23, 43, 46] }
      ],
      officialCombination: { numbers: [4, 10, 20, 25, 40, 49], complementario: 29, reintegro: 3, joker: "7459175" }
    },
    { id: "d_32", index: 33, date: "2026-10-08", ticketImage: "/assets/boletos/2026-10-08.jpg", displayDate: "08/10/26", dayOfWeek: "Jueves", betCost: 5.0, prizeWon: 0.0, jokerPlayed: false, status: "jugado",
      lines: [
        { line: 1, numbers: [2, 3, 9, 38, 44, 45], reintegro: 7 },
        { line: 2, numbers: [22, 26, 28, 29, 37, 42] },
        { line: 3, numbers: [8, 12, 15, 39, 40, 46] },
        { line: 4, numbers: [10, 14, 20, 21, 33, 34] },
        { line: 5, numbers: [1, 2, 13, 18, 28, 42] }
      ],
      officialCombination: { numbers: [6, 7, 14, 16, 21, 37], complementario: 25, reintegro: 2, joker: "2445443" }
    },
    { id: "d_33", index: 34, date: "2026-10-15", ticketImage: "/assets/boletos/2026-10-15.jpg", displayDate: "15/10/26", dayOfWeek: "Jueves", betCost: 5.0, prizeWon: 0.0, jokerPlayed: false, status: "jugado",
      lines: [
        { line: 1, numbers: [14, 23, 26, 30, 33, 44], reintegro: 8 },
        { line: 2, numbers: [19, 29, 34, 40, 41, 49] },
        { line: 3, numbers: [2, 18, 22, 35, 39, 48] },
        { line: 4, numbers: [1, 2, 20, 33, 41, 46] },
        { line: 5, numbers: [2, 5, 7, 19, 44, 47] }
      ],
      officialCombination: { numbers: [6, 17, 24, 35, 39, 47], complementario: 18, reintegro: 3, joker: "2666233" }
    },
    { id: "d_34", index: 35, date: "2026-10-17", ticketImage: "/assets/boletos/2026-10-17.jpg", displayDate: "17/10/26", dayOfWeek: "Sábado", betCost: 5.0, prizeWon: 0.0, jokerPlayed: false, status: "jugado",
      lines: [
        { line: 1, numbers: [10, 25, 34, 40, 42, 49], reintegro: 8 },
        { line: 2, numbers: [2, 6, 10, 28, 34, 39] },
        { line: 3, numbers: [24, 34, 36, 37, 44, 47] },
        { line: 4, numbers: [2, 13, 18, 40, 41, 46] },
        { line: 5, numbers: [9, 17, 29, 30, 33, 39] }
      ],
      officialCombination: { numbers: [8, 9, 12, 14, 29, 45], complementario: 43, reintegro: 4, joker: "8525836" }
    },
    { id: "d_35", index: 36, date: "2026-10-22", ticketImage: "/assets/boletos/2026-10-22.jpg", displayDate: "22/10/26", dayOfWeek: "Jueves", betCost: 5.0, prizeWon: 0.0, jokerPlayed: false, status: "jugado",
      lines: [
        { line: 1, numbers: [17, 20, 29, 34, 42, 49], reintegro: 0 },
        { line: 2, numbers: [11, 12, 29, 39, 44, 45] },
        { line: 3, numbers: [18, 23, 24, 27, 30, 43] },
        { line: 4, numbers: [3, 8, 10, 29, 39, 42] },
        { line: 5, numbers: [3, 7, 8, 19, 36, 42] }
      ],
      officialCombination: { numbers: [1, 13, 22, 35, 42, 49], complementario: 17, reintegro: 1, joker: "3832054" }
    },
    { id: "d_36", index: 37, date: "2026-10-24", ticketImage: "/assets/boletos/2026-10-24.jpg", displayDate: "24/10/26", dayOfWeek: "Sábado", betCost: 5.0, prizeWon: 0.0, jokerPlayed: false, status: "jugado",
      lines: [
        { line: 1, numbers: [7, 19, 20, 23, 28, 36], reintegro: 2 },
        { line: 2, numbers: [3, 7, 23, 25, 27, 38] },
        { line: 3, numbers: [3, 7, 9, 16, 33, 44] },
        { line: 4, numbers: [6, 16, 17, 24, 26, 27] },
        { line: 5, numbers: [13, 17, 32, 38, 41, 47] }
      ],
      officialCombination: { numbers: [4, 5, 10, 31, 47, 48], complementario: 37, reintegro: 4, joker: "5745931" }
    },
    { id: "d_37", index: 38, date: "2026-10-29", ticketImage: "/assets/boletos/2026-10-29-31.jpg", displayDate: "29/10/26", dayOfWeek: "Jueves", betCost: 5.0, prizeWon: 0.0, jokerPlayed: false, status: "jugado",
      lines: [
        { line: 1, numbers: [6, 13, 38, 39, 40, 46], reintegro: 6 },
        { line: 2, numbers: [4, 14, 20, 28, 43, 45] },
        { line: 3, numbers: [2, 8, 16, 30, 33, 41] },
        { line: 4, numbers: [7, 18, 22, 23, 25, 31] },
        { line: 5, numbers: [9, 10, 11, 13, 15, 35] }
      ],
      officialCombination: { numbers: [2, 18, 19, 28, 31, 44], complementario: 9, reintegro: 9, joker: "3013180" }
    },
    { id: "d_38", index: 39, date: "2026-10-31", ticketImage: "/assets/boletos/2026-10-29-31.jpg", displayDate: "31/10/26", dayOfWeek: "Sábado", betCost: 5.0, prizeWon: 8.0, notes: "¡Premio de 8 €!", jokerPlayed: false, status: "jugado",
      lines: [
        { line: 1, numbers: [6, 13, 38, 39, 40, 46], reintegro: 6 },
        { line: 2, numbers: [4, 14, 20, 28, 43, 45] },
        { line: 3, numbers: [2, 8, 16, 30, 33, 41] },
        { line: 4, numbers: [7, 18, 22, 23, 25, 31] },
        { line: 5, numbers: [9, 10, 11, 13, 15, 35] }
      ],
      officialCombination: { numbers: [2, 6, 8, 17, 27, 30], complementario: 47, reintegro: 1, joker: "6262149" }
    },
    { id: "d_39", index: 40, date: "2026-11-05", ticketImage: "/assets/boletos/2026-11-05-07.jpg", displayDate: "05/11/26", dayOfWeek: "Jueves", betCost: 5.0, prizeWon: 0.0, jokerPlayed: false, status: "jugado",
      lines: [
        { line: 1, numbers: [20, 33, 40, 41, 45, 46], reintegro: 9 },
        { line: 2, numbers: [5, 12, 19, 25, 35, 41] },
        { line: 3, numbers: [1, 3, 6, 18, 43, 48] },
        { line: 4, numbers: [5, 19, 20, 30, 32, 41] },
        { line: 5, numbers: [11, 15, 34, 38, 44, 48] }
      ],
      officialCombination: { numbers: [4, 8, 9, 15, 31, 32], complementario: 2, reintegro: 3, joker: "6539402" }
    },
    { id: "d_40", index: 41, date: "2026-11-07", ticketImage: "/assets/boletos/2026-11-05-07.jpg", displayDate: "07/11/26", dayOfWeek: "Sábado", betCost: 5.0, prizeWon: 0.0, jokerPlayed: false, status: "jugado",
      lines: [
        { line: 1, numbers: [20, 33, 40, 41, 45, 46], reintegro: 9 },
        { line: 2, numbers: [5, 12, 19, 25, 35, 41] },
        { line: 3, numbers: [1, 3, 6, 18, 43, 48] },
        { line: 4, numbers: [5, 19, 20, 30, 32, 41] },
        { line: 5, numbers: [11, 15, 34, 38, 44, 48] }
      ],
      officialCombination: { numbers: [9, 13, 19, 25, 26, 30], complementario: 34, reintegro: 4, joker: "5497624" }
    },
    { id: "d_41", index: 42, date: "2026-11-12", displayDate: "12/11/26", dayOfWeek: "Jueves", betCost: 5.0, prizeWon: 0.0, jokerPlayed: false, status: "jugado",
      officialCombination: { numbers: [4, 10, 21, 32, 33, 45], complementario: 24, reintegro: 9, joker: "6606881" }
    },
    { id: "d_42", index: 43, date: "2026-11-14", displayDate: "14/11/26", dayOfWeek: "Sábado", betCost: 5.0, prizeWon: 0.0, jokerPlayed: false, status: "jugado",
      officialCombination: { numbers: [3, 22, 24, 30, 48, 49], complementario: 37, reintegro: 1, joker: "8820777" }
    },
    { id: "d_43", index: 44, date: "2026-11-19", ticketImage: "/assets/boletos/2026-11-19-21.jpg", displayDate: "19/11/26", dayOfWeek: "Jueves", betCost: 5.0, prizeWon: 0.0, jokerPlayed: false, status: "jugado",
      lines: [
        { line: 1, numbers: [6, 13, 38, 39, 40, 46], reintegro: 6 },
        { line: 2, numbers: [4, 14, 20, 28, 43, 45] },
        { line: 3, numbers: [2, 8, 16, 30, 33, 41] },
        { line: 4, numbers: [7, 18, 22, 23, 25, 31] },
        { line: 5, numbers: [9, 10, 11, 13, 15, 35] }
      ],
      officialCombination: { numbers: [20, 23, 36, 41, 44, 49], complementario: 34, reintegro: 3, joker: "0452653" }
    },
    { id: "d_44", index: 45, date: "2026-11-21", ticketImage: "/assets/boletos/2026-11-19-21.jpg", displayDate: "21/11/26", dayOfWeek: "Sábado", betCost: 5.0, prizeWon: 0.0, jokerPlayed: false, status: "jugado",
      lines: [
        { line: 1, numbers: [6, 13, 38, 39, 40, 46], reintegro: 6 },
        { line: 2, numbers: [4, 14, 20, 28, 43, 45] },
        { line: 3, numbers: [2, 8, 16, 30, 33, 41] },
        { line: 4, numbers: [7, 18, 22, 23, 25, 31] },
        { line: 5, numbers: [9, 10, 11, 13, 15, 35] }
      ],
      officialCombination: { numbers: [7, 12, 13, 22, 29, 39], complementario: 15, reintegro: 2, joker: "0031430" }
    }
  ]
};

/** Devuelve una copia independiente (nunca la constante compartida) para resets y precarga. */
export function createInitialSyndicateData(): SyndicateData {
  return JSON.parse(JSON.stringify(REAL_SYNDICATE_DATA)) as SyndicateData;
}
