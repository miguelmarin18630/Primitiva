/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  ArrowDownRight, ArrowUpRight, Calendar, Camera, CheckCircle2, ChevronDown, Clock,
  DollarSign, Download, Eye, Filter, History, Music, Pause, Play, Plus, RefreshCw, RotateCcw, Settings2, Share2, Shield,
  ShieldCheck, Sparkles, Trash2, Trophy, Unlock, Upload, UserPlus, Users, Volume1, Volume2, VolumeX, Wallet,
  Image as ImageIcon,
} from 'lucide-react';
import {
  createInitialSyndicateData,
  type BetLine,
  type DrawRecord,
  type ExtraContribution,
  type FixedQuery,
  type Member,
  type MonthlyPaymentRecord,
  type SyndicateData,
  type WinningCombination,
} from './data/initialSyndicateData';
import {
  apiFetch, authenticateAdmin, authenticateSocio, changeAdminPin, clearAuth, loadAuth, saveAuth, type Auth,
} from './lib/api';
import {
  betLinesCost, computeMonthlyData, computeTotals, drawBetLines, formatDateShort,
  isValidWinningCombination, money, monthNameFromKey, nextDrawIndex, normalizeBetLines,
  normalizeSyndicate, paidMembersInMonth, roundMoney, sanitizeTicketExtraction, todayISO,
  weekdayFromDate,
} from './lib/finance';
import { useSyncedSyndicate } from './hooks/useSyncedSyndicate';
import { CombinationComparison, Modal, StatCard, ToastStack, type Toast } from './components/ui';
import { PwaInstallPrompt } from './components/PwaInstallPrompt';
import { DrawCard } from './components/DrawCard';

type Tab = 'resumen' | 'cuotas' | 'socios' | 'sorteos' | 'meses' | 'reparto' | 'ai';

const TABS: { id: Tab; label: string; short: string }[] = [
  { id: 'resumen', label: 'Resumen General', short: 'Resumen' },
  { id: 'cuotas', label: 'Cuotas y Extras', short: 'Cuotas' },
  { id: 'socios', label: 'Socios', short: 'Socios' },
  { id: 'sorteos', label: 'Sorteos y Boletos', short: 'Sorteos' },
  { id: 'meses', label: 'Arrastre de Meses', short: 'Meses' },
  { id: 'reparto', label: 'Reparto y Ganancias', short: 'Reparto' },
  { id: 'ai', label: 'Asistente IA', short: 'IA' },
];

const MAX_TICKET_BYTES = 16 * 1024 * 1024;
const emptyWinningForm = {
  n1: 1, n2: 2, n3: 3, n4: 4, n5: 5, n6: 6,
  complementario: 7, reintegro: 0, joker: '',
};

export default function App() {
  // ---------- Sesión: el rol lo decide el token firmado por el servidor ----------
  const [auth, setAuth] = useState<Auth | null>(() => loadAuth());
  const authRef = useRef(auth);

  const updateAuth = useCallback((next: Auth | null) => {
    authRef.current = next;
    setAuth(next);
    if (next) saveAuth(next);
    else clearAuth();
  }, []);

  const [toasts, setToasts] = useState<Toast[]>([]);
  const showToast = useCallback((type: Toast['type'], message: string, title?: string) => {
    const id = `toast_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    setToasts((prev) => [...prev, { id, type, message, title }]);
    window.setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4500);
  }, []);
  const removeToast = useCallback((id: string) => setToasts((prev) => prev.filter((t) => t.id !== id)), []);

  const onAuthError = useCallback(() => {
    updateAuth(null);
    showToast('error', 'Tu sesión ha caducado. Vuelve a identificarte.', 'Sesión caducada');
  }, [showToast, updateAuth]);

  const getAuth = useCallback(() => authRef.current, []);
  const { syndicate, permissions, isSyncing, lastSyncTime, serverError, commit, updatePermissions, refresh } = useSyncedSyndicate({ getAuth, onAuthError });

  const isAdmin = auth?.role === 'admin';
  const canAddBets = isAdmin || permissions.sociosCanAddBets;
  const canDeleteDraw = (draw: DrawRecord) => isAdmin || (canAddBets && draw.createdBy === 'socio');
  const memberCount = Math.max(syndicate.members.length, 1);

  // Un socio necesita su propio token para las acciones que tiene permitidas.
  const ensureSocioAuth = useCallback(async (force = false): Promise<Auth | null> => {
    if (!force && authRef.current) return authRef.current;
    try {
      const socioAuth = await authenticateSocio();
      updateAuth(socioAuth);
      return socioAuth;
    } catch {
      showToast('error', 'No se pudo iniciar la sesión de socio.', 'Acceso');
      return null;
    }
  }, [showToast, updateAuth]);

  // ---------- Interfaces ----------
  const [activeTab, setActiveTab] = useState<Tab>('resumen');
  const [showAdminPinModal, setShowAdminPinModal] = useState(false);
  const [adminPinInput, setAdminPinInput] = useState('');
  const [adminPinError, setAdminPinError] = useState(false);
  const [newPinInput, setNewPinInput] = useState('');
  const [currentPinInput, setCurrentPinInput] = useState('');
  const [showPermissionsModal, setShowPermissionsModal] = useState(false);

  const [showNewDrawModal, setShowNewDrawModal] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [selectedMemberForHistory, setSelectedMemberForHistory] = useState<Member | null>(null);
  const [showDistributeModal, setShowDistributeModal] = useState(false);
  const [copiedNotification, setCopiedNotification] = useState(false);
  const [viewingTicketDraw, setViewingTicketDraw] = useState<DrawRecord | null>(null);
  const [editingWinningDraw, setEditingWinningDraw] = useState<DrawRecord | null>(null);
  const [editingCombinationKind, setEditingCombinationKind] = useState<'bet' | 'official'>('bet');
  const [editingBetLine, setEditingBetLine] = useState(1);
  const [betLinesDraft, setBetLinesDraft] = useState<BetLine[]>([]);
  const [isRefreshingResults, setIsRefreshingResults] = useState(false);
  const [newDrawAlert, setNewDrawAlert] = useState<DrawRecord | null>(null);
  const knownDrawIdsRef = useRef<Set<string> | null>(null);

  const [winningForm, setWinningForm] = useState({ ...emptyWinningForm });
  const [drawMonthFilter, setDrawMonthFilter] = useState('all');
  const [onlyPrizesFilter, setOnlyPrizesFilter] = useState(false);

  const [newDrawDate, setNewDrawDate] = useState(() => todayISO());
  const [newDrawNumBets, setNewDrawNumBets] = useState(5);
  const [newDrawLines, setNewDrawLines] = useState<{ line: number; numbers: (number | '')[] }[]>(() =>
    Array.from({ length: 5 }, (_, i) => ({
      line: i + 1,
      numbers: ['', '', '', '', '', ''],
    }))
  );
  const [newDrawReintegro, setNewDrawReintegro] = useState<number | ''>(0);
  const [newDrawJoker, setNewDrawJoker] = useState('');
  const [newDrawTicketImage, setNewDrawTicketImage] = useState<string | null>(null);
  const [isExtractingTicket, setIsExtractingTicket] = useState(false);
  const [extractionStatus, setExtractionStatus] = useState<{ type: 'success' | 'warning' | 'error'; message: string } | null>(null);
  const [previewingNewTicket, setPreviewingNewTicket] = useState(false);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  const [distributeType, setDistributeType] = useState<'premios' | 'caja' | 'custom'>('caja');
  const [customDistributeAmount, setCustomDistributeAmount] = useState(50);
  const [showCalculateBetModal, setShowCalculateBetModal] = useState(false);
  const [calcBetCount, setCalcBetCount] = useState(5);
  const [calcBetStrategy, setCalcBetStrategy] = useState<'hot' | 'cold' | 'balanced'>('hot');
  const [showReintegrosModal, setShowReintegrosModal] = useState(false);

  // ---------- Cuotas mensuales, extras y alta/baja de socios ----------
  const [selectedMonth, setSelectedMonth] = useState(() => todayISO().slice(0, 7));
  const [newMonthInput, setNewMonthInput] = useState(() => todayISO().slice(0, 7));
  const [showFeeModal, setShowFeeModal] = useState(false);
  const [feeInput, setFeeInput] = useState(5);
  const [showExtraModal, setShowExtraModal] = useState(false);
  const [extraForm, setExtraForm] = useState({
    memberOrConcept: '', amount: 3, date: todayISO(), notes: '',
  });
  const [showMemberModal, setShowMemberModal] = useState(false);
  const [newMemberForm, setNewMemberForm] = useState({ name: '', notes: '' });

  const [aiResponse, setAiResponse] = useState('');
  const [showFixedQueryModal, setShowFixedQueryModal] = useState(false);
  const [fixedQueryForm, setFixedQueryForm] = useState({ title: '', description: '', result: '' });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const [targetDrawIdForUpload, setTargetDrawIdForUpload] = useState<string | null>(null);

  const DEFAULT_SONG = {
    name: 'En cada bola ahí estamos (Canción oficial)',
    url: '/assets/aistudio/En_cada_bola_ahi_estamos_9f7e7b24.mpeg',
    isCustom: false,
  };

  const audioRef = useRef<HTMLAudioElement>(null);
  const musicPausedManuallyRef = useRef(true);
  const [isMusicPlaying, setIsMusicPlaying] = useState(false);
  const [currentTrack, setCurrentTrack] = useState<{ name: string; url: string; isCustom: boolean }>(DEFAULT_SONG);
  const [musicVolume, setMusicVolume] = useState(0.45);
  const [loopMusic, setLoopMusic] = useState(true);
  const customMusicInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = musicVolume;
    const isTopWindow = (() => {
      try {
        return window.self === window.top;
      } catch {
        return false;
      }
    })();

    const pauseForBackground = () => {
      if (!audio.paused) {
        audio.pause();
      }
    };

    const resumeIfActive = () => {
      if (musicPausedManuallyRef.current) return;
      if (document.visibilityState === 'visible' && !document.hidden) {
        if (!isTopWindow || document.hasFocus()) {
          void audio.play().catch(() => {});
        }
      }
    };

    const handleVisibilityOrForeground = () => {
      if (document.visibilityState === 'visible' && !document.hidden) {
        resumeIfActive();
      } else {
        pauseForBackground();
      }
    };

    const handleBlur = () => {
      if (isTopWindow) {
        pauseForBackground();
      }
    };

    const handleFocus = () => {
      resumeIfActive();
    };

    document.addEventListener('visibilitychange', handleVisibilityOrForeground);
    document.addEventListener('freeze', pauseForBackground);
    document.addEventListener('resume', handleFocus);
    window.addEventListener('pagehide', pauseForBackground);
    window.addEventListener('pageshow', handleFocus);
    window.addEventListener('blur', handleBlur);
    window.addEventListener('focus', handleFocus);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityOrForeground);
      document.removeEventListener('freeze', pauseForBackground);
      document.removeEventListener('resume', handleFocus);
      window.removeEventListener('pagehide', pauseForBackground);
      window.removeEventListener('pageshow', handleFocus);
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('focus', handleFocus);
      audio.pause();
    };
  }, [musicVolume]);

  const handleToggleMusic = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!audio.paused) {
      musicPausedManuallyRef.current = true;
      audio.pause();
      showToast('info', 'Música pausada.', 'Música');
    } else {
      musicPausedManuallyRef.current = false;
      audio.volume = musicVolume;
      void audio.play().then(() => {
        setIsMusicPlaying(true);
        showToast('success', `Sonando: ${currentTrack.name}`, 'Música en reproducción');
      }).catch(() => {
        showToast('error', 'No se pudo reproducir el audio en este navegador.', 'Audio');
      });
    }
  };

  const handleCustomMusicSelected = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    if (currentTrack.isCustom && currentTrack.url.startsWith('blob:')) {
      URL.revokeObjectURL(currentTrack.url);
    }

    const objectUrl = URL.createObjectURL(file);
    const cleanName = file.name.replace(/\.[^/.]+$/, '');
    const newTrack = {
      name: cleanName,
      url: objectUrl,
      isCustom: true,
    };
    setCurrentTrack(newTrack);

    if (audioRef.current) {
      audioRef.current.src = objectUrl;
      audioRef.current.load();
      musicPausedManuallyRef.current = false;
      audioRef.current.play().then(() => {
        setIsMusicPlaying(true);
        showToast('success', `Canción cargada: ${cleanName}`, 'Música de la peña');
      }).catch(() => {
        showToast('info', `Canción "${cleanName}" lista. Pulsa reproducir para escucharla.`, 'Canción cargada');
      });
    }
  };

  const handleRestoreDefaultMusic = () => {
    if (currentTrack.isCustom && currentTrack.url.startsWith('blob:')) {
      URL.revokeObjectURL(currentTrack.url);
    }
    setCurrentTrack(DEFAULT_SONG);
    if (audioRef.current) {
      audioRef.current.src = DEFAULT_SONG.url;
      audioRef.current.load();
      if (!musicPausedManuallyRef.current) {
        audioRef.current.play().catch(() => {});
      }
    }
    showToast('info', 'Restablecida la canción oficial: En cada bola ahí estamos.', 'Canción oficial');
  };

  const handleVolumeChange = (newVolume: number) => {
    const vol = Math.max(0, Math.min(1, newVolume));
    setMusicVolume(vol);
    if (audioRef.current) {
      audioRef.current.volume = vol;
    }
  };

  // ---------- Cálculos derivados ----------
  const totals = useMemo(() => computeTotals(syndicate), [syndicate]);
  const monthlyData = useMemo(() => computeMonthlyData(syndicate, totals), [syndicate, totals]);
  const availableMonths = useMemo(() => {
    const keys = new Set<string>();
    syndicate.draws.forEach((d) => keys.add(d.date.slice(0, 7)));
    syndicate.extraPrizes.forEach((p) => keys.add(p.date.slice(0, 7)));
    syndicate.extraContributions.forEach((e) => keys.add(e.date.slice(0, 7)));
    syndicate.monthlyPayments.forEach((p) => keys.add(p.date.slice(0, 7)));
    syndicate.distributions.forEach((d) => keys.add(d.date.slice(0, 7)));
    return [...keys].sort((a, b) => b.localeCompare(a));
  }, [syndicate]);

  // Mes visible en el tablero: el seleccionado si existe, si no el último controlado.
  const activeMonth = syndicate.months.includes(selectedMonth)
    ? selectedMonth
    : syndicate.months[syndicate.months.length - 1] ?? todayISO().slice(0, 7);
  const latestMonth = syndicate.months[syndicate.months.length - 1] ?? activeMonth;
  const paidThisMonth = useMemo(() => paidMembersInMonth(syndicate, activeMonth), [syndicate, activeMonth]);
  const paymentsThisMonth = useMemo(
    () => syndicate.monthlyPayments.filter((p) => p.month === activeMonth),
    [syndicate.monthlyPayments, activeMonth],
  );
  const freshMoneyThisMonth = roundMoney(
    paymentsThisMonth.filter((p) => !p.historical).reduce((acc, p) => acc + p.amount, 0),
  );
  const initialHistoricalPayments = useMemo(
    () => createInitialSyndicateData().monthlyPayments.filter((p) => p.historical),
    [],
  );

  const isPaidInMonth = (memberId: string, monthKey = activeMonth): boolean => {
    const paid = monthKey === activeMonth ? paidThisMonth : paidMembersInMonth(syndicate, monthKey);
    return paid.has(memberId);
  };

  /** Agrupa el histórico arrastrado y todas las cuotas y extras registrados con fecha e importe exactos. */
  const getMemberPayments = useCallback((member: Member) => {
    const list: { id: string; date: string; amount: number; concept: string; isHistorical?: boolean }[] = [];
    const seenIds = new Set<string>();

    // 1. Pagos históricos base del socio
    for (const p of member.paymentsHistory) {
      if (!seenIds.has(p.id)) {
        seenIds.add(p.id);
        list.push({
          id: p.id,
          date: p.date,
          amount: p.amount,
          concept: p.concept || 'Aportación inicial (histórico)',
          isHistorical: true,
        });
      }
    }

    // 2. Pagos de cuotas mensuales registrados en syndicate.monthlyPayments
    for (const mp of syndicate.monthlyPayments) {
      if (mp.memberId === member.id && !seenIds.has(mp.id)) {
        seenIds.add(mp.id);
        list.push({
          id: mp.id,
          date: mp.date,
          amount: mp.amount,
          concept: `Cuota mensual ${monthNameFromKey(mp.month)}`,
          isHistorical: !!mp.historical,
        });
      }
    }

    // 3. Aportaciones extraordinarias de este socio en syndicate.extraContributions
    const nameLower = member.name.trim().toLowerCase();
    for (const ec of syndicate.extraContributions) {
      if (
        (ec.memberOrConcept.trim().toLowerCase() === nameLower || ec.memberOrConcept === member.id) &&
        !seenIds.has(ec.id)
      ) {
        seenIds.add(ec.id);
        list.push({
          id: ec.id,
          date: ec.date,
          amount: ec.amount,
          concept: ec.notes ? `Extra: ${ec.notes}` : 'Aportación extraordinaria',
          isHistorical: false,
        });
      }
    }

    return list.sort((a, b) => b.date.localeCompare(a.date));
  }, [syndicate.monthlyPayments, syndicate.extraContributions]);

  const filteredDraws = useMemo(
    () => syndicate.draws
      .filter((d) => {
        if (onlyPrizesFilter && d.prizeWon <= 0) return false;
        if (drawMonthFilter !== 'all' && !d.date.startsWith(drawMonthFilter)) return false;
        return true;
      })
      .sort((a, b) => b.date.localeCompare(a.date) || b.index - a.index),
    [syndicate.draws, drawMonthFilter, onlyPrizesFilter],
  );

  const upcomingDraws = useMemo(() => {
    return syndicate.draws
      .filter((draw) => !draw.officialCombination || draw.status === 'pendiente')
      .sort((a, b) => a.date.localeCompare(b.date) || a.index - b.index);
  }, [syndicate.draws]);

  const prizeDraws = useMemo(
    () => syndicate.draws.filter((draw) => draw.prizeWon > 0).sort((a, b) => b.date.localeCompare(a.date) || b.index - a.index),
    [syndicate.draws],
  );

  const officialDraws = useMemo(
    () => syndicate.draws.filter((draw) => draw.officialCombination).sort((a, b) => b.date.localeCompare(a.date) || b.index - a.index),
    [syndicate.draws],
  );

  /** Aviso en pantalla para todos los jugadores cuando aparece un boleto nuevo. */
  useEffect(() => {
    const ids = new Set(syndicate.draws.map((draw) => draw.id));
    if (knownDrawIdsRef.current === null) {
      knownDrawIdsRef.current = ids;
      return;
    }
    const fresh = syndicate.draws.filter((draw) => !knownDrawIdsRef.current!.has(draw.id));
    knownDrawIdsRef.current = ids;
    if (fresh.length === 0) return;
    const latest = [...fresh].sort((a, b) => b.index - a.index)[0];
    setNewDrawAlert(latest);
    showToast(
      'info',
      `Nuevo boleto de la peña: sorteo #${latest.index} (${latest.displayDate}) por ${money(latest.betCost)}.`,
      'Aviso para los jugadores',
    );
  }, [syndicate.draws, showToast]);

  const perMember = useCallback((amount: number) => roundMoney(amount / memberCount), [memberCount]);
  const firstJoinedDate = useMemo(
    () => syndicate.members.reduce((min, m) => (m.joinedDate < min ? m.joinedDate : min), syndicate.members[0]?.joinedDate || todayISO()),
    [syndicate.members],
  );

  // ---------- Acciones ----------
  const handleResetToRealData = async () => {
    if (!isAdmin || !confirm('¿Restablecer todos los datos a la configuración inicial de la peña?')) return;
    const ok = await commit(() => createInitialSyndicateData());
    if (ok) showToast('success', 'Datos restablecidos con éxito.', 'Datos Restaurados');
    else showToast('error', 'No se pudieron restablecer los datos en el servidor.');
  };

  const handleToggleSociosAddBets = async (value: boolean) => {
    if (!isAdmin) return;
    const ok = await updatePermissions({ sociosCanAddBets: value });
    showToast(
      ok ? 'success' : 'error',
      ok
        ? value
          ? 'Los socios ya pueden registrar apuestas y subir boletos.'
          : 'Solo el administrador puede registrar apuestas.'
        : 'No se pudo actualizar el permiso en el servidor.',
      'Permisos Actualizados',
    );
  };

  const handleChangeAdminPin = async (event: FormEvent) => {
    event.preventDefault();
    if (!isAdmin || !auth) return;
    const newPin = newPinInput.trim();
    if (newPin.length < 4) {
      showToast('error', 'El nuevo PIN debe tener al menos 4 caracteres.', 'Error en PIN');
      return;
    }
    if (!currentPinInput.trim()) {
      showToast('error', 'Introduce el PIN actual para poder cambiarlo.', 'Error en PIN');
      return;
    }
    try {
      const nextAuth = await changeAdminPin(currentPinInput.trim(), newPin, auth);
      updateAuth(nextAuth || auth);
      setNewPinInput('');
      setCurrentPinInput('');
      showToast('success', 'PIN de administrador actualizado. Las sesiones anteriores han quedado cerradas.', 'Seguridad Actualizada');
    } catch (error: any) {
      showToast('error', error.message || 'No se pudo cambiar el PIN.', 'Error en PIN');
    }
  };

  const generateRandomBetNumbers = (): number[] => {
    const nums = new Set<number>();
    while (nums.size < 6) {
      nums.add(Math.floor(Math.random() * 49) + 1);
    }
    return [...nums].sort((a, b) => a - b);
  };

  const handleFillLineRandom = (lineIdx: number) => {
    const randoms = generateRandomBetNumbers();
    setNewDrawLines((prev) => {
      const next = [...prev];
      next[lineIdx] = { ...next[lineIdx], numbers: randoms };
      return next;
    });
  };

  const handleFillAllRandom = () => {
    setNewDrawLines((prev) =>
      prev.map((l) => ({ ...l, numbers: generateRandomBetNumbers() }))
    );
  };

  const handleClearLine = (lineIdx: number) => {
    setNewDrawLines((prev) => {
      const next = [...prev];
      next[lineIdx] = { ...next[lineIdx], numbers: ['', '', '', '', '', ''] };
      return next;
    });
  };

  const handleSetNumBets = (count: number) => {
    const target = Math.max(1, Math.min(8, count));
    setNewDrawNumBets(target);
    setNewDrawLines((prev) => {
      if (prev.length === target) return prev;
      if (prev.length < target) {
        const added = Array.from({ length: target - prev.length }, (_, i) => ({
          line: prev.length + i + 1,
          numbers: ['', '', '', '', '', ''] as (number | '')[],
        }));
        return [...prev, ...added];
      }
      return prev.slice(0, target);
    });
  };

  const handleLineNumberChange = (lineIdx: number, numIdx: number, val: string) => {
    const digits = val.replace(/\D/g, '');
    const nextLines = [...newDrawLines];
    const targetLine = { ...nextLines[lineIdx], numbers: [...nextLines[lineIdx].numbers] };

    if (digits === '') {
      targetLine.numbers[numIdx] = '';
      nextLines[lineIdx] = targetLine;
      setNewDrawLines(nextLines);
      return;
    }

    const num = parseInt(digits, 10);
    targetLine.numbers[numIdx] = num > 49 ? Math.min(49, num) : num;
    nextLines[lineIdx] = targetLine;
    setNewDrawLines(nextLines);

    if ((digits.length >= 2 || num >= 5) && numIdx < 5) {
      const nextInput = document.getElementById(`draw-line-${lineIdx}-num-${numIdx + 1}`);
      nextInput?.focus();
    }
  };

  const handleLineNumberKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, lineIdx: number, numIdx: number) => {
    if (e.key === 'Backspace' && newDrawLines[lineIdx]?.numbers[numIdx] === '' && numIdx > 0) {
      document.getElementById(`draw-line-${lineIdx}-num-${numIdx - 1}`)?.focus();
    } else if (e.key === 'ArrowRight' && numIdx < 5) {
      document.getElementById(`draw-line-${lineIdx}-num-${numIdx + 1}`)?.focus();
    } else if (e.key === 'ArrowLeft' && numIdx > 0) {
      document.getElementById(`draw-line-${lineIdx}-num-${numIdx - 1}`)?.focus();
    }
  };

  const processTicketWithAi = async (dataUrl: string) => {
    setIsExtractingTicket(true);
    setExtractionStatus({ type: 'warning', message: 'Leyendo boleto y extrayendo apuestas con IA...' });
    try {
      const response = await apiFetch(
        '/api/gemini/extract-ticket',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageBase64: dataUrl }),
        },
        authRef.current,
      );
      const result = await response.json();
      if (!result.success || !result.data) {
        setExtractionStatus({
          type: 'warning',
          message: result.error || 'Foto guardada. No se pudieron extraer las apuestas automáticamente. Puedes introducirlas manualmente abajo.',
        });
        return;
      }
      const extracted = sanitizeTicketExtraction(result.data);
      if (extracted.date) setNewDrawDate(extracted.date);
      if (extracted.reintegro !== undefined) setNewDrawReintegro(extracted.reintegro);
      if (extracted.jokerPlayed === true && extracted.joker) {
        setNewDrawJoker(extracted.joker);
      } else {
        setNewDrawJoker('');
      }

      if (extracted.lines && extracted.lines.length > 0) {
        const count = extracted.lines.length;
        setNewDrawNumBets(count);
        setNewDrawLines(extracted.lines.map((l, i) => ({
          line: i + 1,
          numbers: [...l.numbers],
        })));
        setExtractionStatus({
          type: 'success',
          message: `¡Lectura IA completada: ${count} apuesta${count > 1 ? 's' : ''}${extracted.reintegro !== undefined ? ` y reintegro ${extracted.reintegro}` : ''} identificados! Puedes revisar o corregir cualquier número abajo.`,
        });
        showToast('success', `Detectadas ${count} apuestas en el boleto.`, 'Boleto Leído con IA');
      } else if (extracted.winningCombination) {
        setNewDrawNumBets(1);
        setNewDrawLines([{ line: 1, numbers: [...extracted.winningCombination.numbers] }]);
        setExtractionStatus({
          type: 'warning',
          message: 'Se identificó 1 apuesta en el boleto. Comprueba los números o añade más líneas abajo.',
        });
      } else {
        setExtractionStatus({
          type: 'warning',
          message: 'Foto adjuntada. No se pudieron reconocer los números con suficiente nitidez. Rellena los números manualmente en las casillas.',
        });
      }
    } catch (err: any) {
      setExtractionStatus({
        type: 'warning',
        message: 'No se pudo conectar con el servicio de IA. La foto queda guardada y puedes introducir las apuestas a mano.',
      });
    } finally {
      setIsExtractingTicket(false);
    }
  };

  const handleTicketPhotoChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/') || file.size > MAX_TICKET_BYTES) {
      showToast('error', 'Selecciona una imagen de menos de 16 MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = async (loadEvt) => {
      const dataUrl = loadEvt.target?.result as string | undefined;
      if (!dataUrl) return;
      setNewDrawTicketImage(dataUrl);
      setExtractionStatus(null);
      await processTicketWithAi(dataUrl);
    };
    reader.readAsDataURL(file);
  };

  const openNewDrawModal = (presetLines?: BetLine[] | unknown) => {
    const lines = Array.isArray(presetLines) ? (presetLines as BetLine[]) : undefined;
    const date = todayISO();
    setNewDrawDate(date);
    const count = lines?.length ? lines.length : Math.min(8, Math.max(1, syndicate.costPerDraw || 5));
    setNewDrawNumBets(count);
    if (lines?.length) {
      setNewDrawLines(lines.map((l, i) => ({
        line: i + 1,
        numbers: [...l.numbers],
      })));
      if (lines[0]?.reintegro !== undefined) {
        setNewDrawReintegro(lines[0].reintegro);
      }
    } else {
      setNewDrawLines(
        Array.from({ length: count }, (_, i) => ({
          line: i + 1,
          numbers: ['', '', '', '', '', ''] as (number | '')[],
        }))
      );
      setNewDrawReintegro(0);
    }
    setNewDrawJoker('');
    setNewDrawTicketImage(null);
    setIsExtractingTicket(false);
    setExtractionStatus(null);
    setShowNewDrawModal(true);
  };

  const handleCreateDraw = async (event: FormEvent) => {
    event.preventDefault();
    if (!canAddBets) {
      showToast('error', 'El administrador no ha habilitado el permiso para añadir apuestas.');
      return;
    }
    if (!isAdmin && !(await ensureSocioAuth())) return;

    const parsedLines: BetLine[] = [];
    for (const item of newDrawLines) {
      const validNums = item.numbers
        .map(Number)
        .filter((n) => Number.isInteger(n) && n >= 1 && n <= 49);
      const uniqueNums = [...new Set(validNums)].sort((a, b) => a - b);
      if (uniqueNums.length !== 6) {
        showToast(
          'error',
          `La apuesta #${item.line} debe tener exactamente 6 números distintos entre 1 y 49.`,
          'Apuesta incompleta',
        );
        return;
      }
      parsedLines.push({
        line: item.line,
        numbers: uniqueNums,
        reintegro: newDrawReintegro !== '' ? Number(newDrawReintegro) : undefined,
      });
    }

    if (parsedLines.length === 0) {
      showToast('error', 'Debe haber al menos una apuesta.', 'Sin apuestas');
      return;
    }

    const reintegroVal = newDrawReintegro !== '' ? Number(newDrawReintegro) : 0;
    const betCost = parsedLines.length;

    const cleanJoker = newDrawJoker.trim();
    const hasValidJoker = /^\d{7}$/.test(cleanJoker);

    const record: DrawRecord = {
      id: `d_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      index: nextDrawIndex(syndicate.draws),
      date: newDrawDate,
      displayDate: formatDateShort(newDrawDate),
      dayOfWeek: weekdayFromDate(newDrawDate),
      betCost: roundMoney(betCost),
      prizeWon: 0,
      lines: parsedLines,
      winningCombination: {
        numbers: parsedLines[0].numbers,
        complementario: 0,
        reintegro: reintegroVal,
        joker: hasValidJoker ? cleanJoker : undefined,
      },
      jokerPlayed: hasValidJoker,
      createdBy: isAdmin ? 'admin' : 'socio',
      ticketImage: newDrawTicketImage || undefined,
      status: 'pendiente',
    };

    const ok = await commit((prev) => ({ ...prev, draws: [...prev.draws, record] }), 'draws');
    if (!ok) {
      showToast('error', 'No se pudo guardar el boleto en el servidor.');
      return;
    }
    setShowNewDrawModal(false);
    showToast(
      'success',
      `Boleto #${record.index} guardado con ${parsedLines.length} apuestas (${money(betCost)}).`,
      'Boleto Registrado',
    );
  };

  const handleDeleteDraw = async (draw: DrawRecord) => {
    if (!canDeleteDraw(draw)) {
      showToast('error', 'Sólo puedes eliminar las apuestas que has registrado tú.');
      return;
    }
    const message = `¿Eliminar la apuesta del sorteo #${draw.index} (${draw.displayDate})?\n\nSe descontarán ${money(draw.betCost)} del total jugado. Esta acción no se puede deshacer.`;
    if (!confirm(message)) return;
    const ok = await commit(
      (prev) => ({ ...prev, draws: prev.draws.filter((item) => item.id !== draw.id) }),
      'draws',
    );
    showToast(
      ok ? 'info' : 'error',
      ok ? `Apuesta del ${draw.displayDate} eliminada del registro.` : 'No se pudo eliminar la apuesta.',
      'Apuesta Eliminada',
    );
  };

  /** Marca o desmarca la cuota de un socio en el mes visible del tablero. */
  const handleToggleMonthlyPayment = async (memberId: string) => {
    if (!isAdmin) {
      showToast('error', 'Solo el administrador puede marcar cuotas pagadas.');
      return;
    }
    const existing = syndicate.monthlyPayments.find((p) => p.month === activeMonth && p.memberId === memberId);
    const willPay = !existing;
    const wasHistorical = initialHistoricalPayments.some((p) => p.month === activeMonth && p.memberId === memberId);
    const memberName = syndicate.members.find((m) => m.id === memberId)?.name ?? 'el socio';
    const record: MonthlyPaymentRecord = {
      id: `mp_${activeMonth}_${memberId}_${Date.now()}`,
      month: activeMonth,
      memberId,
      amount: syndicate.monthlyFee,
      date: todayISO(),
      ...(wasHistorical ? { historical: true } : {}),
    };

    const ok = await commit((prev) => {
      const monthlyPayments = willPay
        ? [...prev.monthlyPayments, record]
        : prev.monthlyPayments.filter((p) => !(p.month === activeMonth && p.memberId === memberId));
      const paid = new Set(monthlyPayments.filter((p) => p.month === activeMonth).map((p) => p.memberId));
      return {
        ...prev,
        monthlyPayments,
        // El estado "al día" sigue al mes más reciente controlado.
        members: activeMonth === latestMonth
          ? prev.members.map((member) => member.id === memberId ? { ...member, isUpToDate: paid.has(member.id) } : member)
          : prev.members,
      };
    });
    if (!ok) {
      showToast('error', 'No se pudo actualizar la cuota en el servidor.');
      return;
    }
    showToast(
      'success',
      willPay
        ? `${memberName} marcado como pagado en ${monthNameFromKey(activeMonth)} (${money(syndicate.monthlyFee)}).`
        : `${memberName} marcado como pendiente en ${monthNameFromKey(activeMonth)}.`,
      'Cuota Actualizada',
    );
  };

  const handleAddMonth = async (event: FormEvent) => {
    event.preventDefault();
    if (!isAdmin) return;
    const key = newMonthInput.trim();
    if (!/^\d{4}-\d{2}$/.test(key)) {
      showToast('error', 'Selecciona un mes válido (AAAA-MM).', 'Error en mes');
      return;
    }
    if (syndicate.months.includes(key)) {
      showToast('info', 'Ese mes ya está en el tablero.', 'Mes existente');
      return;
    }
    const months = [...syndicate.months, key].sort((a, b) => a.localeCompare(b));
    const isNewLatest = key > latestMonth;
    const ok = await commit((prev) => ({
      ...prev,
      months,
      members: isNewLatest ? prev.members.map((member) => ({ ...member, isUpToDate: false })) : prev.members,
    }));
    if (!ok) {
      showToast('error', 'No se pudo añadir el mes.');
      return;
    }
    setSelectedMonth(key);
    setNewMonthInput(todayISO().slice(0, 7));
    showToast('success', `${monthNameFromKey(key)} añadido al tablero de cuotas.`, 'Mes Añadido');
  };

  const handleUpdateFee = async (event: FormEvent) => {
    event.preventDefault();
    if (!isAdmin) return;
    const fee = roundMoney(Number(feeInput));
    if (!Number.isFinite(fee) || fee <= 0) {
      showToast('error', 'La cuota mensual debe ser superior a 0 €.', 'Error en cuota');
      return;
    }
    const ok = await commit((prev) => ({ ...prev, monthlyFee: fee }));
    if (!ok) {
      showToast('error', 'No se pudo actualizar la cuota mensual.');
      return;
    }
    setShowFeeModal(false);
    showToast('success', `Cuota mensual actualizada a ${money(fee)} por socio.`, 'Cuota Configurada');
  };

  const handleAddExtra = async (event: FormEvent) => {
    event.preventDefault();
    if (!isAdmin) return;
    const concept = extraForm.memberOrConcept.trim();
    const amount = roundMoney(Number(extraForm.amount));
    if (!concept) {
      showToast('error', 'Indica el socio o el concepto de la aportación.', 'Error en extra');
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      showToast('error', 'La aportación debe ser superior a 0 €.', 'Error en extra');
      return;
    }
    const record: ExtraContribution = {
      id: `ec_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      memberOrConcept: concept,
      amount,
      date: extraForm.date || todayISO(),
      notes: extraForm.notes.trim(),
    };
    const ok = await commit((prev) => ({ ...prev, extraContributions: [...prev.extraContributions, record] }));
    if (!ok) {
      showToast('error', 'No se pudo guardar la aportación extra.');
      return;
    }
    setShowExtraModal(false);
    setExtraForm({ memberOrConcept: '', amount: 3, date: todayISO(), notes: '' });
    showToast('success', `Aportación extra de ${money(amount)} registrada para ${concept}.`, 'Extra Añadido');
  };

  const handleDeleteExtra = async (extra: ExtraContribution) => {
    if (!isAdmin || !confirm(`¿Eliminar la aportación extra de ${extra.memberOrConcept} por ${money(extra.amount)}?`)) return;
    const ok = await commit((prev) => ({ ...prev, extraContributions: prev.extraContributions.filter((e) => e.id !== extra.id) }));
    showToast(ok ? 'info' : 'error', ok ? 'Aportación extra eliminada. La caja se ha recalculado.' : 'No se pudo eliminar la aportación.', 'Extra Eliminado');
  };

  const handleAddMember = async (event: FormEvent) => {
    event.preventDefault();
    if (!isAdmin) return;
    const name = newMemberForm.name.trim();
    if (!name) {
      showToast('error', 'Escribe el nombre del nuevo socio.', 'Error al añadir socio');
      return;
    }
    if (syndicate.members.some((m) => m.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
      showToast('error', 'Ya existe un socio con ese nombre.', 'Socio duplicado');
      return;
    }
    const record: Member = {
      id: `m_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name,
      totalPaid: 0,
      joinedDate: todayISO(),
      isUpToDate: false,
      balance: 0,
      notes: newMemberForm.notes.trim() || undefined,
      paymentsHistory: [],
    };
    const ok = await commit((prev) => ({ ...prev, members: [...prev.members, record] }));
    if (!ok) {
      showToast('error', 'No se pudo añadir el socio.');
      return;
    }
    setShowMemberModal(false);
    setNewMemberForm({ name: '', notes: '' });
    showToast('success', `${name} añadido a la peña. Su cuota queda pendiente en ${monthNameFromKey(latestMonth)}.`, 'Socio Añadido');
  };

  const handleDeleteMember = async (member: Member) => {
    if (!isAdmin) return;
    const carried = roundMoney(
      member.totalPaid
      + syndicate.monthlyPayments
        .filter((p) => p.memberId === member.id && !p.historical)
        .reduce((acc, p) => acc + p.amount, 0),
    );
    const warning = carried > 0
      ? ` Su importe histórico (${money(carried)}) se conservará en Extras para no alterar la caja.`
      : '';
    if (!confirm(`¿Dar de baja a ${member.name} de la peña?${warning}`)) return;

    const ok = await commit((prev) => ({
      ...prev,
      members: prev.members.filter((m) => m.id !== member.id),
      monthlyPayments: prev.monthlyPayments.filter((p) => p.memberId !== member.id),
      extraContributions: carried > 0
        ? [...prev.extraContributions, {
            id: `ec_baja_${member.id}_${Date.now()}`,
            memberOrConcept: member.name,
            amount: carried,
            date: todayISO(),
            notes: `Importe histórico conservado al dar de baja a ${member.name}`,
          }]
        : prev.extraContributions,
    }));
    showToast(ok ? 'info' : 'error', ok ? `${member.name} dado de baja.` : 'No se pudo dar de baja al socio.', 'Socio Eliminado');
  };

  const handleExecuteDistribution = async (event: FormEvent) => {
    event.preventDefault();
    if (!isAdmin) return;
    const rawAmount = distributeType === 'premios'
      ? totals.totalPremios
      : distributeType === 'caja'
        ? totals.totalCaja
        : Number(customDistributeAmount);

    if (!Number.isFinite(rawAmount) || rawAmount <= 0 || rawAmount > totals.totalCaja) {
      showToast('error', `La cantidad a repartir debe estar entre 0,01 € y ${money(totals.totalCaja)}.`, 'Error en reparto');
      return;
    }
    const amount = roundMoney(rawAmount);
    const share = perMember(amount);
    if (share <= 0) {
      showToast('error', 'El importe por socio debe ser superior a 0 €.');
      return;
    }

    const ok = await commit((prev) => ({
      ...prev,
      members: prev.members.map((member) => ({ ...member, balance: roundMoney(member.balance + share) })),
      distributions: [
        ...prev.distributions,
        { id: `dist_${Date.now()}`, date: todayISO(), type: distributeType, amount, perMember: share },
      ],
    }));
    if (!ok) {
      showToast('error', 'No se pudo ejecutar el reparto.');
      return;
    }
    setShowDistributeModal(false);
    showToast('success', `Reparto completado: ${money(share)} por socio (total ${money(amount)}). La caja ya refleja el pago.`, 'Reparto Exitoso');
  };

  const handleUploadTicketPhoto = async (drawId: string) => {
    if (!canAddBets) {
      showToast('error', 'Solo usuarios autorizados pueden subir fotos de boletos.');
      return;
    }
    if (!isAdmin && !(await ensureSocioAuth())) return;
    setTargetDrawIdForUpload(drawId);
    fileInputRef.current?.click();
  };

  const handleAiExtractAndAutoFill = async (drawId: string, dataUrl: string) => {
    showToast('info', 'Leyendo boleto y recuperando los números jugados por la peña...', 'IA Procesando');
    try {
      const response = await apiFetch(
        '/api/gemini/extract-ticket',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageBase64: dataUrl }),
        },
        authRef.current,
      );
      const result = await response.json();
      if (!result.success || !result.data) {
        showToast('error', result.error || 'No se pudo extraer información del boleto.');
        return;
      }
      const extracted = sanitizeTicketExtraction(result.data);
      const ok = await commit((prev) => ({
        ...prev,
        draws: prev.draws.map((draw) => draw.id !== drawId ? draw : {
          ...draw,
          ticketImage: dataUrl,
          date: extracted.date ?? draw.date,
          displayDate: extracted.date ? formatDateShort(extracted.date) : draw.displayDate,
          dayOfWeek: extracted.dayOfWeek ?? draw.dayOfWeek,
          betCost: extracted.lines ? betLinesCost(extracted.lines) : (extracted.betCost ?? draw.betCost),
          lines: extracted.lines ?? draw.lines,
          jokerPlayed: extracted.jokerPlayed === true,
          notes: extracted.notes ?? draw.notes,
          winningCombination: extracted.winningCombination ?? draw.winningCombination,
        }),
      }), 'draws');
      showToast(
        ok ? 'success' : 'error',
        ok
          ? extracted.winningCombination
            ? 'Boleto leído y nuestra apuesta actualizada.'
            : 'Boleto guardado. La IA no pudo leer los números jugados; comprueba la apuesta manualmente.'
          : 'No se pudo guardar la información extraída.',
        ok ? 'IA' : 'Error',
      );
    } catch (error: any) {
      showToast('error', error.message || 'Error al conectar con la IA para leer el boleto.');
    }
  };

  const handleFileInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    const drawId = targetDrawIdForUpload;
    event.target.value = ''; // permite volver a seleccionar el mismo archivo
    if (!file || !drawId) return;
    if (!file.type.startsWith('image/') || file.size > MAX_TICKET_BYTES) {
      showToast('error', 'Selecciona una imagen de menos de 16 MB.');
      return;
    }

    const reader = new FileReader();
    reader.onload = async (loadEvent) => {
      const dataUrl = loadEvent.target?.result as string | undefined;
      if (!dataUrl) return;
      const ok = await commit((prev) => ({
        ...prev,
        draws: prev.draws.map((draw) => (draw.id === drawId ? { ...draw, ticketImage: dataUrl } : draw)),
      }), 'draws');
      if (!ok) {
        showToast('error', 'No se pudo guardar la foto del boleto.');
        return;
      }
      showToast('success', 'Foto del boleto guardada. Iniciando lectura automática...', 'Boleto Adjuntado');
      await handleAiExtractAndAutoFill(drawId, dataUrl);
    };
    reader.readAsDataURL(file);
  };

  const handleDeleteTicketPhoto = async (drawId: string) => {
    if (!isAdmin || !confirm('¿Eliminar la foto del boleto de este sorteo?')) return;
    const ok = await commit((prev) => ({
      ...prev,
      draws: prev.draws.map((draw) => (draw.id === drawId ? { ...draw, ticketImage: undefined } : draw)),
    }));
    if (ok) {
      setViewingTicketDraw(null);
      showToast('info', 'Foto del boleto eliminada.', 'Boleto Eliminado');
    }
  };

  const formToCombination = (): WinningCombination => ({
    numbers: [winningForm.n1, winningForm.n2, winningForm.n3, winningForm.n4, winningForm.n5, winningForm.n6].sort((a, b) => a - b),
    complementario: Number(winningForm.complementario),
    reintegro: Number(winningForm.reintegro),
    joker: winningForm.joker.trim() || undefined,
  });

  const handleOpenWinningModal = (draw: DrawRecord, kind: 'bet' | 'official' = 'bet', line = 1) => {
    setEditingWinningDraw(draw);
    setEditingCombinationKind(kind);
    if (kind === 'bet') {
      const lines = drawBetLines(draw);
      const draft = lines.length ? lines : [{ line: 1, numbers: [1, 2, 3, 4, 5, 6] }];
      setBetLinesDraft(draft);
      const index = Math.min(Math.max(1, line), draft.length);
      setEditingBetLine(index);
      const bet = draft[index - 1];
      const numbers = bet?.numbers ?? [];
      setWinningForm({
        n1: numbers[0] ?? 1, n2: numbers[1] ?? 2, n3: numbers[2] ?? 3,
        n4: numbers[3] ?? 4, n5: numbers[4] ?? 5, n6: numbers[5] ?? 6,
        complementario: 7, reintegro: bet?.reintegro ?? 0, joker: '',
      });
      return;
    }
    const combination = draw.officialCombination;
    setWinningForm(combination ? {
      n1: combination.numbers[0] ?? 1, n2: combination.numbers[1] ?? 2, n3: combination.numbers[2] ?? 3,
      n4: combination.numbers[3] ?? 4, n5: combination.numbers[4] ?? 5, n6: combination.numbers[5] ?? 6,
      complementario: combination.complementario, reintegro: combination.reintegro, joker: combination.joker || '',
    } : { ...emptyWinningForm });
  };

  /** Guarda la línea que se está editando en el borrador antes de cambiar de línea. */
  const stashCurrentBetLine = (): BetLine[] => {
    const numbers = formToCombination().numbers;
    const current: BetLine = {
      line: editingBetLine,
      numbers,
      reintegro: formToCombination().reintegro,
    };
    const exists = betLinesDraft.some((item) => item.line === editingBetLine);
    return exists
      ? betLinesDraft.map((item) => (item.line === editingBetLine ? current : item))
      : [...betLinesDraft, current].sort((a, b) => a.line - b.line);
  };

  const handleSwitchBetLine = (line: number) => {
    const draft = stashCurrentBetLine();
    setBetLinesDraft(draft);
    setEditingBetLine(line);
    const bet = draft.find((item) => item.line === line);
    const numbers = bet?.numbers ?? [];
    setWinningForm({
      n1: numbers[0] ?? 1, n2: numbers[1] ?? 2, n3: numbers[2] ?? 3,
      n4: numbers[3] ?? 4, n5: numbers[4] ?? 5, n6: numbers[5] ?? 6,
      complementario: 7, reintegro: bet?.reintegro ?? 0, joker: '',
    });
  };

  const handleAddBetLine = () => {
    if (betLinesDraft.length >= 5) {
      showToast('error', 'Un boleto puede tener como máximo 5 apuestas.');
      return;
    }
    const draft = stashCurrentBetLine();
    const next = Math.max(...draft.map((item) => item.line), 0) + 1;
    setBetLinesDraft([...draft, { line: next, numbers: [1, 2, 3, 4, 5, 6] }]);
    setEditingBetLine(next);
    setWinningForm({ n1: 1, n2: 2, n3: 3, n4: 4, n5: 5, n6: 6, complementario: 7, reintegro: 0, joker: '' });
  };

  const handleRemoveBetLine = () => {
    if (betLinesDraft.length <= 1) {
      showToast('error', 'El boleto debe tener al menos una apuesta.');
      return;
    }
    const draft = betLinesDraft.filter((item) => item.line !== editingBetLine).map((item, index) => ({ ...item, line: index + 1 }));
    setBetLinesDraft(draft);
    setEditingBetLine(1);
    const numbers = draft[0]?.numbers ?? [];
    setWinningForm({
      n1: numbers[0] ?? 1, n2: numbers[1] ?? 2, n3: numbers[2] ?? 3,
      n4: numbers[3] ?? 4, n5: numbers[4] ?? 5, n6: numbers[5] ?? 6,
      complementario: 7, reintegro: draft[0]?.reintegro ?? 0, joker: '',
    });
  };

  const handleSaveWinningNumbers = async (event: FormEvent) => {
    event.preventDefault();
    if (!isAdmin || !editingWinningDraw) {
      showToast('error', 'Solo el administrador puede guardar combinaciones ganadoras.');
      return;
    }

    if (editingCombinationKind === 'bet') {
      const numbers = formToCombination().numbers;
      if (numbers.length !== 6 || new Set(numbers).size !== 6 || numbers.some((n) => n < 1 || n > 49)) {
        showToast('error', 'Revisa la apuesta: 6 valores distintos del 1 al 49.', 'Apuesta no válida');
        return;
      }
      const lines = stashCurrentBetLine()
        .map((bet) => ({ ...bet, numbers: bet.numbers.sort((a, b) => a - b) }))
        .map((bet, index) => ({ ...bet, line: index + 1 }));
      const ok = await commit((prev) => ({
        ...prev,
        draws: prev.draws.map((draw) => (draw.id === editingWinningDraw.id
          ? { ...draw, lines, betCost: betLinesCost(lines), winningCombination: undefined }
          : draw)),
      }));
      if (!ok) {
        showToast('error', 'No se pudo guardar la apuesta.');
        return;
      }
      setEditingWinningDraw(null);
      showToast('success', `${lines.length} apuestas guardadas para el sorteo #${editingWinningDraw.index}.`, 'Apuestas Guardadas');
      return;
    }

    const combination = formToCombination();
    if (!isValidWinningCombination(combination)) {
      showToast('error', 'Revisa los números: 6 valores distintos del 1 al 49, complementario distinto y reintegro del 0 al 9.', 'Combinación no válida');
      return;
    }
    const ok = await commit((prev) => ({
      ...prev,
      draws: prev.draws.map((draw) => (draw.id === editingWinningDraw.id
        ? {
          ...draw,
          status: 'jugado' as const,
          officialCombination: draw.jokerPlayed ? combination : { ...combination, joker: undefined },
        }
        : draw)),
    }));
    if (!ok) {
      showToast('error', 'No se pudo guardar la combinación.');
      return;
    }
    setEditingWinningDraw(null);
    showToast('success', `Combinación oficial actualizada para el sorteo #${editingWinningDraw.index}.`, 'Combinación Guardada');
  };

  const handleRefreshResults = async () => {
    if (!isAdmin) {
      showToast('error', 'Sólo el administrador puede actualizar los resultados.');
      return;
    }
    setIsRefreshingResults(true);
    try {
      const response = await apiFetch('/api/results/refresh', { method: 'POST' }, authRef.current);
      const data = await response.json();
      await refresh();
      showToast(
        'success',
        data.updated
          ? `Se añadieron ${data.updated} combinaciones oficiales nuevas.`
          : 'Todas las combinaciones oficiales ya estaban al día.',
        'Resultados Actualizados',
      );
    } catch (error: any) {
      showToast('error', error.message || 'No se pudieron recuperar los resultados.', 'Error');
    } finally {
      setIsRefreshingResults(false);
    }
  };

  const copyToClipboard = async (text: string, title: string, successMessage: string): Promise<boolean> => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        const copied = document.execCommand('copy');
        document.body.removeChild(textarea);
        if (!copied) throw new Error('Portapapeles no disponible');
      }
      showToast('success', successMessage, title);
      return true;
    } catch {
      showToast('error', 'No se pudo copiar al portapapeles. Revisa los permisos del navegador.', 'Portapapeles');
      return false;
    }
  };

  const buildWhatsAppMessage = () =>
    `📢 *RESUMEN DE NUESTRA PEÑA (${syndicate.name})* 🎰\n` +
    `📅 *Fecha:* ${new Date().toLocaleDateString('es-ES')}\n\n` +
    `👥 *Socios:* ${syndicate.members.length} (${paidThisMonth.size} con la cuota de ${monthNameFromKey(activeMonth)} pagada, de ${money(syndicate.monthlyFee)} por socio)\n` +
    `💰 *Total histórico + extras:* ${money(totals.totalPagado)} (extras: ${money(totals.totalExtras)})\n` +
    `🎟️ *Total jugado:* ${money(totals.totalJugado)} (${syndicate.draws.reduce((acc, draw) => acc + drawBetLines(draw).length, 0)} apuestas de 1 €)\n` +
    `🏆 *Premios ganados:* ${money(totals.totalPremios)}\n` +
    `💸 *Ya repartido:* ${money(totals.totalDistribuido)}\n` +
    `🏦 *CAJA ACTUAL DISPONIBLE:* *${money(totals.totalCaja)}*\n\n` +
    `✨ Con ${money(totals.totalCaja)} en caja tenemos cubiertos los próximos *${totals.futureDrawsPossible} sorteos* sin poner más dinero.\n\n` +
    `📲 Consulta la app en tiempo real aquí:\n${window.location.origin}\n\n` +
    `¡A por el bote! 🍀`;

  const generateWhatsAppMessage = async () => {
    const ok = await copyToClipboard(buildWhatsAppMessage(), 'Copiado', 'Resumen copiado al portapapeles, listo para WhatsApp.');
    if (ok) {
      setCopiedNotification(true);
      window.setTimeout(() => setCopiedNotification(false), 3000);
    }
  };

  const handleExportData = () => {
    const blob = new Blob([JSON.stringify(syndicate, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `penya-${todayISO()}.json`;
    link.click();
    URL.revokeObjectURL(url);
    showToast('success', 'Copia de seguridad de la peña descargada.', 'Exportación');
  };

  const handleImportData = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !isAdmin) return;
    try {
      const parsed = normalizeSyndicate(JSON.parse(await file.text()));
      if (!confirm(`Se sustituirán los datos actuales por ${parsed.draws.length} sorteos y ${parsed.members.length} socios. ¿Continuar?`)) return;
      const ok = await commit(() => parsed);
      showToast(ok ? 'success' : 'error', ok ? 'Datos importados y sincronizados.' : 'No se pudieron importar los datos.');
    } catch {
      showToast('error', 'El archivo no contiene un estado válido de la peña.');
    }
  };

  interface OfficialStats {
    totalDraws: number;
    fromDate: string;
    toDate: string;
    source: 'official' | 'local';
    numberCounts: Map<number, number>;
    complementCounts: Map<number, number>;
    reintegroCounts: Map<number, number>;
  }

  // Rango de fechas para el análisis de frecuencia de números
  const [statsFromDate, setStatsFromDate] = useState(() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 1);
    return d.toISOString().slice(0, 10);
  });
  const [statsToDate, setStatsToDate] = useState(() => todayISO());
  const [officialStats, setOfficialStats] = useState<OfficialStats | null>(null);
  const [isLoadingStats, setIsLoadingStats] = useState(false);

  /** Fallback local si el servidor o laprimitiva.info no responden. */
  const localStatsForRange = useCallback((from: string, to: string): OfficialStats => {
    const recentDraws = syndicate.draws.filter((draw) => draw.date >= from && draw.date <= to && draw.officialCombination);
    const numberCounts = new Map<number, number>();
    const complementCounts = new Map<number, number>();
    const reintegroCounts = new Map<number, number>();
    recentDraws.forEach((draw) => {
      const comb = draw.officialCombination;
      if (!comb) return;
      comb.numbers.forEach((number) => {
        numberCounts.set(number, (numberCounts.get(number) ?? 0) + 1);
      });
      complementCounts.set(comb.complementario, (complementCounts.get(comb.complementario) ?? 0) + 1);
      reintegroCounts.set(comb.reintegro, (reintegroCounts.get(comb.reintegro) ?? 0) + 1);
    });
    return {
      totalDraws: recentDraws.length,
      fromDate: from,
      toDate: to,
      source: 'local',
      numberCounts,
      complementCounts,
      reintegroCounts,
    };
  }, [syndicate.draws]);

  const loadOfficialStatsRange = useCallback(async (from: string, to: string, force = false): Promise<OfficialStats> => {
    if (!force && officialStats && officialStats.fromDate === from && officialStats.toDate === to && officialStats.source === 'official') {
      return officialStats;
    }
    setIsLoadingStats(true);
    try {
      const params = new URLSearchParams({ from, to });
      const response = await fetch(`/api/results/range?${params.toString()}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      const stats: OfficialStats = {
        totalDraws: Number(payload.totalDraws) || 0,
        fromDate: String(payload.fromDate || from),
        toDate: String(payload.toDate || to),
        source: payload.source === 'official' ? 'official' : 'local',
        numberCounts: new Map<number, number>(Array.isArray(payload.numberCounts) ? payload.numberCounts : []),
        complementCounts: new Map<number, number>(Array.isArray(payload.complementCounts) ? payload.complementCounts : []),
        reintegroCounts: new Map<number, number>(Array.isArray(payload.reintegroCounts) ? payload.reintegroCounts : []),
      };
      if (stats.totalDraws > 0) {
        setOfficialStats(stats);
        return stats;
      }
    } catch {
      // Usa el histórico local si falla la conexión
    } finally {
      setIsLoadingStats(false);
    }
    const localStats = localStatsForRange(from, to);
    setOfficialStats(localStats);
    return localStats;
  }, [localStatsForRange, officialStats]);

  useEffect(() => {
    if (activeTab === 'ai' && !officialStats) {
      void loadOfficialStatsRange(statsFromDate, statsToDate);
    }
  }, [activeTab, loadOfficialStatsRange, officialStats, statsFromDate, statsToDate]);

  const nextDrawDates = (count: number): string[] => {
    if (count <= 0) return [];
    const existing = new Set(syndicate.draws.map((draw) => draw.date));
    const cursor = new Date(`${todayISO()}T00:00:00Z`);
    const dates: string[] = [];
    // Jueves (4) y sábados (6); como máximo dos años de búsqueda.
    for (let checked = 0; checked < 730 && dates.length < count; checked += 1) {
      cursor.setUTCDate(cursor.getUTCDate() + 1);
      const weekday = cursor.getUTCDay();
      if (weekday !== 4 && weekday !== 6) continue;
      const iso = cursor.toISOString().slice(0, 10);
      if (!existing.has(iso)) dates.push(iso);
    }
    return dates;
  };

  const buildFutureDrawsMessage = () => {
    const count = totals.futureDrawsPossible;
    if (count === 0) {
      return 'No hay caja suficiente para cubrir el próximo sorteo. Hay que reunir más cuotas o aportaciones antes de seguir jugando.';
    }
    const dates = nextDrawDates(Math.min(count, 10));
    const lines = dates.map((iso, index) => `${index + 1}. ${weekdayFromDate(iso)} ${formatDateShort(iso)}`);
    const weeks = Math.floor(count / 2);
    return `📅 *PRÓXIMOS SORTEOS CUBIERTOS* 🎰\n\n` +
      `Caja disponible: *${money(totals.totalCaja)}*\n` +
      `Coste por sorteo: ${money(syndicate.costPerDraw)} (5 apuestas × 1 €)\n` +
      `Sorteos que podemos jugar sin aportaciones: *${count}* (aprox. ${weeks} semanas a jueves y sábados).\n\n` +
      `Próximas fechas previstas:\n${lines.join('\n')}` +
      (count > dates.length ? `\n…y ${count - dates.length} sorteos más.` : '') +
      `\n\n📲 Consulta la app en tiempo real aquí:\n${window.location.origin}`;
  };

  /** Calcula N apuestas (1..8) según la estrategia elegida: más frecuentes, fríos o 3 pares / 3 impares. */
  const computeBetsByStrategy = useCallback((
    stats: OfficialStats | null,
    numBets: number,
    strategy: 'hot' | 'cold' | 'balanced' = 'hot',
  ): { lines: BetLine[]; reintegro: number } => {
    const count = Math.max(1, Math.min(8, numBets));
    if (!stats || stats.totalDraws === 0) {
      const lines: BetLine[] = Array.from({ length: count }, (_, i) => ({
        line: i + 1,
        numbers: generateRandomBetNumbers(),
        reintegro: 0,
      }));
      return { lines, reintegro: 0 };
    }

    const bestReintegro = Array.from({ length: 10 }, (_, i) => i)
      .sort((a, b) => (stats.reintegroCounts.get(b) ?? 0) - (stats.reintegroCounts.get(a) ?? 0) || a - b)[0] ?? 0;

    if (strategy === 'balanced') {
      const evens = Array.from({ length: 49 }, (_, i) => i + 1)
        .filter((n) => n % 2 === 0)
        .sort((a, b) => (stats.numberCounts.get(b) ?? 0) - (stats.numberCounts.get(a) ?? 0) || a - b);
      const odds = Array.from({ length: 49 }, (_, i) => i + 1)
        .filter((n) => n % 2 !== 0)
        .sort((a, b) => (stats.numberCounts.get(b) ?? 0) - (stats.numberCounts.get(a) ?? 0) || a - b);

      const lines: BetLine[] = [];
      for (let lineIdx = 0; lineIdx < count; lineIdx++) {
        const start = lineIdx * 3;
        const pickedEvens = start + 3 <= evens.length ? evens.slice(start, start + 3) : evens.slice(0, 3);
        const pickedOdds = start + 3 <= odds.length ? odds.slice(start, start + 3) : odds.slice(0, 3);
        lines.push({
          line: lineIdx + 1,
          numbers: [...pickedEvens, ...pickedOdds].sort((a, b) => a - b),
          reintegro: bestReintegro,
        });
      }
      return { lines, reintegro: bestReintegro };
    }

    const sortedNumbers = Array.from({ length: 49 }, (_, i) => i + 1)
      .sort((a, b) => {
        const freqA = stats.numberCounts.get(a) ?? 0;
        const freqB = stats.numberCounts.get(b) ?? 0;
        return strategy === 'cold' ? freqA - freqB || a - b : freqB - freqA || a - b;
      });

    const lines: BetLine[] = [];
    for (let lineIdx = 0; lineIdx < count; lineIdx++) {
      const startIdx = lineIdx * 6;
      const betNums = startIdx + 6 <= sortedNumbers.length
        ? sortedNumbers.slice(startIdx, startIdx + 6).sort((a, b) => a - b)
        : sortedNumbers.slice(0, 6).sort((a, b) => a - b);
      lines.push({
        line: lineIdx + 1,
        numbers: betNums,
        reintegro: bestReintegro,
      });
    }

    return { lines, reintegro: bestReintegro };
  }, []);

  const buildFrequentNumbersMessage = (stats: OfficialStats) => {
    if (stats.totalDraws === 0) {
      return `No se encontraron resultados oficiales en el periodo del ${formatDateShort(stats.fromDate)} al ${formatDateShort(stats.toDate)}.`;
    }
    const topNumbers = [...stats.numberCounts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0] - b[0])
      .slice(0, 18);
    const coldNumbers = Array.from({ length: 49 }, (_, index) => [index + 1, stats.numberCounts.get(index + 1) ?? 0] as [number, number])
      .sort((a, b) => a[1] - b[1] || a[0] - b[0])
      .slice(0, 6);
    const topComplements = [...stats.complementCounts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0] - b[0])
      .slice(0, 5);
    const topReintegros = [...stats.reintegroCounts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0] - b[0])
      .slice(0, 3);
    const pad2 = (n: number) => String(n).padStart(2, '0');
    const sourceText = stats.source === 'official'
      ? 'Histórico oficial completo de La Primitiva (lunes, jueves y sábados).'
      : 'Calculado con los sorteos registrados en la app.';

    return `📈 *NÚMEROS MÁS FRECUENTES DE LA PRIMITIVA*\n` +
      `📅 *Periodo seleccionado:* ${formatDateShort(stats.fromDate)} al ${formatDateShort(stats.toDate)}\n` +
      `🎰 *Sorteos oficiales analizados:* ${stats.totalDraws}\n\n` +
      `🔥 *Bolas que más han salido:*\n` +
      `${topNumbers.map(([number, times]) => `${pad2(number)} (${times} veces)`).join(' · ')}\n\n` +
      `❄️ *Bolas que menos han salido (frías):*\n` +
      `${coldNumbers.map(([number, times]) => `${pad2(number)} (${times})`).join(' · ')}\n\n` +
      `➕ *Complementarios más frecuentes:*\n` +
      `${topComplements.map(([number, times]) => `${pad2(number)} (${times})`).join(' · ')}\n\n` +
      `🎯 *Reintegros más repetidos:*\n` +
      `${topReintegros.map(([number, times]) => `R${number} (${times} veces)`).join(' · ')}\n\n` +
      sourceText;
  };

  const buildCalculatedBetsMessage = (stats: OfficialStats, count: number, strategy: 'hot' | 'cold' | 'balanced' = 'hot') => {
    const { lines, reintegro } = computeBetsByStrategy(stats, count, strategy);
    const pad2 = (n: number) => String(n).padStart(2, '0');
    const linesText = lines
      .map(
        (l) =>
          `Apuesta #${l.line}: ${l.numbers.map(pad2).join(' - ')}` +
          `  (Apariciones: ${l.numbers.map((n) => stats.numberCounts.get(n) ?? 0).join('/')})`
      )
      .join('\n');

    const titleByStrategy = {
      hot: `🎯 *${count} APUESTAS CALCULADAS POR MAYOR FRECUENCIA* 🎰`,
      cold: `❄️ *${count} APUESTAS DE NÚMEROS FRÍOS (BOLAS ATRASADAS)* 🎲`,
      balanced: `⚖️ *${count} APUESTAS FÓRMULA 3 PARES / 3 IMPARES* 🎱`,
    }[strategy];

    const criteriaByStrategy = {
      hot: `Criterio: cada apuesta selecciona los 6 números que más veces han salido en La Primitiva en el periodo seleccionado.`,
      cold: `Criterio: selecciona las bolas más atrasadas (menos frecuentes) buscando la corrección estadística hacia la media.`,
      balanced: `Criterio: combina los números más frecuentes respetando la simetría 3 pares / 3 impares presente en más del 65% de los sorteos.`,
    }[strategy];

    return `${titleByStrategy}\n` +
      `📅 *Rango analizado:* ${formatDateShort(stats.fromDate)} – ${formatDateShort(stats.toDate)} (${stats.totalDraws} sorteos oficiales)\n` +
      `💰 *Coste total:* ${count} € (${count} apuestas × 1 €)\n\n` +
      `${linesText}\n\n` +
      `🎯 *Reintegro más repetido:* R${reintegro} (con ${stats.reintegroCounts.get(reintegro) ?? 0} apariciones)\n\n` +
      criteriaByStrategy;
  };

  const buildReintegrosReportMessage = (stats: OfficialStats) => {
    const ranking = Array.from({ length: 10 }, (_, i) => i)
      .map((r) => ({ reintegro: r, count: stats.reintegroCounts.get(r) ?? 0 }))
      .sort((a, b) => b.count - a.count || a.reintegro - b.reintegro);
    return `🎯 *ESTUDIO DE REINTEGROS Y RENTABILIDAD* 💰\n` +
      `📅 *Periodo:* ${formatDateShort(stats.fromDate)} – ${formatDateShort(stats.toDate)} (${stats.totalDraws} sorteos analizados)\n\n` +
      `Ranking de reintegros oficiales:\n` +
      ranking.map((item, idx) => `${idx + 1}º -> Reintegro ${item.reintegro}: ${item.count} veces (${((item.count / (stats.totalDraws || 1)) * 100).toFixed(1)}%)`).join('\n') +
      `\n\n💡 En La Primitiva, el reintegro devuelve el 100% de la apuesta (1 € por cada línea jugada). Jugar con el reintegro de mayor frecuencia maximiza las semanas en que el boleto de la peña sale gratis.`;
  };

  const openBetCalculator = (strategy: 'hot' | 'cold' | 'balanced') => {
    setCalcBetStrategy(strategy);
    setShowCalculateBetModal(true);
    if (!officialStats || officialStats.fromDate !== statsFromDate || officialStats.toDate !== statsToDate) {
      void loadOfficialStatsRange(statsFromDate, statsToDate);
    }
  };

  const openReintegrosStudy = () => {
    setShowReintegrosModal(true);
    if (!officialStats || officialStats.fromDate !== statsFromDate || officialStats.toDate !== statsToDate) {
      void loadOfficialStatsRange(statsFromDate, statsToDate);
    }
  };

  const handleShowFrequentNumbers = async () => {
    const stats = await loadOfficialStatsRange(statsFromDate, statsToDate);
    await showFixedResult(buildFrequentNumbersMessage(stats), 'Estadística de números más frecuentes copiada.');
  };

  const handleShowCalculatedBets = async (count = calcBetCount, strategy = calcBetStrategy) => {
    const stats = await loadOfficialStatsRange(statsFromDate, statsToDate);
    const label = strategy === 'cold' ? 'de números fríos' : strategy === 'balanced' ? 'equilibradas 3P/3I' : 'por frecuencia';
    await showFixedResult(buildCalculatedBetsMessage(stats, count, strategy), `${count} apuestas ${label} copiadas al portapapeles.`);
  };

  const handleShowReintegrosReport = async () => {
    const stats = await loadOfficialStatsRange(statsFromDate, statsToDate);
    await showFixedResult(buildReintegrosReportMessage(stats), 'Informe de reintegros copiado al portapapeles.');
  };

  const showFixedResult = async (text: string, copiedMessage: string) => {
    setAiResponse(text);
    await copyToClipboard(text, 'Copiado', copiedMessage);
  };

  const handleRunFixedQuery = async (query: FixedQuery) => {
    await showFixedResult(query.result, 'Resultado copiado al portapapeles.');
  };

  const handleAddFixedQuery = async (event: FormEvent) => {
    event.preventDefault();
    if (!isAdmin) return;
    const title = fixedQueryForm.title.trim();
    const result = fixedQueryForm.result.trim();
    if (!title || !result) return;
    const query: FixedQuery = {
      id: `fq_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      title,
      description: fixedQueryForm.description.trim(),
      result,
    };
    const ok = await commit((prev) => ({ ...prev, fixedQueries: [...prev.fixedQueries, query] }));
    if (ok) {
      setFixedQueryForm({ title: '', description: '', result: '' });
      setShowFixedQueryModal(false);
      showToast('success', 'Opción fija añadida y sincronizada con todos los socios.', 'Opción añadida');
    } else {
      showToast('error', 'No se pudo guardar la opción fija.', 'Error');
    }
  };

  const handleDeleteFixedQuery = async (id: string) => {
    if (!isAdmin) return;
    const ok = await commit((prev) => ({ ...prev, fixedQueries: prev.fixedQueries.filter((query) => query.id !== id) }));
    showToast(ok ? 'success' : 'error', ok ? 'Opción fija eliminada.' : 'No se pudo eliminar la opción.', 'Opciones fijas');
  };

  const handleToggleAdminMode = async () => {
    if (isAdmin) {
      await ensureSocioAuth(true);
      showToast('info', 'Has cambiado a Modo Consulta (vista de socio).', 'Modo Consulta Activado');
    } else {
      setShowAdminPinModal(true);
      setAdminPinInput('');
      setAdminPinError(false);
    }
  };

  const handleVerifyAdminPin = async (event: FormEvent) => {
    event.preventDefault();
    try {
      const adminAuth = await authenticateAdmin(adminPinInput);
      updateAuth(adminAuth);
      setShowAdminPinModal(false);
      showToast('success', 'Modo administrador activado. Ya tienes acceso completo de gestión.', 'Administrador Autenticado');
    } catch {
      setAdminPinError(true);
      showToast('error', 'PIN incorrecto o demasiados intentos.', 'Acceso Denegado');
    }
  };

  const renderDrawCard = (draw: DrawRecord, compact = false) => (
    <DrawCard
      key={draw.id}
      draw={draw}
      compact={compact}
      canUploadTicket={canAddBets}
      isAdmin={isAdmin}
      canDelete={canDeleteDraw(draw)}
      onViewTicket={() => setViewingTicketDraw(draw)}
      onUploadTicket={() => void handleUploadTicketPhoto(draw.id)}
      onEditCombination={(kind, line) => handleOpenWinningModal(draw, kind, line)}
      onDelete={() => void handleDeleteDraw(draw)}
    />
  );

  const renderPaymentPill = (member: Member, monthKey = activeMonth, compact = false) => {
    const paid = isPaidInMonth(member.id, monthKey);
    const payment = syndicate.monthlyPayments.find((p) => p.month === monthKey && p.memberId === member.id);
    return (
      <span
        className={`inline-flex items-center gap-1 sm:gap-1.5 px-2 sm:px-2.5 py-1 rounded-lg text-[11px] font-semibold border whitespace-nowrap shrink-0 max-w-full ${
          paid
            ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
            : 'bg-rose-500/15 border-rose-500/40 text-rose-300'
        }`}
      >
        {paid ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0" /> : <Clock className="w-3.5 h-3.5 shrink-0" />}
        {paid ? (compact ? 'Pagado' : `Pagado · ${money(payment?.amount ?? syndicate.monthlyFee)}`) : 'Pendiente'}
      </span>
    );
  };

  return (
    <div className="min-h-screen w-full max-w-full overflow-x-clip bg-slate-900 text-slate-100 flex flex-col font-sans">
      <input type="file" ref={fileInputRef} accept="image/*" className="hidden" onChange={handleFileInputChange} />
      <input type="file" ref={importInputRef} accept="application/json" className="hidden" onChange={handleImportData} />
      <input type="file" ref={customMusicInputRef} accept="audio/*" className="hidden" onChange={handleCustomMusicSelected} />
      <audio
        ref={audioRef}
        src={currentTrack.url}
        loop={loopMusic}
        preload="none"
        onPlay={() => setIsMusicPlaying(true)}
        onPause={() => setIsMusicPlaying(false)}
        onEnded={() => {
          if (!loopMusic) setIsMusicPlaying(false);
        }}
      />

      {/* ---------- CABECERA ---------- */}
      <header className="lg:sticky lg:top-0 z-40 border-b border-slate-800/80 bg-slate-950/95 backdrop-blur pt-[env(safe-area-inset-top)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]">
        <div className="max-w-7xl mx-auto px-3 py-2.5 sm:px-6 sm:py-3.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5 sm:gap-4">
          {/* Fila superior móvil: logo + título + estado + acceso admin/música */}
          <div className="flex items-center justify-between gap-2 min-w-0">
            <div className="flex min-w-0 items-center gap-2.5">
              <img
                src="/icons/icon-192.png"
                alt={syndicate.name}
                className="w-9 h-9 sm:w-10 sm:h-10 shrink-0 rounded-xl object-cover border border-amber-500/40 shadow-md shadow-amber-500/15"
              />
              <div className="min-w-0">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-sm sm:text-base lg:text-lg font-bold tracking-tight text-white truncate" title={syndicate.name}>
                    {syndicate.name}
                  </span>
                  <span className="hidden sm:inline-flex text-xs px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-medium whitespace-nowrap shrink-0">
                    {paidThisMonth.size}/{syndicate.members.length} pagados en {monthNameFromKey(activeMonth)}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 text-[11px] text-emerald-400 sm:hidden truncate mt-0.5">
                  <span
                    className={`w-1.5 h-1.5 rounded-full shrink-0 ${serverError ? 'bg-rose-400' : isSyncing ? 'bg-amber-400 animate-ping' : 'bg-emerald-400'}`}
                    title={serverError ? 'Sin conexión' : isSyncing ? 'Sincronizando...' : 'En vivo'}
                  />
                  <span className="truncate">{paidThisMonth.size}/{syndicate.members.length} pagados · {monthNameFromKey(activeMonth)}</span>
                </div>
                <div className="text-xs text-slate-400 hidden sm:block">Control Oficial de Lotería Primitiva</div>
              </div>
            </div>

            {/* Controles rápidos compactos en móvil (fila 1) */}
            <div className="flex sm:hidden items-center gap-1.5 shrink-0">
              {isMusicPlaying && (
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    handleToggleMusic();
                  }}
                  onPointerDown={(event) => event.stopPropagation()}
                  aria-label="Pausar música"
                  title="Música reproduciéndose (clic para pausar)"
                  className="h-8 w-8 rounded-lg border bg-amber-500/15 text-amber-300 border-amber-500/40 flex items-center justify-center shrink-0"
                >
                  <Volume2 className="w-3.5 h-3.5 text-amber-400 animate-pulse" />
                </button>
              )}
              {isAdmin && (
                <button
                  onClick={() => setShowPermissionsModal(true)}
                  className="h-8 w-8 text-amber-300 bg-amber-950/70 hover:bg-amber-900 border border-amber-500/40 rounded-lg flex items-center justify-center shrink-0"
                  title="Gestión de permisos y PIN"
                  aria-label="Permisos"
                >
                  <Shield className="w-3.5 h-3.5" />
                </button>
              )}
              <button
                onClick={() => void handleToggleAdminMode()}
                className={`h-8 px-2.5 text-[11px] font-semibold rounded-lg transition-all border shrink-0 whitespace-nowrap flex items-center gap-1 ${isAdmin ? 'bg-amber-500/10 text-amber-400 border-amber-500/30' : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'}`}
                title={isAdmin ? 'Cambiar a vista de socio' : 'Identificarse como administrador'}
              >
                {isAdmin ? <ShieldCheck className="w-3.5 h-3.5 shrink-0" /> : <Eye className="w-3.5 h-3.5 shrink-0" />}
                <span>{isAdmin ? 'Admin' : 'Socio'}</span>
              </button>
            </div>
          </div>

          {/* Navegación de escritorio */}
          <nav className="hidden lg:flex flex-wrap items-center gap-x-4 xl:gap-x-5 gap-y-1 text-sm font-medium text-slate-400">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`transition-colors whitespace-nowrap shrink-0 py-1 flex items-center gap-1.5 ${activeTab === tab.id ? 'text-amber-400 font-semibold border-b-2 border-amber-400' : 'hover:text-white'}`}
              >
                {tab.id === 'ai' && <Sparkles className="w-3.5 h-3.5 text-amber-400" />}
                {tab.label}
                {tab.id === 'sorteos' ? ` (${syndicate.draws.length})` : ''}
                {tab.id === 'cuotas' && syndicate.members.length > paidThisMonth.size ? ` (${syndicate.members.length - paidThisMonth.size})` : ''}
              </button>
            ))}
          </nav>

          {/* Fila inferior móvil: solo Compartir y Nuevo Boleto bien equilibrados */}
          <div className={`grid sm:hidden ${canAddBets ? 'grid-cols-2' : 'grid-cols-1'} gap-2`}>
            <button
              onClick={() => void generateWhatsAppMessage()}
              className="h-9 px-3 text-xs font-semibold text-emerald-300 bg-emerald-950/70 hover:bg-emerald-900 border border-emerald-700/60 rounded-lg whitespace-nowrap flex items-center justify-center gap-1.5"
              title="Copiar resumen para WhatsApp"
            >
              <Share2 className="w-3.5 h-3.5 shrink-0" />
              <span>{copiedNotification ? '¡Copiado!' : 'Compartir'}</span>
            </button>
            {canAddBets && (
              <button
                onClick={() => openNewDrawModal()}
                className="h-9 px-3 border border-amber-400/80 text-xs font-bold text-slate-950 bg-gradient-to-r from-amber-400 to-amber-500 rounded-lg hover:from-amber-300 hover:to-amber-400 transition-colors whitespace-nowrap shadow-md flex items-center justify-center gap-1.5"
                title={isAdmin ? 'Nuevo Boleto' : 'Añadir Mi Boleto'}
              >
                <Plus className="w-3.5 h-3.5 shrink-0" />
                <span>{isAdmin ? 'Nuevo Boleto' : 'Añadir Boleto'}</span>
              </button>
            )}
          </div>

          {/* Botones de acción en tablet/escritorio */}
          <div className="hidden sm:flex items-center justify-end gap-2 shrink-0">
            <div
              className="hidden md:flex items-center gap-1.5 px-2.5 py-1 text-[11px] rounded-lg bg-slate-900 border border-slate-800 text-slate-400 shrink-0"
              title={serverError ? 'El servidor no responde: se muestran los datos guardados localmente' : `Sincronizado. Última actualización: ${lastSyncTime || 'Conectado'}`}
            >
              <span className={`w-2 h-2 rounded-full ${serverError ? 'bg-rose-400' : isSyncing ? 'bg-amber-400 animate-ping' : 'bg-emerald-400 animate-pulse'}`} />
              <span>{serverError ? 'Sin conexión' : isSyncing ? 'Sincronizando...' : 'En vivo'}</span>
            </div>

            <button
              onClick={() => void handleToggleAdminMode()}
              className={`h-9 px-3 text-xs font-semibold rounded-lg transition-all border shrink-0 whitespace-nowrap flex items-center justify-center gap-1.5 ${isAdmin ? 'bg-amber-500/10 text-amber-400 border-amber-500/30 hover:bg-amber-500/20' : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20'}`}
              title={isAdmin ? 'Cambiar a vista de socio' : 'Identificarse como administrador'}
            >
              {isAdmin ? <ShieldCheck className="w-3.5 h-3.5 shrink-0" /> : <Eye className="w-3.5 h-3.5 shrink-0" />}
              <span className="hidden xl:inline">{isAdmin ? 'Modo Administrador' : 'Modo Consulta (Socio)'}</span>
              <span className="xl:hidden">{isAdmin ? 'Admin' : 'Socio'}</span>
            </button>

            {isAdmin && (
              <button onClick={() => setShowPermissionsModal(true)} className="h-9 px-2.5 text-xs font-semibold text-amber-300 bg-amber-950/70 hover:bg-amber-900 border border-amber-500/40 rounded-lg shrink-0 whitespace-nowrap flex items-center justify-center gap-1" title="Gestión de permisos y PIN">
                <Shield className="w-3.5 h-3.5 shrink-0" />
                <span className="hidden md:inline">Permisos</span>
              </button>
            )}

            <button onClick={() => void handleExportData()} className="flex h-9 p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg shrink-0 items-center justify-center" title="Descargar copia de seguridad (JSON)">
              <Download className="w-4 h-4 shrink-0" />
            </button>
            {isAdmin && (
              <button onClick={() => importInputRef.current?.click()} className="flex h-9 p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg shrink-0 items-center justify-center" title="Importar copia de seguridad (JSON)">
                <Upload className="w-4 h-4 shrink-0" />
              </button>
            )}

            <button onClick={() => void generateWhatsAppMessage()} className="h-9 px-3 text-xs font-medium text-emerald-300 bg-emerald-950/70 hover:bg-emerald-900 border border-emerald-700/60 rounded-lg shrink-0 whitespace-nowrap flex items-center justify-center gap-1.5" title="Copiar resumen para WhatsApp">
              <Share2 className="w-3.5 h-3.5 shrink-0" />
              <span>{copiedNotification ? '¡Copiado!' : 'Compartir'}</span>
            </button>

            {canAddBets && (
              <button onClick={() => openNewDrawModal()} className="h-9 px-3.5 border border-amber-400/80 text-xs font-semibold text-slate-950 bg-gradient-to-r from-amber-400 to-amber-500 rounded-lg hover:from-amber-300 hover:to-amber-400 transition-colors whitespace-nowrap shrink-0 shadow-md flex items-center justify-center gap-1.5" title={isAdmin ? 'Nuevo Boleto' : 'Añadir Mi Boleto'}>
                <Plus className="w-3.5 h-3.5 shrink-0" />
                <span>{isAdmin ? 'Nuevo Boleto' : 'Añadir Mi Boleto'}</span>
              </button>
            )}

            {isMusicPlaying && (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  handleToggleMusic();
                }}
                onPointerDown={(event) => event.stopPropagation()}
                aria-label="Pausar música"
                title="Música reproduciéndose (clic para pausar)"
                className="h-9 px-2.5 text-xs font-semibold rounded-lg border bg-amber-500/15 text-amber-300 border-amber-500/40 hover:bg-amber-500/25 transition-colors whitespace-nowrap shrink-0 flex items-center justify-center gap-1.5"
              >
                <Volume2 className="w-3.5 h-3.5 text-amber-400 animate-pulse shrink-0" />
                <span>Pausar</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* ---------- PESTAÑAS MÓVILES Y TABLET (SIN DESPLAZAMIENTO HORIZONTAL) ---------- */}
      <nav
        aria-label="Secciones principales"
        className="sticky top-0 z-40 border-b border-slate-800 bg-slate-950/95 backdrop-blur px-2.5 py-2 lg:hidden pl-[max(0.625rem,env(safe-area-inset-left))] pr-[max(0.625rem,env(safe-area-inset-right))]"
      >
        {/* Móvil: 2 filas equilibradas (4 arriba + 3 abajo) para ver todas las pestañas a la vez */}
        <div className="space-y-1 sm:hidden">
          <div className="grid grid-cols-4 gap-1">
            {TABS.slice(0, 4).map((tab) => {
              const active = activeTab === tab.id;
              const pendingCount = tab.id === 'cuotas' ? Math.max(syndicate.members.length - paidThisMonth.size, 0) : 0;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`px-1 py-1.5 rounded-lg border text-[11px] leading-tight text-center transition-colors flex items-center justify-center gap-1 min-w-0 ${
                    active
                      ? 'bg-amber-500/15 text-amber-300 border-amber-500/40 font-bold shadow-sm'
                      : 'bg-slate-900/70 text-slate-300 border-slate-800/80 font-medium hover:text-white'
                  }`}
                >
                  <span className="truncate">{tab.short}</span>
                  {tab.id === 'sorteos' && (
                    <span className={`text-[10px] font-mono ${active ? 'text-amber-200' : 'text-slate-400'}`}>
                      {syndicate.draws.length}
                    </span>
                  )}
                  {pendingCount > 0 && (
                    <span className="text-[10px] px-1 rounded bg-rose-500/20 text-rose-300 font-bold">
                      {pendingCount}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <div className="grid grid-cols-3 gap-1">
            {TABS.slice(4).map((tab) => {
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`px-1.5 py-1.5 rounded-lg border text-[11px] leading-tight text-center transition-colors flex items-center justify-center gap-1 min-w-0 ${
                    active
                      ? 'bg-amber-500/15 text-amber-300 border-amber-500/40 font-bold shadow-sm'
                      : 'bg-slate-900/70 text-slate-300 border-slate-800/80 font-medium hover:text-white'
                  }`}
                >
                  {tab.id === 'ai' && <Sparkles className="w-3 h-3 text-amber-400 shrink-0" />}
                  <span className="truncate">{tab.short}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Tablet (sm a md): las 7 pestañas en una sola fila sin scroll */}
        <div className="hidden sm:grid grid-cols-7 gap-1.5 max-w-7xl mx-auto">
          {TABS.map((tab) => {
            const active = activeTab === tab.id;
            const pendingCount = tab.id === 'cuotas' ? Math.max(syndicate.members.length - paidThisMonth.size, 0) : 0;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`px-2 py-1.5 rounded-lg border text-xs leading-tight text-center transition-colors flex items-center justify-center gap-1 min-w-0 ${
                  active
                    ? 'bg-amber-500/15 text-amber-300 border-amber-500/40 font-bold'
                    : 'bg-slate-900/70 text-slate-300 border-slate-800/80 font-medium hover:text-white'
                }`}
              >
                {tab.id === 'ai' && <Sparkles className="w-3.5 h-3.5 text-amber-400 shrink-0" />}
                <span className="truncate">{tab.short}</span>
                {tab.id === 'sorteos' && (
                  <span className="text-[11px] font-mono opacity-80">({syndicate.draws.length})</span>
                )}
                {pendingCount > 0 && (
                  <span className="text-[10px] px-1 rounded bg-rose-500/20 text-rose-300 font-bold">
                    {pendingCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </nav>

      {newDrawAlert && activeTab !== 'resumen' && (
        <div className="bg-amber-950/70 border-b border-amber-500/40 px-6 py-2.5 flex flex-wrap items-center justify-center gap-3 text-xs text-amber-100">
          <span className="flex min-w-0 items-center gap-2 font-medium break-words">
            <Sparkles className="w-4 h-4 text-amber-400 shrink-0" />
            📢 Nuevo boleto registrado: <strong>sorteo #{newDrawAlert.index}</strong> · {newDrawAlert.displayDate} · {money(newDrawAlert.betCost)}
          </span>
          <button onClick={() => { setActiveTab('sorteos'); setDrawMonthFilter('all'); setOnlyPrizesFilter(false); }} className="px-2.5 py-1 text-[11px] font-bold text-slate-950 bg-amber-400 hover:bg-amber-300 rounded-lg">
            Ver boleto
          </button>
          <button onClick={() => setNewDrawAlert(null)} className="px-2 py-1 text-[11px] text-amber-200 hover:text-white underline">
            Cerrar aviso
          </button>
        </div>
      )}

      <main className="flex-1 max-w-7xl w-full min-w-0 mx-auto py-4 sm:py-6 pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] sm:pl-[max(1.5rem,env(safe-area-inset-left))] sm:pr-[max(1.5rem,env(safe-area-inset-right))] space-y-6 sm:space-y-8 overflow-x-clip">
        {!auth && (
          <div className="bg-emerald-950/40 border border-emerald-500/30 rounded-xl px-3.5 sm:px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-emerald-200">
            <div className="flex items-start sm:items-center gap-2.5 min-w-0 flex-1">
              <Eye className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5 sm:mt-0" />
              <p className="leading-relaxed break-words">
                Estás en <strong className="text-white font-semibold">vista de consulta</strong>. Los datos se actualizan en tiempo real según los gestiona el administrador.
              </p>
            </div>
            <button
              onClick={() => setShowAdminPinModal(true)}
              className="self-start sm:self-center shrink-0 text-amber-300 hover:text-amber-200 hover:underline font-semibold"
            >
              ¿Eres administrador? Entrar
            </button>
          </div>
        )}

        {/* ================= RESUMEN ================= */}
        {activeTab === 'resumen' && (
          <div className="space-y-5 sm:space-y-8 min-w-0">
            {upcomingDraws.length > 0 && (
              <section className="bg-gradient-to-br from-amber-950/40 via-slate-950/90 to-slate-950 border border-amber-500/45 rounded-2xl p-3.5 sm:p-5 space-y-3.5 shadow-xl min-w-0 overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-amber-500/20 pb-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-base sm:text-lg font-extrabold text-white flex items-center gap-2">
                        <Calendar className="w-4 h-4 sm:w-5 sm:h-5 text-amber-400 shrink-0" />
                        <span>
                          {upcomingDraws.length === 1
                            ? 'Próximo sorteo por celebrarse'
                            : `Próximos sorteos por celebrarse (${upcomingDraws.length})`}
                        </span>
                      </h2>
                      <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md bg-amber-500/15 text-amber-300 border border-amber-500/30">
                        Pendiente de sorteo
                      </span>
                    </div>
                    <p className="text-xs text-slate-300 mt-1">
                      Boleto ya registrado cuya combinación oficial aún no se ha celebrado. El resultado se comprobará automáticamente a las 23:00.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => { setActiveTab('sorteos'); setDrawMonthFilter('all'); setOnlyPrizesFilter(false); }}
                    className="px-3 py-1.5 text-xs font-semibold text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 rounded-lg transition-colors shrink-0"
                  >
                    Ver todos los sorteos
                  </button>
                </div>
                <div className="space-y-3">
                  {upcomingDraws.map((draw) => renderDrawCard(draw, false))}
                </div>
              </section>
            )}

            <div className="relative rounded-2xl bg-gradient-to-r from-emerald-950/70 via-slate-900 to-amber-950/50 border border-emerald-500/20 p-4 overflow-hidden shadow-2xl sm:p-8">
              <div className="absolute right-0 top-0 w-96 h-96 bg-emerald-500/5 rounded-full blur-3xl pointer-events-none" />
              <div className="relative z-10 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 sm:gap-6 min-w-0">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-xs font-medium text-emerald-400 mb-2">
                    <CheckCircle2 className="w-4 h-4 shrink-0" /> Control Oficial Centralizado de la Peña
                  </div>
                  <h1 className="text-2xl sm:text-3xl md:text-4xl font-extrabold tracking-tight text-white mb-2 break-words">{syndicate.name}</h1>
                  <p className="text-slate-300 max-w-2xl text-sm leading-relaxed break-words">
                    Cuota mensual de <strong className="text-amber-300">{money(syndicate.monthlyFee)}</strong> por socio. En <strong>{monthNameFromKey(activeMonth)}</strong> hay {paidThisMonth.size} de {syndicate.members.length} pagados. Hemos jugado {syndicate.draws.length} sorteos y disponemos de <strong className="text-emerald-300">{money(totals.totalCaja)} en CAJA</strong> para seguir jugando o repartir.
                  </p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-2.5 sm:gap-4">
              <StatCard label="Caja disponible" value={money(totals.totalCaja)} hint={`${totals.futureDrawsPossible} sorteos futuros`} icon={<Wallet className="w-3.5 h-3.5" />} highlighted />
              <StatCard label="Cuota mensual" value={money(syndicate.monthlyFee)} hint="Por socio y mes" icon={<Settings2 className="w-3.5 h-3.5" />} tone="amber" />
              <StatCard label={`Pagados en ${monthNameFromKey(activeMonth)}`} value={`${paidThisMonth.size} / ${syndicate.members.length}`} hint="Cuotas marcadas en verde" icon={<CheckCircle2 className="w-3.5 h-3.5" />} tone="emerald" />
              <StatCard label="Pendientes" value={String(Math.max(syndicate.members.length - paidThisMonth.size, 0))} hint="Cuotas marcadas en rojo" icon={<Clock className="w-3.5 h-3.5" />} tone="rose" />
              <StatCard label="Extras y premios" value={money(totals.totalExtras + totals.totalPremios)} hint={`Extras ${money(totals.totalExtras)} · premios ${money(totals.totalPremios)}`} icon={<Trophy className="w-3.5 h-3.5" />} tone="amber" />
              <StatCard label="Aportado históricamente" value={money(totals.totalPagado)} hint="Cómputo total de la peña" icon={<ArrowDownRight className="w-3.5 h-3.5" />} tone="slate" />
            </div>

            {/* QUICK NAVIGATION / ACCESS CARDS TO OTHER TABS */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 pt-2">
              <button 
                onClick={() => setActiveTab('sorteos')}
                className="bg-slate-950/60 hover:bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-2xl p-5 text-left transition-all space-y-2 group shadow-sm"
              >
                <div className="w-9 h-9 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 group-hover:scale-110 transition-transform">
                  <Calendar className="w-4 h-4" />
                </div>
                <div className="text-base font-bold text-white">Sorteos y Boletos ({syndicate.draws.length})</div>
                <div className="text-xs text-slate-400">Ver todas las apuestas jugadas, fotos de boletos y combinaciones oficiales.</div>
              </button>

              <button 
                onClick={() => setActiveTab('cuotas')}
                className="bg-slate-950/60 hover:bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-2xl p-5 text-left transition-all space-y-2 group shadow-sm"
              >
                <div className="w-9 h-9 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 group-hover:scale-110 transition-transform">
                  <Users className="w-4 h-4" />
                </div>
                <div className="text-base font-bold text-white">Cuotas y Socios ({syndicate.members.length})</div>
                <div className="text-xs text-slate-400">Control mensual de pagos por socio, registro de cuotas y aportaciones extras.</div>
              </button>

              <button 
                onClick={() => setActiveTab('meses')}
                className="bg-slate-950/60 hover:bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-2xl p-5 text-left transition-all space-y-2 group shadow-sm"
              >
                <div className="w-9 h-9 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400 group-hover:scale-110 transition-transform">
                  <Clock className="w-4 h-4" />
                </div>
                <div className="text-base font-bold text-white">Arrastre de Meses</div>
                <div className="text-xs text-slate-400">Evolución mes a mes del saldo acumulado, gastos e ingresos de la peña.</div>
              </button>

              <button 
                onClick={() => setActiveTab('reparto')}
                className="bg-slate-950/60 hover:bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-2xl p-5 text-left transition-all space-y-2 group shadow-sm"
              >
                <div className="w-9 h-9 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 group-hover:scale-110 transition-transform">
                  <DollarSign className="w-4 h-4" />
                </div>
                <div className="text-base font-bold text-white">Reparto y Ganancias</div>
                <div className="text-xs text-slate-400">Simulación y ejecución de reparto de premios o caja entre los socios.</div>
              </button>

              <button 
                onClick={() => setActiveTab('ai')}
                className="bg-slate-950/60 hover:bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-2xl p-5 text-left transition-all space-y-2 group shadow-sm"
              >
                <div className="w-9 h-9 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 group-hover:scale-110 transition-transform">
                  <Sparkles className="w-4 h-4" />
                </div>
                <div className="text-base font-bold text-white">Asistente IA y Estadísticas</div>
                <div className="text-xs text-slate-400">Generador de comunicados para WhatsApp, consultas inteligentes y estadísticas.</div>
              </button>
            </div>
          </div>
        )}

        {/* ================= CUOTAS Y EXTRAS ================= */}
        {activeTab === 'cuotas' && (
          <div className="space-y-6 min-w-0">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div className="min-w-0">
                <h1 className="text-xl sm:text-2xl font-extrabold text-white break-words">Cuotas Mensuales y Aportaciones Extras</h1>
                <p className="text-sm text-slate-400 break-words">
                  Tablero de {monthNameFromKey(activeMonth)}: verde = cuota pagada, rojo = pendiente. Cuota actual: <strong className="text-amber-300">{money(syndicate.monthlyFee)}</strong> por socio.
                </p>
              </div>
              {isAdmin && (
                <button
                  onClick={() => { setFeeInput(syndicate.monthlyFee); setShowFeeModal(true); }}
                  className="px-4 py-2 text-xs font-semibold text-slate-950 bg-amber-400 hover:bg-amber-300 rounded-xl shadow-md flex items-center gap-1.5 shrink-0"
                >
                  <Settings2 className="w-4 h-4" /> Modificar cuota
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
              <StatCard label="Pagados" value={`${paidThisMonth.size} / ${syndicate.members.length}`} hint={monthNameFromKey(activeMonth)} icon={<CheckCircle2 className="w-3.5 h-3.5" />} tone="emerald" />
              <StatCard label="Pendientes" value={String(Math.max(syndicate.members.length - paidThisMonth.size, 0))} icon={<Clock className="w-3.5 h-3.5" />} tone="rose" hint="Marcados en rojo" />
              <StatCard label="Cuotas nuevas del mes" value={money(freshMoneyThisMonth)} hint="Dinero añadido a la caja" icon={<ArrowDownRight className="w-3.5 h-3.5" />} tone="blue" />
              <StatCard label="Aportaciones extras" value={money(totals.totalExtras)} hint={`${syndicate.extraContributions.length} registros`} icon={<Wallet className="w-3.5 h-3.5" />} tone="amber" />
            </div>

            <div className="bg-amber-500/10 border border-amber-400/35 rounded-2xl p-3.5 sm:p-5 shadow-md flex flex-wrap items-center justify-between gap-3 sm:gap-4 min-w-0 overflow-hidden">
              <div className="flex flex-wrap items-center gap-2.5 sm:gap-3.5 min-w-0 w-full sm:w-auto">
                <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-amber-400/15 border border-amber-400/30 flex items-center justify-center shrink-0">
                  <Calendar className="w-5 h-5 text-amber-300" />
                </div>
                <span className="text-sm sm:text-lg font-bold text-amber-100 tracking-tight">Mes del tablero:</span>
                <div className="relative inline-flex items-center max-w-full min-w-0">
                  <select
                    aria-label="Mes del tablero"
                    value={activeMonth}
                    onChange={(e) => setSelectedMonth(e.target.value)}
                    className="appearance-none cursor-pointer max-w-full bg-amber-300/20 hover:bg-amber-300/30 text-amber-100 border border-amber-300/60 rounded-xl pl-3.5 pr-10 py-2 sm:py-2.5 text-sm sm:text-base font-bold shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-amber-300/50"
                  >
                    {syndicate.months.map((key) => (
                      <option key={key} value={key} className="bg-slate-900 text-white font-semibold">
                        {monthNameFromKey(key)}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3 w-5 h-5 text-amber-200 stroke-[2.25]" />
                </div>
              </div>
              {isAdmin && (
                <form onSubmit={handleAddMonth} className="flex flex-wrap items-center gap-2 w-full sm:w-auto min-w-0">
                  <input
                    type="month"
                    value={newMonthInput}
                    onChange={(e) => setNewMonthInput(e.target.value)}
                    className="min-w-0 flex-1 sm:flex-none max-w-full bg-slate-900 border border-emerald-400/40 text-xs sm:text-sm font-semibold text-white rounded-xl px-3 py-2 focus:outline-none focus:border-emerald-300"
                  />
                  <button type="submit" className="px-3.5 sm:px-4 py-2 text-xs sm:text-sm font-bold text-slate-950 bg-emerald-400 hover:bg-emerald-300 rounded-xl shadow-md flex items-center gap-1.5 shrink-0">
                    <Plus className="w-4 h-4" /> Añadir mes
                  </button>
                </form>
              )}
            </div>

            <div className="bg-slate-950/60 border border-slate-800 rounded-2xl overflow-hidden min-w-0">
              <div className="px-3.5 py-3.5 sm:px-6 sm:py-4 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2.5">
                <div className="min-w-0">
                  <h2 className="text-base font-bold text-white flex items-center gap-2"><Users className="w-4 h-4 text-emerald-400 shrink-0" /> <span className="break-words">Control de cuotas · {monthNameFromKey(activeMonth)}</span></h2>
                  <p className="text-[11px] text-slate-400">Pulsa «Marcar pagado» o «Marcar pendiente» para actualizar el color de cada socio.</p>
                </div>
                <div className="flex items-center gap-3 text-[11px] shrink-0">
                  <span className="flex items-center gap-1.5 text-emerald-300"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500" /> Pagado</span>
                  <span className="flex items-center gap-1.5 text-rose-300"><span className="w-2.5 h-2.5 rounded-full bg-rose-500" /> Pendiente</span>
                </div>
              </div>
              <div className="divide-y divide-slate-800/70">
                {syndicate.members.map((member) => {
                  const paid = isPaidInMonth(member.id);
                  return (
                    <div
                      key={member.id}
                      className={`flex flex-wrap sm:flex-nowrap items-center justify-between gap-2 px-3 py-3 transition-colors sm:gap-3 sm:px-6 ${paid ? 'bg-emerald-950/20' : 'bg-rose-950/10'}`}
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
                        <div className={`w-8 h-8 sm:w-9 sm:h-9 rounded-xl flex items-center justify-center font-bold text-white text-xs border shrink-0 ${paid ? 'bg-emerald-600/30 border-emerald-500/40' : 'bg-rose-600/20 border-rose-500/40'}`}>
                          {member.name.slice(0, 2)}
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-white leading-tight break-words">{member.name}</div>
                          <div className="text-[11px] text-slate-400">Cuota: {money(paymentsThisMonth.find((p) => p.memberId === member.id)?.amount ?? syndicate.monthlyFee)}</div>
                        </div>
                      </div>
                      <div className="flex flex-wrap sm:flex-nowrap items-center justify-end gap-1.5 sm:gap-3 ml-auto max-w-full">
                        <span className="shrink-0">{renderPaymentPill(member, activeMonth, true)}</span>
                        {isAdmin && (
                          <button
                            onClick={() => void handleToggleMonthlyPayment(member.id)}
                            className={`whitespace-nowrap px-2.5 sm:px-3 py-1.5 text-[11px] font-semibold rounded-lg border transition-colors ${paid ? 'bg-rose-500/10 text-rose-300 border-rose-500/30 hover:bg-rose-500/20' : 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/20'}`}
                          >
                            {paid ? 'Marcar pendiente' : 'Marcar pagado'}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
                {syndicate.members.length === 0 && (
                  <p className="px-4 sm:px-6 py-6 text-xs text-slate-500 italic">No hay socios. Añádelos desde la pestaña «Socios».</p>
                )}
              </div>
            </div>

            <div className="bg-slate-950/60 border border-slate-800 rounded-2xl p-4 space-y-4 sm:p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-bold text-white flex items-center gap-2"><Wallet className="w-4 h-4 text-amber-400" /> Aportaciones Extras</h2>
                  <p className="text-xs text-slate-400">Aportaciones fuera de la cuota mensual, como los 3 € de LETI. Total: <strong className="text-amber-300">{money(totals.totalExtras)}</strong>.</p>
                </div>
                {isAdmin && (
                  <button
                    onClick={() => setShowExtraModal(true)}
                    className="px-3.5 py-2 text-xs font-semibold text-slate-950 bg-amber-400 hover:bg-amber-300 rounded-lg flex items-center gap-1.5"
                  >
                    <Plus className="w-3.5 h-3.5" /> Añadir extra
                  </button>
                )}
              </div>
              <div className="space-y-2">
                {syndicate.extraContributions.map((extra) => (
                  <div key={extra.id} className="bg-slate-900/60 border border-slate-800 rounded-xl p-3.5 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 shrink-0"><ArrowDownRight className="w-4 h-4" /></div>
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-white leading-tight break-words">{extra.memberOrConcept}</div>
                        <div className="text-[11px] text-slate-400">{extra.date}{extra.notes ? ` · ${extra.notes}` : ''}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 ml-auto">
                      <span className="text-sm font-extrabold text-emerald-400 tabular-nums">+{money(extra.amount)}</span>
                      {isAdmin && (
                        <button onClick={() => void handleDeleteExtra(extra)} title="Eliminar extra" className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-rose-950/30 rounded-lg">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                {syndicate.extraContributions.length === 0 && <p className="text-xs text-slate-500 italic">No hay aportaciones extras registradas.</p>}
              </div>
            </div>

            <p className="text-[11px] text-slate-500 leading-relaxed">
              Los cuadros marcados como «histórico» ya estaban incluidos en el importe total de los socios, por eso no suman dinero dos veces a la caja. Noviembre de 2026 se creó con los 10 socios pagados; los meses que añadas empiezan con todos pendientes.
            </p>
          </div>
        )}

        {/* ================= SORTEOS ================= */}
        {activeTab === 'sorteos' && (
          <div className="space-y-6 min-w-0">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div className="min-w-0">
                <h1 className="text-xl sm:text-2xl font-extrabold text-white break-words">Sorteos Jugados, Combinaciones y Boletos</h1>
                <p className="text-sm text-slate-400 break-words">Todas nuestras apuestas jugadas por fecha: cada línea del boleto es una apuesta de 1 € (boletos de 4 o 5 apuestas). Lo que coincide con la oficial aparece en verde. La oficial se recupera sola a las 23:00.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {isAdmin && (
                  <button
                    onClick={() => void handleRefreshResults()}
                    disabled={isRefreshingResults}
                    className="px-3 py-2 text-xs font-semibold text-sky-300 bg-sky-500/10 hover:bg-sky-500/20 border border-sky-500/30 rounded-xl flex items-center gap-1.5 disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isRefreshingResults ? 'animate-spin' : ''}`} />
                    {isRefreshingResults ? 'Actualizando...' : 'Actualizar resultados'}
                  </button>
                )}
                {canAddBets && (
                  <button onClick={() => openNewDrawModal()} className="px-4 py-2 text-xs font-semibold text-slate-950 bg-amber-400 hover:bg-amber-300 rounded-xl shadow-md flex items-center gap-1.5">
                    <Plus className="w-4 h-4" /> {isAdmin ? 'Registrar Nuevo Boleto' : 'Añadir Mi Boleto'}
                  </button>
                )}
              </div>
            </div>

            <div className="min-w-0 overflow-hidden bg-slate-950/60 border border-slate-800 rounded-xl p-3.5 sm:p-4 flex flex-wrap items-center justify-between gap-3 sm:gap-4">
              <div className="flex flex-wrap items-center gap-2.5 sm:gap-3 min-w-0 w-full sm:w-auto">
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-300"><Filter className="w-3.5 h-3.5 text-amber-400 shrink-0" /><span>Filtrar por mes:</span></div>
                <div className="relative inline-flex items-center max-w-full min-w-0">
                  <select
                    aria-label="Filtrar por mes"
                    value={drawMonthFilter}
                    onChange={(e) => setDrawMonthFilter(e.target.value)}
                    className="appearance-none cursor-pointer max-w-full bg-amber-300/15 hover:bg-amber-300/25 text-amber-100 border border-amber-300/50 rounded-xl pl-3.5 pr-10 py-2 text-xs sm:text-sm font-bold shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-amber-300/50"
                  >
                    <option value="all" className="bg-slate-900 text-white font-semibold">Todos los meses ({availableMonths.length})</option>
                    {availableMonths.map((key) => (
                      <option key={key} value={key} className="bg-slate-900 text-white font-semibold">
                        {monthNameFromKey(key)}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3 w-4 h-4 text-amber-200 stroke-[2.25]" />
                </div>
                <button
                  onClick={() => setOnlyPrizesFilter((value) => !value)}
                  className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${onlyPrizesFilter ? 'bg-amber-400 text-slate-950 font-bold border-amber-400' : 'bg-slate-900 text-slate-300 border-slate-700 hover:bg-slate-800'}`}
                >
                  {onlyPrizesFilter ? '★ Mostrando sólo con premio' : 'Mostrar sólo sorteos premiados'}
                </button>
              </div>
              <div className="text-xs text-slate-400 font-medium">Mostrando {filteredDraws.length} de {syndicate.draws.length} sorteos</div>
            </div>

            <div className="space-y-3">
              {filteredDraws.map((draw) => renderDrawCard(draw))}
              {filteredDraws.length === 0 && <p className="text-sm text-slate-500 italic">No hay sorteos que coincidan con los filtros.</p>}
            </div>
          </div>
        )}

        {/* ================= SOCIOS ================= */}
        {activeTab === 'socios' && (
          <div className="space-y-6 min-w-0">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div className="min-w-0">
                <h1 className="text-xl sm:text-2xl font-extrabold text-white break-words">Alta, Baja y Detalle de Socios</h1>
                <p className="text-sm text-slate-400 break-words">
                  {syndicate.members.length} socios · cuota de {money(syndicate.monthlyFee)} · {paidThisMonth.size} pagados en {monthNameFromKey(activeMonth)}. Para cambiar el estado de la cuota, usa la pestaña «Cuotas».
                </p>
              </div>
              {isAdmin && (
                <button onClick={() => setShowMemberModal(true)} className="px-4 py-2 text-xs font-semibold text-slate-950 bg-emerald-400 hover:bg-emerald-300 rounded-xl shadow-md flex items-center gap-1.5 shrink-0">
                  <UserPlus className="w-4 h-4" /> Añadir socio
                </button>
              )}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 sm:gap-4 min-w-0">
              {syndicate.members.map((member) => (
                <div key={member.id} className="min-w-0 w-full overflow-hidden bg-slate-950/60 border border-slate-800 rounded-2xl p-3.5 sm:p-5 space-y-3.5 sm:space-y-4 hover:border-slate-700 transition-colors">
                  <div className="flex flex-wrap items-start justify-between gap-2 min-w-0">
                    <div className="flex items-center gap-2.5 sm:gap-3 min-w-0 flex-1">
                      <div className="w-10 h-10 sm:w-11 sm:h-11 shrink-0 rounded-xl bg-gradient-to-br from-emerald-600/30 to-slate-800 border border-emerald-500/30 flex items-center justify-center font-bold text-white text-sm">{member.name.slice(0, 2)}</div>
                      <div className="min-w-0">
                        <div className="text-sm sm:text-base font-bold text-white break-words leading-tight">{member.name}</div>
                        <div className="text-xs text-slate-400 break-words">
                          {member.joinedDate > firstJoinedDate ? `Incorporación: ${formatDateShort(member.joinedDate)}` : 'Socio fundador'}
                        </div>
                      </div>
                    </div>
                    <div className="shrink-0">{renderPaymentPill(member)}</div>
                  </div>
                  <div className="bg-slate-900/60 rounded-xl p-3 flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="min-w-0">
                      <div className="text-slate-400">Total aportado:</div>
                      <div className="text-base font-bold text-emerald-400 tabular-nums mt-0.5">{money(member.totalPaid)}</div>
                    </div>
                    <div className="text-right min-w-0">
                      <div className="text-slate-400">Estado cuota:</div>
                      <div className="mt-0.5 font-semibold">
                        {isPaidInMonth(member.id) ? (
                          <span className="text-emerald-400">Al corriente</span>
                        ) : (
                          <span className="text-rose-400">Pendiente</span>
                        )}
                      </div>
                    </div>
                  </div>
                  {member.notes && <div className="text-xs text-slate-400 bg-slate-900/40 p-2 rounded-lg border border-slate-800 break-words">{member.notes}</div>}
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-800/80">
                    <button onClick={() => { setSelectedMemberForHistory(member); setShowHistoryModal(true); }} className="px-2.5 py-1.5 text-xs font-medium text-slate-300 bg-slate-900 hover:bg-slate-800 hover:text-white rounded-lg border border-slate-800 flex items-center gap-1.5">
                      <History className="w-3.5 h-3.5 text-emerald-400 shrink-0" /> Ver Pagos ({getMemberPayments(member).length})
                    </button>
                    {isAdmin && (
                      <button onClick={() => void handleDeleteMember(member)} className="px-2.5 py-1.5 text-xs font-medium text-rose-300 bg-rose-500/10 hover:bg-rose-500/20 rounded-lg border border-rose-500/30 flex items-center gap-1.5">
                        <Trash2 className="w-3.5 h-3.5 shrink-0" /> Dar de baja
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ================= ARRASTRE DE MESES ================= */}
        {activeTab === 'meses' && (
          <div className="space-y-6 min-w-0">
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl font-extrabold text-white break-words">Evolución y Arrastre de Meses</h1>
              <p className="text-sm text-slate-400 break-words">Detalle mensual de aportaciones (cuotas y extras), apuestas, premios, repartos y saldo de caja arrastrado de forma transparente.</p>
            </div>
            <div className="space-y-4 min-w-0">
              <div className="hidden overflow-hidden rounded-2xl border border-slate-800 bg-slate-950/60 md:block">
                <div className="w-full overflow-x-auto">
                  <table className="w-full table-auto text-left text-xs lg:text-sm">
                    <thead className="bg-slate-900/90 text-slate-400 text-xs uppercase tracking-wider border-b border-slate-800">
                      <tr>
                        <th className="px-2.5 lg:px-4 py-3.5 font-semibold">Mes</th>
                        <th className="px-2.5 lg:px-4 py-3.5 text-center font-semibold">Sorteos</th>
                        <th className="px-2.5 lg:px-4 py-3.5 text-right font-semibold">Aportaciones</th>
                        <th className="px-2.5 lg:px-4 py-3.5 text-right font-semibold">Gasto</th>
                        <th className="px-2.5 lg:px-4 py-3.5 text-right font-semibold">Premios</th>
                        <th className="px-2.5 lg:px-4 py-3.5 text-right font-semibold">Resultado neto</th>
                        <th className="px-2.5 lg:px-4 py-3.5 text-right font-semibold">Caja arrastrada</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                      {monthlyData.map((month) => (
                        <tr key={month.monthKey} className="hover:bg-slate-900/40">
                          <td className="px-2.5 lg:px-4 py-3 font-semibold text-white">{month.monthName}</td>
                          <td className="px-2.5 lg:px-4 py-3 text-center text-slate-300">{month.drawsCount}</td>
                          <td className="px-2.5 lg:px-4 py-3 text-right tabular-nums text-emerald-400 font-medium">{month.contributions > 0 ? `+${money(month.contributions)}` : '—'}</td>
                          <td className="px-2.5 lg:px-4 py-3 text-right text-slate-300 tabular-nums">{money(month.cost)}</td>
                          <td className="px-2.5 lg:px-4 py-3 text-right tabular-nums text-amber-400 font-bold">+{money(month.prizes)}</td>
                          <td className={`px-2.5 lg:px-4 py-3 text-right tabular-nums ${month.netResult >= 0 ? 'text-emerald-400 font-bold' : 'text-rose-400'}`}>{month.netResult >= 0 ? '+' : ''}{money(month.netResult)}</td>
                          <td className="px-2.5 lg:px-4 py-3 text-right font-extrabold text-emerald-400 tabular-nums">{money(month.carriedBalance)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-slate-900 font-bold text-xs uppercase border-t-2 border-slate-800 text-white">
                      <tr>
                        <td className="px-2.5 lg:px-4 py-3.5">Total acumulado</td>
                        <td className="px-2.5 lg:px-4 py-3.5 text-center">{syndicate.draws.length}</td>
                        <td className="px-2.5 lg:px-4 py-3.5 text-right text-emerald-400 tabular-nums">{money(totals.totalPagado)}</td>
                        <td className="px-2.5 lg:px-4 py-3.5 text-right tabular-nums">{money(totals.totalJugado)}</td>
                        <td className="px-2.5 lg:px-4 py-3.5 text-right text-amber-400 tabular-nums">{money(totals.totalPremios)}</td>
                        <td className="px-2.5 lg:px-4 py-3.5 text-right tabular-nums">{money(totals.totalCaja)}</td>
                        <td className="px-2.5 lg:px-4 py-3.5 text-right text-emerald-400 tabular-nums">{money(totals.totalCaja)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>

              <div className="space-y-3 md:hidden">
                {monthlyData.map((month) => {
                  const cells = [
                    { label: 'Sorteos', value: String(month.drawsCount), tone: 'text-slate-300' },
                    { label: 'Aportaciones', value: month.contributions > 0 ? `+${money(month.contributions)}` : '—', tone: 'text-emerald-400' },
                    { label: 'Gasto', value: money(month.cost), tone: 'text-slate-300' },
                    { label: 'Premios', value: `+${money(month.prizes)}`, tone: 'text-amber-400' },
                    { label: 'Resultado neto', value: `${month.netResult >= 0 ? '+' : ''}${money(month.netResult)}`, tone: month.netResult >= 0 ? 'text-emerald-400 font-bold' : 'text-rose-400' },
                    { label: 'Caja arrastrada', value: money(month.carriedBalance), tone: 'text-emerald-400 font-bold' },
                  ];
                  return (
                    <div key={month.monthKey} className="space-y-3 rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h3 className="text-sm font-bold text-white break-words">{month.monthName}</h3>
                        <span className="text-[11px] text-slate-400">Detalle mensual</span>
                      </div>
                      <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                        {cells.map((cell) => (
                          <div key={cell.label} className="min-w-0">
                            <div className="text-[11px] text-slate-400">{cell.label}</div>
                            <div className={`font-semibold tabular-nums break-words ${cell.tone}`}>{cell.value}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
                <div className="space-y-2 rounded-2xl border border-amber-500/30 bg-amber-950/30 p-4">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-amber-300">Total acumulado</div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                    {[
                      { label: 'Sorteos', value: String(syndicate.draws.length), tone: 'text-white' },
                      { label: 'Aportaciones', value: money(totals.totalPagado), tone: 'text-emerald-400' },
                      { label: 'Gasto', value: money(totals.totalJugado), tone: 'text-white' },
                      { label: 'Premios', value: money(totals.totalPremios), tone: 'text-amber-400' },
                      { label: 'Resultado neto', value: money(totals.totalCaja), tone: 'text-white' },
                      { label: 'Caja arrastrada', value: money(totals.totalCaja), tone: 'text-emerald-400 font-bold' },
                    ].map((cell) => (
                      <div key={cell.label} className="min-w-0">
                        <div className="text-[11px] text-slate-400">{cell.label}</div>
                        <div className={`font-semibold tabular-nums break-words ${cell.tone}`}>{cell.value}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
            <div className="bg-slate-950/60 border border-slate-800 rounded-2xl p-4 space-y-3 sm:p-6">
              <h3 className="text-base font-bold text-white flex items-center gap-2"><Clock className="w-4 h-4 text-amber-400" /> Previsión de Caja para Próximos Sorteos</h3>
              <p className="text-xs text-slate-300 leading-relaxed">
                Con {money(totals.totalCaja)} en caja y un coste de {money(syndicate.costPerDraw)} por sorteo (5 apuestas × 1 €), la peña puede jugar <strong>{totals.futureDrawsPossible} sorteos</strong> sin aportaciones adicionales. Jugando dos sorteos por semana, eso equivale aproximadamente a <strong>{Math.floor(totals.futureDrawsPossible / 2)} semanas</strong>.
              </p>
            </div>
          </div>
        )}

        {/* ================= REPARTO ================= */}
        {activeTab === 'reparto' && (
          <div className="space-y-6 min-w-0">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div className="min-w-0">
                <h1 className="text-xl sm:text-2xl font-extrabold text-white break-words">Reparto Automático de Ganancias</h1>
                <p className="text-sm text-slate-400 break-words">Simula o ejecuta un reparto equitativo entre los {syndicate.members.length} socios. Los importes ya abonados se descuentan de la caja.</p>
              </div>
              {isAdmin && (
                <button onClick={() => setShowDistributeModal(true)} className="px-5 py-2.5 text-xs font-semibold text-slate-950 bg-amber-400 hover:bg-amber-300 rounded-xl shadow-md flex items-center gap-2 shrink-0">
                  <DollarSign className="w-4 h-4" /> Ejecutar Reparto Ahora
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6 min-w-0">
              <div className="min-w-0 overflow-hidden bg-slate-950/60 border border-slate-800 rounded-2xl p-3.5 space-y-4 sm:p-6">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm sm:text-base font-bold text-white flex items-center gap-2 min-w-0"><Trophy className="w-5 h-5 text-amber-400 shrink-0" /> <span className="break-words">Opción A: Repartir Premios ({money(totals.totalPremios)})</span></h3>
                  <span className="text-xs bg-slate-800 text-slate-400 px-2 py-0.5 rounded border border-slate-700 whitespace-nowrap">Seguir jugando</span>
                </div>
                <p className="text-xs text-slate-300">Conserva las aportaciones en caja para seguir jugando y reparte íntegramente los premios.</p>
                <div className="bg-slate-900 rounded-xl p-3.5 sm:p-4 flex flex-wrap items-center justify-between gap-3">
                  <div><div className="text-xs text-slate-400">Cada socio recibe:</div><div className="text-xl sm:text-2xl font-black text-amber-400 tabular-nums">{money(perMember(totals.totalPremios))}</div></div>
                  <div className="text-right"><div className="text-xs text-slate-400">Caja restante:</div><div className="text-base sm:text-lg font-bold text-white tabular-nums">{money(totals.totalCaja - totals.totalPremios)}</div></div>
                </div>
              </div>
              <div className="min-w-0 overflow-hidden bg-slate-950/60 border border-emerald-500/30 bg-emerald-950/10 rounded-2xl p-3.5 space-y-4 sm:p-6">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm sm:text-base font-bold text-white flex items-center gap-2 min-w-0"><Wallet className="w-5 h-5 text-emerald-400 shrink-0" /> <span className="break-words">Opción B: Liquidar la Caja ({money(totals.totalCaja)})</span></h3>
                  <span className="text-xs bg-emerald-500/20 text-emerald-300 px-2.5 py-0.5 rounded border border-emerald-500/40 font-bold whitespace-nowrap">★ Recomendada</span>
                </div>
                <p className="text-xs text-emerald-200/90 font-medium">Se liquida la caja en cervezas. Reparte todos los fondos disponibles para celebrarlo juntos y deja la caja a cero.</p>
                <div className="bg-slate-900 rounded-xl p-3.5 sm:p-4 flex flex-wrap items-center justify-between gap-3">
                  <div><div className="text-xs text-slate-400">Cada socio recibe:</div><div className="text-xl sm:text-2xl font-black text-emerald-400 tabular-nums">{money(perMember(totals.totalCaja))}</div></div>
                  <div className="text-right"><div className="text-xs text-slate-400">Caja restante:</div><div className="text-base sm:text-lg font-bold text-slate-400 tabular-nums">{money(0)}</div></div>
                </div>
              </div>
            </div>

            <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-950/60 min-w-0">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 p-3.5 sm:p-5">
                <h3 className="text-base font-bold text-white">Desglose de Reparto Equitativo por Socio</h3>
                <span className="text-xs text-slate-400">{syndicate.members.length} socios con derecho a reparto</span>
              </div>
              <div className="hidden md:block">
                <div className="w-full overflow-x-auto">
                  <table className="w-full table-auto text-left text-xs lg:text-sm">
                    <thead className="bg-slate-900/90 text-slate-400 text-xs uppercase tracking-wider border-b border-slate-800">
                      <tr>
                        <th className="px-3 lg:px-5 py-3.5">Socio</th>
                        <th className="px-3 lg:px-5 py-3.5 text-center">Cuota {monthNameFromKey(activeMonth)}</th>
                        <th className="px-3 lg:px-5 py-3.5 text-right">Histórico</th>
                        <th className="px-3 lg:px-5 py-3.5 text-right">Parte premios</th>
                        <th className="px-3 lg:px-5 py-3.5 text-right">Parte caja</th>
                        <th className="px-3 lg:px-5 py-3.5 text-right">Saldo individual</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                      {syndicate.members.map((member) => (
                        <tr key={member.id} className="hover:bg-slate-900/40">
                          <td className="px-3 lg:px-5 py-3.5 font-semibold text-white">{member.name}</td>
                          <td className="px-3 lg:px-5 py-3.5 text-center">{renderPaymentPill(member, activeMonth, true)}</td>
                          <td className="px-3 lg:px-5 py-3.5 text-right text-slate-300 tabular-nums">{money(member.totalPaid)}</td>
                          <td className="px-3 lg:px-5 py-3.5 text-right font-bold text-amber-400 tabular-nums">+{money(perMember(totals.totalPremios))}</td>
                          <td className="px-3 lg:px-5 py-3.5 text-right font-bold text-emerald-400 tabular-nums">+{money(perMember(totals.totalCaja))}</td>
                          <td className="px-3 lg:px-5 py-3.5 text-right font-bold text-white tabular-nums">{money(member.balance)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="space-y-3 p-3.5 md:hidden">
                {syndicate.members.map((member) => (
                  <div key={member.id} className="min-w-0 overflow-hidden space-y-3 rounded-xl border border-slate-800 bg-slate-900/60 p-3.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <h4 className="text-sm font-bold text-white break-words">{member.name}</h4>
                        <div className="text-[11px] text-slate-400">Cuota {monthNameFromKey(activeMonth)}</div>
                      </div>
                      {renderPaymentPill(member, activeMonth, true)}
                    </div>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                      {[
                        { label: 'Histórico', value: money(member.totalPaid), tone: 'text-slate-300' },
                        { label: 'Parte premios', value: `+${money(perMember(totals.totalPremios))}`, tone: 'text-amber-400 font-bold' },
                        { label: 'Parte caja', value: `+${money(perMember(totals.totalCaja))}`, tone: 'text-emerald-400 font-bold' },
                        { label: 'Saldo individual', value: money(member.balance), tone: 'text-white font-bold' },
                      ].map((cell) => (
                        <div key={cell.label} className="min-w-0">
                          <div className="text-[11px] text-slate-400">{cell.label}</div>
                          <div className={`font-semibold tabular-nums break-words ${cell.tone}`}>{cell.value}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {syndicate.distributions.length > 0 && (
              <div className="bg-slate-950/60 border border-slate-800 rounded-2xl p-4 space-y-3 sm:p-6">
                <h3 className="text-base font-bold text-white flex items-center gap-2"><History className="w-4 h-4 text-amber-400" /> Repartos ya ejecutados</h3>
                <div className="space-y-2">
                  {[...syndicate.distributions].reverse().map((distribution) => (
                    <div key={distribution.id} className="flex flex-wrap items-center justify-between gap-2 text-xs bg-slate-900/60 border border-slate-800 rounded-lg p-3">
                      <span className="text-slate-300">{formatDateShort(distribution.date)} · {distribution.type === 'premios' ? 'Premios' : distribution.type === 'caja' ? 'Liquidación de caja' : 'Importe personalizado'}</span>
                      <span className="font-semibold text-white">{money(distribution.amount)} ({money(distribution.perMember)} / socio)</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ================= HERRAMIENTAS FIJAS (SIN CONSULTAS LIBRES) ================= */}
        {activeTab === 'ai' && (
          <div className="space-y-6 w-full min-w-0 max-w-4xl mx-auto">
            <div className="text-center space-y-2">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs"><Sparkles className="w-3.5 h-3.5 shrink-0" /> Opciones fijas, sin consultas libres</div>
              <h1 className="text-xl sm:text-3xl font-extrabold text-white break-words">Herramientas e IA de {syndicate.name}</h1>
              <p className="text-sm text-slate-400">Opciones automáticas, música de la peña y comunicados para el grupo.</p>
            </div>

            {/* OPCIÓN DE MÚSICA DE FONDO (IA Y HERRAMIENTAS) */}
            <div className="min-w-0 overflow-hidden bg-gradient-to-br from-slate-950 via-slate-900 to-amber-950/25 border border-amber-500/30 rounded-2xl p-3.5 sm:p-6 shadow-xl space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
                <div className="flex items-start sm:items-center gap-3 min-w-0">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center border shrink-0 transition-all ${
                    isMusicPlaying
                      ? 'bg-amber-500/20 border-amber-500/40 text-amber-300 shadow-lg shadow-amber-500/20'
                      : 'bg-slate-800 border-slate-700 text-slate-400'
                  }`}>
                    <Music className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-base font-bold text-white">Música de fondo de la peña</h2>
                      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${
                        isMusicPlaying
                          ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                          : 'bg-slate-800 border-slate-700 text-slate-400'
                      }`}>
                        {isMusicPlaying ? '● En reproducción' : '○ Pausada'}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5">
                      No suena al iniciar la app. Actívala cuando quieras y sonará de fondo mientras usas la peña.
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0 self-start sm:self-center">
                  <button
                    type="button"
                    onClick={handleToggleMusic}
                    className={`px-4 py-2 text-xs font-bold rounded-xl flex items-center gap-2 shadow-md transition-all ${
                      isMusicPlaying
                        ? 'bg-rose-500/15 text-rose-300 border border-rose-500/40 hover:bg-rose-500/25'
                        : 'bg-gradient-to-r from-amber-400 to-amber-500 text-slate-950 hover:from-amber-300 hover:to-amber-400'
                    }`}
                  >
                    {isMusicPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 fill-current" />}
                    <span>{isMusicPlaying ? 'Pausar música' : 'Reproducir música'}</span>
                  </button>
                </div>
              </div>

              {/* CANCIÓN ACTUAL Y SELECTOR DEL MÓVIL */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 min-w-0">
                <div className="min-w-0 bg-slate-900/90 border border-slate-800 rounded-xl p-3.5 space-y-1.5">
                  <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Canción activa</div>
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center shrink-0 text-amber-400">
                      {isMusicPlaying ? <Volume2 className="w-4 h-4 animate-pulse" /> : <VolumeX className="w-4 h-4 text-slate-500" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-white truncate" title={currentTrack.name}>
                        {currentTrack.name}
                      </div>
                      <div className="text-[11px] text-amber-400/90">
                        {currentTrack.isCustom ? 'Canción seleccionada de tu móvil' : 'Canción oficial de la peña (por defecto)'}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="min-w-0 bg-slate-900/90 border border-slate-800 rounded-xl p-3.5 flex flex-col justify-between gap-2">
                  <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Canciones del móvil</div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => customMusicInputRef.current?.click()}
                      className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 flex items-center gap-1.5 transition-colors"
                      title="Seleccionar cualquier archivo de audio de tu teléfono"
                    >
                      <Upload className="w-3.5 h-3.5 text-amber-400" />
                      <span>Elegir canción del móvil</span>
                    </button>

                    {currentTrack.isCustom && (
                      <button
                        type="button"
                        onClick={handleRestoreDefaultMusic}
                        className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center gap-1.5 transition-colors"
                        title="Restablecer la canción por defecto de la peña"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>Restablecer por defecto</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* CONTROLES ADICIONALES: VOLUMEN Y BUCLE */}
              <div className="flex flex-wrap items-center justify-between gap-4 pt-1 text-xs">
                <div className="flex items-center gap-2.5">
                  <Volume1 className="w-4 h-4 text-slate-400" />
                  <span className="text-[11px] text-slate-400">Volumen:</span>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={musicVolume}
                    onChange={(e) => handleVolumeChange(Number(e.target.value))}
                    className="w-24 sm:w-32 accent-amber-400 cursor-pointer"
                  />
                  <span className="text-[11px] tabular-nums text-slate-400 w-8">{Math.round(musicVolume * 100)}%</span>
                </div>

                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={loopMusic}
                    onChange={(e) => setLoopMusic(e.target.checked)}
                    className="rounded border-slate-700 bg-slate-900 text-amber-500 focus:ring-0 cursor-pointer"
                  />
                  <span className="text-[11px] text-slate-300">Repetir en bucle</span>
                </label>
              </div>
            </div>
            {/* SELECTOR DE RANGO DE FECHAS PARA NÚMEROS FRECUENTES Y APUESTAS */}
            <div className="min-w-0 overflow-hidden bg-slate-950/70 border border-slate-800 rounded-2xl p-3.5 sm:p-5 space-y-4 shadow-xl">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-3">
                <div className="min-w-0">
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-amber-400 shrink-0" />
                    <span className="break-words">Rango de fechas para estadísticas de números</span>
                  </h3>
                  <p className="text-xs text-slate-400">
                    Elige el periodo para analizar qué bolas y reintegros han salido más veces en los sorteos oficiales de La Primitiva.
                  </p>
                </div>
                {officialStats && (
                  <span className="text-[11px] font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-2.5 py-1 rounded-full shrink-0 self-start sm:self-center">
                    {isLoadingStats ? 'Cargando datos...' : `${officialStats.totalDraws} sorteos analizados`}
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs min-w-0">
                <div className="min-w-0">
                  <label className="text-[11px] font-medium text-slate-300 block mb-1">Desde fecha:</label>
                  <input
                    type="date"
                    value={statsFromDate}
                    onChange={(e) => {
                      setStatsFromDate(e.target.value);
                      if (e.target.value && statsToDate) {
                        void loadOfficialStatsRange(e.target.value, statsToDate);
                      }
                    }}
                    className="w-full min-w-0 max-w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white font-medium focus:border-amber-400"
                  />
                </div>
                <div className="min-w-0">
                  <label className="text-[11px] font-medium text-slate-300 block mb-1">Hasta fecha:</label>
                  <input
                    type="date"
                    value={statsToDate}
                    onChange={(e) => {
                      setStatsToDate(e.target.value);
                      if (statsFromDate && e.target.value) {
                        void loadOfficialStatsRange(statsFromDate, e.target.value);
                      }
                    }}
                    className="w-full min-w-0 max-w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white font-medium focus:border-amber-400"
                  />
                </div>
                <div className="sm:col-span-2 flex flex-col justify-end">
                  <div className="text-[11px] font-medium text-slate-400 mb-1">Periodos rápidos:</div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        const d = new Date();
                        d.setFullYear(d.getFullYear() - 1);
                        const from = d.toISOString().slice(0, 10);
                        const to = todayISO();
                        setStatsFromDate(from);
                        setStatsToDate(to);
                        void loadOfficialStatsRange(from, to, true);
                      }}
                      className="px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 font-semibold text-[11px]"
                    >
                      Últimos 12 meses
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const d = new Date();
                        d.setMonth(d.getMonth() - 6);
                        const from = d.toISOString().slice(0, 10);
                        const to = todayISO();
                        setStatsFromDate(from);
                        setStatsToDate(to);
                        void loadOfficialStatsRange(from, to, true);
                      }}
                      className="px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 font-semibold text-[11px]"
                    >
                      Últimos 6 meses
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const from = '2026-01-01';
                        const to = todayISO();
                        setStatsFromDate(from);
                        setStatsToDate(to);
                        void loadOfficialStatsRange(from, to, true);
                      }}
                      className="px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 font-semibold text-[11px]"
                    >
                      Año 2026
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const from = '2024-01-01';
                        const to = todayISO();
                        setStatsFromDate(from);
                        setStatsToDate(to);
                        void loadOfficialStatsRange(from, to, true);
                      }}
                      className="px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 font-semibold text-[11px]"
                    >
                      Todo el histórico
                    </button>
                  </div>
                </div>
              </div>

              {/* BOLAS MÁS FRECUENTES EN EL RANGO SELECCIONADO */}
              {officialStats && officialStats.totalDraws > 0 && (
                <div className="bg-slate-900/90 rounded-xl p-4 border border-slate-800/80 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-xs font-bold text-amber-300 flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                      Top 12 números más salidos ({formatDateShort(officialStats.fromDate)} – {formatDateShort(officialStats.toDate)})
                    </div>
                    <div className="text-[11px] text-slate-400">
                      Reintegro #1: <strong className="text-emerald-400 font-bold">R{[...officialStats.reintegroCounts.entries()].sort((a,b)=>b[1]-a[1])[0]?.[0] ?? 0}</strong>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    {[...officialStats.numberCounts.entries()]
                      .sort((a, b) => b[1] - a[1] || a[0] - b[0])
                      .slice(0, 12)
                      .map(([num, count], rank) => (
                        <div key={num} className="flex flex-col items-center bg-slate-950 border border-slate-800 rounded-xl px-2 py-1.5">
                          <span className="w-8 h-8 rounded-full bg-gradient-to-b from-amber-300 to-amber-500 text-slate-950 font-black text-xs flex items-center justify-center shadow-md">
                            {String(num).padStart(2, '0')}
                          </span>
                          <span className="text-[10px] text-amber-300 font-bold mt-1 tabular-nums">
                            {count} veces
                          </span>
                          <span className="text-[9px] text-slate-500">
                            #{rank + 1}
                          </span>
                        </div>
                      ))}
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-800/80">
                    <button
                      type="button"
                      onClick={() => void handleShowFrequentNumbers()}
                      className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 flex items-center gap-1.5"
                    >
                      Copiar estadística completa (WhatsApp)
                    </button>
                    <button
                      type="button"
                      onClick={() => openBetCalculator('hot')}
                      className="px-3.5 py-1.5 text-xs font-bold text-slate-950 bg-amber-400 hover:bg-amber-300 rounded-lg shadow-md flex items-center gap-1.5"
                    >
                      <Trophy className="w-3.5 h-3.5" />
                      Calcular apuestas con estos números
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                onClick={() => void showFixedResult(buildWhatsAppMessage(), 'Comunicado de WhatsApp copiado al portapapeles.')}
                className="bg-slate-950/70 border border-slate-800 hover:border-amber-500/50 rounded-xl p-4 text-left transition-colors space-y-1"
              >
                <div className="text-sm font-semibold text-white">1. Comunicado WhatsApp</div>
                <div className="text-xs text-slate-400">Resumen de socios, caja, sorteos y premios, listo para pegar en el grupo.</div>
              </button>
              <button
                onClick={() => void showFixedResult(buildFutureDrawsMessage(), 'Proyección de sorteos copiada al portapapeles.')}
                className="bg-slate-950/70 border border-slate-800 hover:border-amber-500/50 rounded-xl p-4 text-left transition-colors space-y-1"
              >
                <div className="text-sm font-semibold text-white">2. Comunicado de futuros sorteos</div>
                <div className="text-xs text-slate-400">Fechas previstas de jueves y sábado cubiertas con la caja actual.</div>
              </button>
              <button
                onClick={() => void handleShowFrequentNumbers()}
                disabled={isLoadingStats}
                className="bg-slate-950/70 border border-slate-800 hover:border-amber-500/50 disabled:opacity-60 rounded-xl p-4 text-left transition-colors space-y-1"
              >
                <div className="text-sm font-semibold text-white">3. Números que han salido más veces</div>
                <div className="text-xs text-slate-400">
                  {isLoadingStats
                    ? 'Cargando sorteos oficiales...'
                    : officialStats
                      ? `Calculado sobre ${officialStats.totalDraws} sorteos oficiales (${formatDateShort(statsFromDate)} al ${formatDateShort(statsToDate)}).`
                      : 'Búsqueda por rango de fechas seleccionado.'}
                </div>
              </button>
              <button
                onClick={() => openBetCalculator('hot')}
                className="bg-gradient-to-br from-amber-500/10 via-slate-950 to-slate-950 border border-amber-500/40 hover:border-amber-400 rounded-xl p-4 text-left transition-all space-y-1 shadow-lg shadow-amber-500/5"
              >
                <div className="text-sm font-bold text-amber-300 flex items-center gap-1.5">
                  <Trophy className="w-4 h-4 text-amber-400" />
                  4. Calcula tu apuesta (1 a 8 apuestas)
                </div>
                <div className="text-xs text-slate-300">
                  Elige cuántas apuestas vas a hacer y calcula cada línea con los 6 números que más han salido en el periodo.
                </div>
              </button>
              <button
                onClick={() => openBetCalculator('cold')}
                disabled={isLoadingStats}
                className="bg-gradient-to-br from-sky-500/10 via-slate-950 to-slate-950 border border-sky-500/35 hover:border-sky-400 disabled:opacity-60 rounded-xl p-4 text-left transition-all space-y-1"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-bold text-sky-300">5. Estrategia de Números Fríos</span>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-sky-500/15 text-sky-300 border border-sky-500/30 shrink-0">Bolas atrasadas</span>
                </div>
                <div className="text-xs text-slate-300">
                  Calcula de 1 a 8 apuestas con los números que llevan más tiempo sin salir buscando la corrección hacia la media.
                </div>
              </button>
              <button
                onClick={() => openBetCalculator('balanced')}
                disabled={isLoadingStats}
                className="min-w-0 bg-gradient-to-br from-emerald-500/10 via-slate-950 to-slate-950 border border-emerald-500/35 hover:border-emerald-400 disabled:opacity-60 rounded-xl p-4 text-left transition-all space-y-1"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-bold text-emerald-300">6. Fórmula de Oro (3 Pares / 3 Impares)</span>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 shrink-0">+65% sorteos</span>
                </div>
                <div className="text-xs text-slate-300">
                  Genera de 1 a 8 apuestas con los números más calientes respetando el equilibrio histórico 3 pares y 3 impares.
                </div>
              </button>
              <button
                onClick={() => openReintegrosStudy()}
                disabled={isLoadingStats}
                className="min-w-0 bg-gradient-to-br from-amber-500/10 via-slate-950 to-slate-950 border border-amber-500/35 hover:border-amber-400 disabled:opacity-60 rounded-xl p-4 text-left transition-all space-y-1 sm:col-span-2"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-bold text-amber-300">7. Estudio de Reintegros y Rentabilidad</span>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30 shrink-0">Ranking 0 – 9</span>
                </div>
                <div className="text-xs text-slate-300">
                  Gráfica comparativa de reintegros en el periodo elegido para maximizar las semanas en que el boleto sale gratis.
                </div>
              </button>
              {isAdmin && (
                <button
                  onClick={() => setShowFixedQueryModal(true)}
                  className="min-w-0 bg-emerald-950/50 border border-emerald-700/50 hover:border-emerald-400 rounded-xl p-4 text-left transition-colors space-y-1 sm:col-span-2"
                >
                  <div className="text-sm font-semibold text-emerald-300">8. Añadir consulta personalizada</div>
                  <div className="text-xs text-slate-400">Añadir otra opción fija solo por el administrador. Se guarda para todos los socios.</div>
                </button>
              )}
            </div>

            {aiResponse && (
              <div className="min-w-0 overflow-hidden bg-slate-950/80 border border-slate-800 rounded-2xl p-3.5 sm:p-5 space-y-3 shadow-xl">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs font-semibold text-amber-400 flex items-center gap-1.5"><Sparkles className="w-4 h-4 shrink-0" /> Resultado (también copiado al portapapeles)</div>
                  <a
                    href={`https://wa.me/?text=${encodeURIComponent(aiResponse)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-emerald-200 bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-400/40 transition-colors"
                  >
                    <Share2 className="w-3.5 h-3.5" /> Abrir en WhatsApp
                  </a>
                </div>
                <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3.5 sm:p-4 text-sm text-slate-200 leading-relaxed whitespace-pre-line break-words [overflow-wrap:anywhere] font-sans">{aiResponse}</div>
              </div>
            )}

            <div className="min-w-0 overflow-hidden bg-slate-950/80 border border-slate-800 rounded-2xl p-3.5 sm:p-5 space-y-3 shadow-xl">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold text-white">Opciones fijas añadidas</h2>
                  <p className="text-xs text-slate-400">Creadas por el administrador y disponibles para todos los socios.</p>
                </div>
              </div>
              {syndicate.fixedQueries.length === 0 ? (
                <p className="text-xs text-slate-500">Todavía no hay opciones adicionales.</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {syndicate.fixedQueries.map((query) => (
                    <div key={query.id} className="bg-slate-900/70 border border-slate-800 rounded-xl p-3 flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0 space-y-0.5">
                        <div className="text-sm font-semibold text-white break-words">{query.title}</div>
                        {query.description && <div className="text-xs text-slate-400 break-words">{query.description}</div>}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button onClick={() => void handleRunFixedQuery(query)} className="px-2.5 py-1 text-[11px] font-semibold text-slate-950 bg-amber-400 hover:bg-amber-300 rounded-lg">Ejecutar</button>
                        {isAdmin && (
                          <button onClick={() => void handleDeleteFixedQuery(query.id)} className="px-2 py-1 text-[11px] text-rose-400 hover:text-rose-300 border border-rose-500/30 rounded-lg">Eliminar</button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* ---------- MODALES ---------- */}
      {viewingTicketDraw && (
        <Modal title={`Boleto Jugado · Sorteo #${viewingTicketDraw.index}`} subtitle={`${viewingTicketDraw.dayOfWeek} ${viewingTicketDraw.displayDate} · Importe: ${money(viewingTicketDraw.betCost)}`} icon={<ImageIcon className="w-5 h-5 text-emerald-400" />} onClose={() => setViewingTicketDraw(null)} width="max-w-2xl">
          <div className="overflow-y-auto flex-1 rounded-xl border border-slate-800 bg-slate-900/60 p-2 flex items-center justify-center min-h-[300px]">
            {viewingTicketDraw.ticketImage ? (
              <img src={viewingTicketDraw.ticketImage} alt={`Boleto sorteo #${viewingTicketDraw.index}`} className="max-w-full max-h-[60vh] object-contain rounded-lg shadow-lg" />
            ) : <div className="text-xs text-slate-400">No hay foto disponible para este boleto.</div>}
          </div>
          <div className="flex items-center justify-between text-xs text-slate-300 pt-2 border-t border-slate-800">
            <div>{viewingTicketDraw.prizeWon > 0 && <span className="text-amber-400 font-bold">¡Premio: {money(viewingTicketDraw.prizeWon)}!</span>}</div>
            <div className="flex items-center gap-2">
              {isAdmin && viewingTicketDraw.ticketImage && (
                <button onClick={() => void handleDeleteTicketPhoto(viewingTicketDraw.id)} className="px-3 py-1.5 text-xs text-red-400 hover:text-red-300 hover:bg-red-950/40 rounded-lg border border-red-500/20">Eliminar Foto</button>
              )}
              <button onClick={() => setViewingTicketDraw(null)} className="px-4 py-2 text-xs font-semibold text-white bg-slate-800 hover:bg-slate-700 rounded-xl">Cerrar</button>
            </div>
          </div>
        </Modal>
      )}

      {editingWinningDraw && (
        <Modal
          title={editingCombinationKind === 'bet' ? 'Editar Nuestras Apuestas' : 'Editar Combinación Ganadora Oficial'}
          subtitle={`Sorteo #${editingWinningDraw.index} · ${editingWinningDraw.displayDate}`}
          onClose={() => setEditingWinningDraw(null)}
        >
          <form onSubmit={handleSaveWinningNumbers} className="space-y-4">
            <p className="text-[11px] text-slate-400">
              {editingCombinationKind === 'bet'
                ? 'Cada línea del boleto es una apuesta de 1 €. Puedes editar, añadir o quitar líneas (entre 1 y 5).'
                : 'Combinación oficial publicada para esta fecha. Normalmente se recupera automáticamente a las 23:00.'}
            </p>
            {editingCombinationKind === 'bet' && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 mr-1">Apuestas:</span>
                {betLinesDraft.map((bet) => (
                  <button
                    key={bet.line}
                    type="button"
                    onClick={() => handleSwitchBetLine(bet.line)}
                    className={`w-7 h-7 rounded-lg text-xs font-bold border transition-colors ${
                      editingBetLine === bet.line
                        ? 'bg-amber-400 text-slate-950 border-amber-400'
                        : 'bg-slate-900 text-slate-300 border-slate-700 hover:bg-slate-800'
                    }`}
                  >
                    {bet.line}
                  </button>
                ))}
                {betLinesDraft.length < 5 && (
                  <button type="button" onClick={handleAddBetLine} className="w-7 h-7 rounded-lg text-sm font-bold bg-slate-900 text-emerald-400 border border-slate-700 hover:bg-slate-800" title="Añadir apuesta">+</button>
                )}
                {betLinesDraft.length > 1 && (
                  <button type="button" onClick={handleRemoveBetLine} className="w-7 h-7 rounded-lg text-sm font-bold bg-slate-900 text-rose-400 border border-slate-700 hover:bg-slate-800" title="Quitar apuesta">−</button>
                )}
              </div>
            )}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-300">{editingCombinationKind === 'bet' ? `Números de la apuesta ${editingBetLine} (1 - 49):` : 'Los 6 números (1 - 49):'}</label>
              <div className="grid grid-cols-6 gap-1.5 sm:gap-2">
                {(['n1', 'n2', 'n3', 'n4', 'n5', 'n6'] as const).map((field) => (
                  <input key={field} type="number" min="1" max="49" required value={winningForm[field]}
                    onChange={(e) => setWinningForm({ ...winningForm, [field]: Number(e.target.value) })}
                    className="w-full min-w-0 bg-slate-900 border border-slate-700 rounded-lg px-0 py-2 text-center text-white font-bold text-sm tabular-nums" />
                ))}
              </div>
            </div>
            <div className={`grid gap-3 ${editingCombinationKind === 'bet' ? 'grid-cols-1' : 'grid-cols-3'}`}>
              {editingCombinationKind === 'official' && (
                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-400">Complementario</label>
                  <input type="number" min="1" max="49" required value={winningForm.complementario} onChange={(e) => setWinningForm({ ...winningForm, complementario: Number(e.target.value) })} className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-center text-blue-400 font-bold" />
                </div>
              )}
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-400">Reintegro (0-9)</label>
                <input type="number" min="0" max="9" required value={winningForm.reintegro} onChange={(e) => setWinningForm({ ...winningForm, reintegro: Number(e.target.value) })} className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-center text-emerald-400 font-bold" />
              </div>
              {editingCombinationKind === 'official' && (
                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-400">Joker (solo si se jugó)</label>
                  <input type="text" value={winningForm.joker} onChange={(e) => setWinningForm({ ...winningForm, joker: e.target.value.replace(/\D/g, '').slice(0, 7) })} placeholder="NO (sin Joker)" className="w-full min-w-0 bg-slate-900 border border-slate-700 rounded-lg p-2 text-center text-white font-mono text-xs" />
                </div>
              )}
            </div>
            <div className="flex justify-end gap-3 pt-4 border-t border-slate-800">
              <button type="button" onClick={() => setEditingWinningDraw(null)} className="px-4 py-2 text-xs text-slate-300 bg-slate-900 hover:bg-slate-800 rounded-xl">Cancelar</button>
              <button type="submit" className="px-5 py-2 text-xs font-semibold text-slate-950 bg-amber-400 hover:bg-amber-300 rounded-xl shadow-md">{editingCombinationKind === 'bet' ? 'Guardar Apuestas' : 'Guardar Combinación'}</button>
            </div>
          </form>
        </Modal>
      )}

      {showAdminPinModal && (
        <Modal title="Acceso de Administrador" icon={<Shield className="w-5 h-5 text-amber-400" />} onClose={() => setShowAdminPinModal(false)}>
          <p className="text-xs text-slate-300 leading-relaxed">Introduce el PIN para activar el modo de gestión (registrar sorteos, pagos, repartos y boletos).</p>
          <form onSubmit={handleVerifyAdminPin} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="admin-pin" className="text-xs font-medium text-slate-400">PIN de administrador:</label>
              <input id="admin-pin" type="password" autoFocus value={adminPinInput} onChange={(e) => { setAdminPinInput(e.target.value); setAdminPinError(false); }} placeholder="Introduce tu PIN" className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2.5 text-sm text-center text-white tracking-widest focus:outline-none focus:border-amber-400" />
              {adminPinError && <div className="text-[11px] text-rose-400 font-medium">PIN incorrecto o demasiados intentos.</div>}
            </div>
            <div className="flex justify-end gap-3 pt-3 border-t border-slate-800">
              <button type="button" onClick={() => setShowAdminPinModal(false)} className="px-4 py-2 text-xs text-slate-300 bg-slate-900 hover:bg-slate-800 rounded-xl">Cancelar</button>
              <button type="submit" className="px-5 py-2 text-xs font-semibold text-slate-950 bg-amber-400 hover:bg-amber-300 rounded-xl shadow-md flex items-center gap-1.5"><Unlock className="w-3.5 h-3.5" /> Entrar como Admin</button>
            </div>
          </form>
        </Modal>
      )}

      {showNewDrawModal && canAddBets && (
        <Modal
          title={`Registrar Boleto para el Sorteo #${nextDrawIndex(syndicate.draws)}`}
          subtitle="Toma o sube una foto para lectura automática o introduce las apuestas a mano"
          onClose={() => setShowNewDrawModal(false)}
          width="max-w-xl"
        >
          <form onSubmit={handleCreateDraw} className="space-y-4">
            {/* OPCIÓN FOTO: TOMAR O AGREGAR FOTO */}
            <div className="space-y-2.5 p-3.5 bg-slate-900/80 border border-slate-700/80 rounded-2xl">
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                  <Camera className="w-4 h-4 text-amber-400" />
                  <span>Foto del Boleto (Lectura de apuestas con IA)</span>
                </div>
                {isExtractingTicket && (
                  <span className="text-[11px] text-amber-400 flex items-center gap-1 font-medium animate-pulse">
                    <Sparkles className="w-3.5 h-3.5 animate-spin" />
                    Leyendo con IA...
                  </span>
                )}
              </div>

              {/* Inputs invisibles para captura de cámara o selector de archivos */}
              <input
                ref={cameraInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={handleTicketPhotoChange}
              />
              <input
                ref={galleryInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleTicketPhotoChange}
              />

              {!newDrawTicketImage ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={() => cameraInputRef.current?.click()}
                    disabled={isExtractingTicket}
                    className="flex items-center justify-center gap-2.5 p-3 bg-gradient-to-r from-amber-500/10 to-amber-500/20 hover:from-amber-500/20 hover:to-amber-500/30 border border-amber-500/40 hover:border-amber-400 rounded-xl text-amber-300 font-medium text-xs transition-all shadow-sm active:scale-[0.98]"
                  >
                    <Camera className="w-4 h-4 text-amber-400 shrink-0" />
                    <div className="text-left">
                      <div className="font-semibold text-white">Tomar una foto</div>
                      <div className="text-[10px] text-amber-200/70">Abrir cámara del móvil</div>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => galleryInputRef.current?.click()}
                    disabled={isExtractingTicket}
                    className="flex items-center justify-center gap-2.5 p-3 bg-slate-800/80 hover:bg-slate-800 border border-slate-700 hover:border-slate-600 rounded-xl text-slate-200 font-medium text-xs transition-all shadow-sm active:scale-[0.98]"
                  >
                    <Upload className="w-4 h-4 text-sky-400 shrink-0" />
                    <div className="text-left">
                      <div className="font-semibold text-white">Agregar foto</div>
                      <div className="text-[10px] text-slate-400">Subir desde la galería o archivo</div>
                    </div>
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center justify-between p-2.5 bg-slate-950/70 border border-slate-800 rounded-xl gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <img
                        src={newDrawTicketImage}
                        alt="Foto del boleto"
                        className="w-12 h-12 object-cover rounded-lg border border-slate-700 shrink-0 cursor-pointer hover:opacity-85"
                        onClick={() => setPreviewingNewTicket(true)}
                        title="Ver imagen completa"
                      />
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-white truncate">Foto del boleto adjuntada</div>
                        <div className="text-[11px] text-slate-400">Toca la miniatura para verla en grande</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => void processTicketWithAi(newDrawTicketImage)}
                        disabled={isExtractingTicket}
                        className="px-2.5 py-1.5 bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-300 rounded-lg text-[11px] font-medium flex items-center gap-1"
                        title="Volver a leer las apuestas con IA"
                      >
                        <Sparkles className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">Releer IA</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => cameraInputRef.current?.click()}
                        className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg"
                        title="Tomar otra foto con la cámara"
                      >
                        <Camera className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => galleryInputRef.current?.click()}
                        className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg"
                        title="Elegir otra imagen de la galería"
                      >
                        <Upload className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setNewDrawTicketImage(null);
                          setExtractionStatus(null);
                        }}
                        className="p-1.5 bg-slate-800 hover:bg-red-950/80 text-slate-400 hover:text-red-400 rounded-lg"
                        title="Quitar foto"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {extractionStatus && (
                    <div
                      className={`p-2.5 rounded-xl text-xs flex items-start gap-2 border ${
                        extractionStatus.type === 'success'
                          ? 'bg-emerald-950/40 border-emerald-700/50 text-emerald-300'
                          : extractionStatus.type === 'error'
                            ? 'bg-red-950/40 border-red-700/50 text-red-300'
                            : 'bg-amber-950/40 border-amber-700/50 text-amber-300'
                      }`}
                    >
                      {extractionStatus.type === 'success' ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                      ) : (
                        <Sparkles className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                      )}
                      <span className="leading-relaxed">{extractionStatus.message}</span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* FECHA Y DÍA */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label htmlFor="draw-date" className="text-xs font-medium text-slate-300">Fecha del sorteo:</label>
                <input
                  id="draw-date"
                  type="date"
                  required
                  value={newDrawDate}
                  onChange={(e) => setNewDrawDate(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2 text-sm text-white focus:border-amber-400"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-300">Día de la semana:</label>
                <input
                  type="text"
                  readOnly
                  value={weekdayFromDate(newDrawDate)}
                  className="w-full bg-slate-900/60 border border-slate-800 rounded-xl px-3.5 py-2 text-sm text-slate-400"
                />
              </div>
            </div>

            {/* NÚMERO DE APUESTAS JUGADAS */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-slate-300">
                  Número de apuestas (1 € cada una):
                </label>
                <span className="text-xs font-bold text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-md border border-amber-500/20">
                  {newDrawNumBets} apuesta{newDrawNumBets > 1 ? 's' : ''} = {money(newDrawNumBets)}
                </span>
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => handleSetNumBets(n)}
                    className={`flex-1 min-w-[34px] py-1.5 rounded-xl text-xs font-bold transition-all border ${
                      newDrawNumBets === n
                        ? 'bg-amber-400 text-slate-950 border-amber-300 shadow-sm'
                        : 'bg-slate-900 text-slate-300 border-slate-700 hover:border-slate-600 hover:bg-slate-800'
                    }`}
                  >
                    {n}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={handleFillAllRandom}
                  className="px-2.5 py-1.5 rounded-xl text-xs font-medium text-slate-300 bg-slate-900 hover:bg-slate-800 border border-slate-700 flex items-center gap-1 shrink-0"
                  title="Rellenar todas las apuestas con números al azar"
                >
                  <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                  <span className="hidden sm:inline">Rellenar azar</span>
                </button>
              </div>
            </div>

            {/* TANTAS LÍNEAS COMO APUESTAS CON INTRODUCCIÓN MANUAL */}
            <div className="space-y-2.5">
              <div className="text-xs font-semibold text-slate-300 flex items-center justify-between">
                <span>Líneas de Apuestas (6 números del 1 al 49 por apuesta):</span>
              </div>

              {newDrawLines.map((lineItem, lineIdx) => {
                const rawNumbers = lineItem.numbers;
                const nums = rawNumbers.filter(
                  (n): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 49,
                );
                const hasDuplicates = new Set(nums).size !== nums.length;
                const isComplete = nums.length === 6 && !hasDuplicates;

                return (
                  <div
                    key={lineItem.line}
                    className={`p-2.5 sm:p-3 rounded-2xl border transition-all ${
                      hasDuplicates
                        ? 'bg-rose-950/20 border-rose-500/40'
                        : isComplete
                          ? 'bg-slate-900/90 border-slate-700 hover:border-slate-600'
                          : 'bg-slate-900/60 border-slate-800'
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5 mb-2">
                      <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
                        <span className="text-xs font-bold text-white whitespace-nowrap">Apuesta #{lineItem.line}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 font-mono shrink-0">1 €</span>
                        {isComplete ? (
                          <span className="text-[10px] text-emerald-400 flex items-center gap-0.5 font-medium whitespace-nowrap">
                            <CheckCircle2 className="w-3 h-3 shrink-0" /> Completa
                          </span>
                        ) : hasDuplicates ? (
                          <span className="text-[10px] text-rose-400 font-medium whitespace-nowrap">Repetidos</span>
                        ) : (
                          <span className="text-[10px] text-slate-500 whitespace-nowrap">{nums.length}/6</span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleFillLineRandom(lineIdx)}
                          className="text-[10px] text-amber-300/80 hover:text-amber-300 px-2 py-0.5 bg-amber-500/10 hover:bg-amber-500/20 rounded-lg border border-amber-500/20 flex items-center gap-1"
                          title="Generar 6 números al azar para esta línea"
                        >
                          <span>🎲 Azar</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleClearLine(lineIdx)}
                          className="text-[10px] text-slate-400 hover:text-red-400 px-1.5 py-0.5 hover:bg-slate-800 rounded-lg"
                          title="Borrar números de esta línea"
                        >
                          Borrar
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-6 gap-1.5 sm:gap-2">
                      {lineItem.numbers.map((numVal, numIdx) => {
                        const isDup = typeof numVal === 'number' && rawNumbers.filter((v) => v === numVal).length > 1;
                        const isFilled = typeof numVal === 'number' && numVal >= 1 && numVal <= 49;
                        return (
                          <input
                            key={numIdx}
                            id={`draw-line-${lineIdx}-num-${numIdx}`}
                            type="text"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            maxLength={2}
                            autoComplete="off"
                            placeholder="—"
                            value={numVal === '' ? '' : String(numVal)}
                            onChange={(e) => handleLineNumberChange(lineIdx, numIdx, e.target.value)}
                            onKeyDown={(e) => handleLineNumberKeyDown(e, lineIdx, numIdx)}
                            className={`h-10 sm:h-11 w-full min-w-0 px-0 text-center font-bold text-sm sm:text-base tabular-nums rounded-xl transition-all border outline-none ${
                              isDup
                                ? 'bg-rose-950/40 border-rose-500 text-rose-300 ring-1 ring-rose-500'
                                : isFilled
                                  ? 'bg-slate-950 border-amber-400/80 text-amber-300 shadow-sm'
                                  : 'bg-slate-950/60 border-slate-700/80 text-slate-400 placeholder:text-slate-600 focus:border-amber-400 focus:bg-slate-950'
                            }`}
                          />
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* REINTEGRO Y JOKER */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label htmlFor="draw-reintegro" className="text-xs font-medium text-slate-300">
                    Reintegro (R):
                  </label>
                  <span className="text-[11px] text-slate-400">Del 0 al 9</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-9 h-9 rounded-xl bg-sky-500/20 border border-sky-500/40 text-sky-300 font-bold flex items-center justify-center text-xs shrink-0">
                    R
                  </div>
                  <input
                    id="draw-reintegro"
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={1}
                    value={newDrawReintegro === '' ? '' : String(newDrawReintegro)}
                    onChange={(e) => {
                      const digits = e.target.value.replace(/\D/g, '').slice(-1);
                      setNewDrawReintegro(digits === '' ? '' : Math.max(0, Math.min(9, parseInt(digits, 10))));
                    }}
                    className="w-full min-w-0 bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white font-bold focus:border-sky-400"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="draw-joker" className="text-xs font-medium text-slate-300">
                  Joker (solo si se juega):
                </label>
                <input
                  id="draw-joker"
                  type="text"
                  inputMode="numeric"
                  maxLength={7}
                  placeholder="NO (no jugado)"
                  value={newDrawJoker}
                  onChange={(e) => setNewDrawJoker(e.target.value.replace(/\D/g, '').slice(0, 7))}
                  className="w-full min-w-0 bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white font-mono focus:border-amber-400"
                />
                <p className="text-[10px] text-slate-400">
                  Déjalo vacío si el boleto pone «JOKER: NO» (no pongas el nº de referencia).
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2.5 pt-4 border-t border-slate-800">
              <div className="text-xs font-semibold text-amber-400">
                Total: {newDrawNumBets} apuesta{newDrawNumBets > 1 ? 's' : ''} ({money(newDrawNumBets)})
              </div>
              <div className="flex items-center gap-2 ml-auto">
                <button
                  type="button"
                  onClick={() => setShowNewDrawModal(false)}
                  className="px-3.5 sm:px-4 py-2 text-xs text-slate-300 bg-slate-900 hover:bg-slate-800 rounded-xl"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isExtractingTicket}
                  className="px-4 sm:px-5 py-2 text-xs font-semibold text-slate-950 bg-amber-400 hover:bg-amber-300 rounded-xl shadow-md disabled:opacity-50"
                >
                  Guardar Boleto
                </button>
              </div>
            </div>
          </form>
        </Modal>
      )}

      {previewingNewTicket && newDrawTicketImage && (
        <Modal title="Foto del Boleto" subtitle="Vista de la captura adjuntada" onClose={() => setPreviewingNewTicket(false)}>
          <div className="flex flex-col items-center gap-3">
            <img
              src={newDrawTicketImage}
              alt="Boleto capturado"
              className="max-h-[70vh] w-auto object-contain rounded-xl border border-slate-700 shadow-2xl"
            />
            <button
              type="button"
              onClick={() => setPreviewingNewTicket(false)}
              className="px-4 py-2 bg-slate-800 text-xs text-white rounded-xl hover:bg-slate-700"
            >
              Cerrar vista previa
            </button>
          </div>
        </Modal>
      )}

      {showFeeModal && isAdmin && (
        <Modal title="Modificar Cuota Mensual" subtitle="Se aplicará a los próximos pagos que se marquen" icon={<Settings2 className="w-5 h-5 text-amber-400" />} onClose={() => setShowFeeModal(false)}>
          <form onSubmit={handleUpdateFee} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="monthly-fee" className="text-xs font-medium text-slate-300">Cuota por socio y mes (€):</label>
              <input id="monthly-fee" type="number" step="0.5" min="0.5" required value={feeInput} onChange={(e) => setFeeInput(Number(e.target.value))} className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2.5 text-sm text-white focus:border-amber-400" />
              <p className="text-[11px] text-slate-400">Por defecto son 5 €. Los cuadros ya marcados como pagados conservan el importe con el que se registraron.</p>
            </div>
            <div className="flex justify-end gap-3 pt-4 border-t border-slate-800">
              <button type="button" onClick={() => setShowFeeModal(false)} className="px-4 py-2 text-xs text-slate-300 bg-slate-900 hover:bg-slate-800 rounded-xl">Cancelar</button>
              <button type="submit" className="px-5 py-2 text-xs font-semibold text-slate-950 bg-amber-400 hover:bg-amber-300 rounded-xl shadow-md">Guardar cuota</button>
            </div>
          </form>
        </Modal>
      )}

      {showExtraModal && isAdmin && (
        <Modal title="Añadir Aportación Extra" subtitle="Para aportaciones fuera de la cuota mensual" icon={<Wallet className="w-5 h-5 text-amber-400" />} onClose={() => setShowExtraModal(false)}>
          <form onSubmit={handleAddExtra} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-300">Socio o concepto:</label>
              <input type="text" required autoFocus value={extraForm.memberOrConcept} onChange={(e) => setExtraForm({ ...extraForm, memberOrConcept: e.target.value })} placeholder="Ej: LETI" className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2.5 text-sm text-white focus:border-amber-400" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-300">Importe (€):</label>
                <input type="number" step="0.5" min="0.5" required value={extraForm.amount} onChange={(e) => setExtraForm({ ...extraForm, amount: Number(e.target.value) })} className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2.5 text-sm text-white focus:border-amber-400" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-300">Fecha:</label>
                <input type="date" required value={extraForm.date} onChange={(e) => setExtraForm({ ...extraForm, date: e.target.value })} className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2.5 text-sm text-white focus:border-amber-400" />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-300">Notas (opcional):</label>
              <input type="text" value={extraForm.notes} onChange={(e) => setExtraForm({ ...extraForm, notes: e.target.value })} placeholder="Ej: Aportación para un sorteo especial" className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2.5 text-sm text-white focus:border-amber-400" />
            </div>
            <div className="flex justify-end gap-3 pt-4 border-t border-slate-800">
              <button type="button" onClick={() => setShowExtraModal(false)} className="px-4 py-2 text-xs text-slate-300 bg-slate-900 hover:bg-slate-800 rounded-xl">Cancelar</button>
              <button type="submit" className="px-5 py-2 text-xs font-semibold text-slate-950 bg-amber-400 hover:bg-amber-300 rounded-xl shadow-md">Guardar extra</button>
            </div>
          </form>
        </Modal>
      )}

      {showMemberModal && isAdmin && (
        <Modal title="Añadir Socio" subtitle="Se creará con la cuota pendiente en el mes actual" icon={<UserPlus className="w-5 h-5 text-emerald-400" />} onClose={() => setShowMemberModal(false)}>
          <form onSubmit={handleAddMember} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="new-member-name" className="text-xs font-medium text-slate-300">Nombre del socio:</label>
              <input id="new-member-name" type="text" required autoFocus value={newMemberForm.name} onChange={(e) => setNewMemberForm({ ...newMemberForm, name: e.target.value })} placeholder="Ej: Lucía" className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2.5 text-sm text-white focus:border-amber-400" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-300">Notas (opcional):</label>
              <input type="text" value={newMemberForm.notes} onChange={(e) => setNewMemberForm({ ...newMemberForm, notes: e.target.value })} className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2.5 text-sm text-white focus:border-amber-400" />
            </div>
            <div className="flex justify-end gap-3 pt-4 border-t border-slate-800">
              <button type="button" onClick={() => setShowMemberModal(false)} className="px-4 py-2 text-xs text-slate-300 bg-slate-900 hover:bg-slate-800 rounded-xl">Cancelar</button>
              <button type="submit" className="px-5 py-2 text-xs font-semibold text-slate-950 bg-emerald-400 hover:bg-emerald-300 rounded-xl shadow-md">Añadir socio</button>
            </div>
          </form>
        </Modal>
      )}

      {showHistoryModal && selectedMemberForHistory && (() => {
        const memberPayments = getMemberPayments(selectedMemberForHistory);
        const totalAportado = roundMoney(memberPayments.reduce((acc, p) => acc + p.amount, 0));
        return (
          <Modal
            title="Historial de Pagos y Aportaciones"
            subtitle={`${selectedMemberForHistory.name} · ${memberPayments.length} pagos registrados`}
            icon={<History className="w-5 h-5 text-emerald-400" />}
            onClose={() => { setShowHistoryModal(false); setSelectedMemberForHistory(null); }}
            width="max-w-lg"
          >
            <div className="space-y-2.5 max-h-[55vh] overflow-y-auto pr-1">
              {memberPayments.length > 0 ? memberPayments.map((item) => (
                <div key={item.id} className="bg-slate-900/80 border border-slate-800 rounded-xl p-3.5 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-400 shrink-0">
                      <ArrowDownRight className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-white truncate">{item.concept}</div>
                      <div className="text-xs text-slate-400">Fecha: {formatDateShort(item.date)}</div>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-base font-extrabold text-emerald-400 tabular-nums">+{money(item.amount)}</div>
                    <div className="text-[10px] text-slate-500">{item.isHistorical ? 'Histórico arrastrado' : 'Abonado'}</div>
                  </div>
                </div>
              )) : (
                <p className="text-xs text-slate-500 italic">No hay aportaciones registradas individualmente.</p>
              )}
            </div>
            <div className="bg-slate-900/60 rounded-xl p-3.5 border border-slate-800/80 flex flex-wrap items-center justify-between gap-2 text-xs">
              <span><span className="text-slate-400">Estado en {monthNameFromKey(activeMonth)}:</span> <span className={`font-semibold ${isPaidInMonth(selectedMemberForHistory.id) ? 'text-emerald-400' : 'text-rose-400'}`}>{isPaidInMonth(selectedMemberForHistory.id) ? 'Cuota pagada' : 'Cuota pendiente'}</span></span>
              <span><span className="text-slate-400">Total aportado:</span> <strong className="text-white text-sm tabular-nums">{money(totalAportado)}</strong></span>
            </div>
            <div className="flex justify-between items-center pt-2 border-t border-slate-800">
              {isAdmin ? (
                <button onClick={() => { setExtraForm((prev) => ({ ...prev, memberOrConcept: selectedMemberForHistory.name })); setShowExtraModal(true); setShowHistoryModal(false); setSelectedMemberForHistory(null); }} className="px-3.5 py-2 text-xs font-semibold text-slate-900 bg-amber-400 hover:bg-amber-300 rounded-xl flex items-center gap-1.5"><Plus className="w-3.5 h-3.5" /> Añadir extra</button>
              ) : <div />}
              <button onClick={() => { setShowHistoryModal(false); setSelectedMemberForHistory(null); }} className="px-4 py-2 text-xs text-slate-300 bg-slate-900 hover:bg-slate-800 rounded-xl border border-slate-800">Cerrar</button>
            </div>
          </Modal>
        );
      })()}

      {showPermissionsModal && isAdmin && (
        <Modal title="Permisos y Seguridad" icon={<Shield className="w-5 h-5 text-amber-400" />} onClose={() => setShowPermissionsModal(false)}>
          <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-white">Permitir a los socios añadir apuestas</div>
                <div className="text-xs text-slate-400">Pueden registrar sorteos y subir boletos, pero no modificar cuotas ni repartos.</div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer shrink-0">
                <input type="checkbox" checked={permissions.sociosCanAddBets} onChange={(e) => void handleToggleSociosAddBets(e.target.checked)} className="sr-only peer" />
                <div className="w-11 h-6 bg-slate-800 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-500" />
              </label>
            </div>
          </div>
          <form onSubmit={handleChangeAdminPin} className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 space-y-3">
            <div className="text-sm font-semibold text-white">Cambiar PIN de administrador</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <input type="password" value={currentPinInput} onChange={(e) => setCurrentPinInput(e.target.value)} placeholder="PIN actual" className="bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white focus:border-amber-400" />
              <input type="password" value={newPinInput} onChange={(e) => setNewPinInput(e.target.value)} placeholder="Nuevo PIN (mín. 4)" className="bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white focus:border-amber-400" />
            </div>
            <p className="text-[11px] text-slate-400">Cambiar el PIN cierra todas las sesiones de administrador abiertas.</p>
            <button type="submit" className="px-4 py-2 text-xs font-semibold text-slate-950 bg-amber-400 hover:bg-amber-300 rounded-xl shadow-md">Actualizar PIN</button>
          </form>
        </Modal>
      )}

      {showDistributeModal && isAdmin && (
        <Modal title="Reparto de Fondos" subtitle={`Distribución equitativa entre ${syndicate.members.length} socios`} icon={<DollarSign className="w-5 h-5 text-amber-400" />} onClose={() => setShowDistributeModal(false)}>
          <form onSubmit={handleExecuteDistribution} className="space-y-4">
            <div className="space-y-2">
              <label className="text-xs font-medium text-slate-300">Selecciona qué deseas repartir:</label>
              <div className="space-y-2">
                {([
                  { value: 'caja', title: `Opción B: Liquidar Toda la Caja (${money(totals.totalCaja)}) — Recomendada`, detail: `${money(perMember(totals.totalCaja))} por socio. Se liquida la caja en cervezas y la caja queda a cero.`, activeClass: 'bg-emerald-950/30 border-emerald-500' },
                  { value: 'premios', title: `Opción A: Repartir Premios (${money(totals.totalPremios)})`, detail: `${money(perMember(totals.totalPremios))} por socio. Las aportaciones siguen en caja.`, activeClass: 'bg-amber-950/30 border-amber-500' },
                  { value: 'custom', title: 'Cantidad Personalizada', detail: 'Importe total a repartir (no puede superar la caja).', activeClass: 'bg-blue-950/30 border-blue-500' },
                ] as const).map((option) => (
                  <label key={option.value} className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer ${distributeType === option.value ? option.activeClass : 'bg-slate-900 border-slate-800'}`}>
                    <input type="radio" name="distType" checked={distributeType === option.value} onChange={() => setDistributeType(option.value)} className="mt-1" />
                    <div>
                      <div className="text-xs font-bold text-white">{option.title}</div>
                      <div className="text-[11px] text-slate-400">{option.detail}</div>
                      {option.value === 'custom' && distributeType === 'custom' && (
                        <div className="mt-2 space-y-1">
                          <input type="number" step="1" min="1" value={customDistributeAmount} onChange={(e) => setCustomDistributeAmount(Number(e.target.value))} className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-white text-xs" placeholder="Importe total a repartir" />
                          <div className="text-[11px] text-slate-400">Equivale a <strong>{money(perMember(Number(customDistributeAmount) || 0))}</strong> por socio.</div>
                        </div>
                      )}
                    </div>
                  </label>
                ))}
              </div>
            </div>
            <div className="flex justify-end gap-3 pt-4 border-t border-slate-800">
              <button type="button" onClick={() => setShowDistributeModal(false)} className="px-4 py-2 text-xs text-slate-300 bg-slate-900 hover:bg-slate-800 rounded-xl">Cancelar</button>
              <button type="submit" className="px-5 py-2 text-xs font-semibold text-slate-950 bg-amber-400 hover:bg-amber-300 rounded-xl shadow-md">Confirmar Reparto</button>
            </div>
          </form>
        </Modal>
      )}

      {showCalculateBetModal && (() => {
        const strategyMeta = {
          hot: {
            title: 'Calcula tu Apuesta (Más Frecuentes)',
            description: 'Cada apuesta selecciona estrictamente los 6 números que más veces han salido en el periodo elegido.',
            ballClass: 'from-amber-300 to-amber-500 text-slate-950',
            accentText: 'text-amber-300',
          },
          cold: {
            title: 'Estrategia de Números Fríos (Atrasados)',
            description: 'Cada apuesta selecciona las 6 bolas que menos han salido en el periodo buscando la corrección hacia la media.',
            ballClass: 'from-sky-300 to-sky-500 text-slate-950',
            accentText: 'text-sky-300',
          },
          balanced: {
            title: 'Fórmula de Oro (3 Pares / 3 Impares)',
            description: 'Combina los números más frecuentes manteniendo exactamente 3 pares y 3 impares por línea (+65% de sorteos históricos).',
            ballClass: 'from-emerald-300 to-emerald-500 text-slate-950',
            accentText: 'text-emerald-300',
          },
        }[calcBetStrategy];
        const { lines, reintegro } = computeBetsByStrategy(officialStats, calcBetCount, calcBetStrategy);

        return (
          <Modal
            title={strategyMeta.title}
            subtitle={`Rango: ${formatDateShort(statsFromDate)} al ${formatDateShort(statsToDate)}${officialStats ? ` · ${officialStats.totalDraws} sorteos` : ''}`}
            icon={<Trophy className="w-5 h-5 text-amber-400" />}
            onClose={() => setShowCalculateBetModal(false)}
            width="max-w-xl"
          >
            <div className="space-y-4">
              {/* SELECTOR DE ESTRATEGIA */}
              <div className="grid grid-cols-3 gap-1.5 bg-slate-950 p-1 rounded-xl border border-slate-800">
                {([
                  { id: 'hot', label: 'Más salidos', active: 'bg-amber-400 text-slate-950' },
                  { id: 'cold', label: 'Números fríos', active: 'bg-sky-400 text-slate-950' },
                  { id: 'balanced', label: '3 Pares / 3 Imp.', active: 'bg-emerald-400 text-slate-950' },
                ] as const).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setCalcBetStrategy(tab.id)}
                    className={`py-2 px-2 rounded-lg text-xs font-bold transition-all ${
                      calcBetStrategy === tab.id ? tab.active : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3.5 space-y-2">
                <label className="text-xs font-semibold text-slate-200 block">
                  ¿Cuántas apuestas vas a hacer en este boleto?
                </label>
                <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                  {[1, 2, 3, 4, 5, 6, 7, 8].map((count) => (
                    <button
                      key={count}
                      type="button"
                      onClick={() => setCalcBetCount(count)}
                      className={`flex-1 min-w-[36px] py-2 rounded-xl text-xs font-bold border transition-all ${
                        calcBetCount === count
                          ? 'bg-amber-400 text-slate-950 border-amber-300 shadow-lg shadow-amber-400/20 scale-105'
                          : 'bg-slate-950 text-slate-300 border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      {count} {count === 5 ? '★' : ''}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-slate-400">{strategyMeta.description}</p>
              </div>

              <div className="space-y-3">
                <div className="space-y-2.5 max-h-[42vh] overflow-y-auto pr-1">
                  {lines.map((l) => (
                    <div key={l.line} className="bg-slate-900/80 border border-slate-800 rounded-xl p-3 space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className={`font-bold ${strategyMeta.accentText}`}>Apuesta #{l.line}</span>
                        <span className="text-[11px] text-slate-400">
                          {calcBetStrategy === 'balanced' ? '3 Pares · 3 Impares · ' : ''}1.00 €
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {l.numbers.map((num) => (
                          <div key={num} className="flex flex-col items-center">
                            <span className={`w-8 h-8 rounded-full bg-gradient-to-b ${strategyMeta.ballClass} font-black text-xs flex items-center justify-center shadow-md`}>
                              {String(num).padStart(2, '0')}
                            </span>
                            <span className="text-[10px] text-slate-400 mt-0.5 tabular-nums">
                              {officialStats?.numberCounts.get(num) ?? 0}v{calcBetStrategy === 'balanced' ? (num % 2 === 0 ? ' · P' : ' · I') : ''}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-3 flex items-center justify-between text-xs">
                  <div>
                    <div className="text-slate-400">Reintegro sugerido (el más repetido):</div>
                    <div className="font-extrabold text-emerald-400 text-sm mt-0.5">
                      R{reintegro}{' '}
                      <span className="text-[11px] font-normal text-slate-400">
                        ({officialStats?.reintegroCounts.get(reintegro) ?? 0} apariciones)
                      </span>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-slate-400">Coste total del boleto:</div>
                    <div className="font-extrabold text-white text-base mt-0.5">{money(lines.length)}</div>
                  </div>
                </div>

                <div className="flex flex-wrap justify-between items-center gap-2 pt-2 border-t border-slate-800">
                  <button
                    type="button"
                    onClick={() => void handleShowCalculatedBets(calcBetCount, calcBetStrategy)}
                    className="px-3.5 py-2 text-xs font-semibold rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 flex items-center gap-1.5"
                  >
                    Copiar apuestas
                  </button>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setShowCalculateBetModal(false)}
                      className="px-3.5 py-2 text-xs text-slate-300 bg-slate-900 hover:bg-slate-800 rounded-xl border border-slate-800"
                    >
                      Cerrar
                    </button>
                    {canAddBets && (
                      <button
                        type="button"
                        onClick={() => {
                          setShowCalculateBetModal(false);
                          openNewDrawModal(lines);
                        }}
                        className="px-4 py-2 text-xs font-bold text-slate-950 bg-amber-400 hover:bg-amber-300 rounded-xl shadow-md flex items-center gap-1.5"
                      >
                        <Plus className="w-3.5 h-3.5" /> Usar en nuevo boleto
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </Modal>
        );
      })()}

      {showReintegrosModal && (() => {
        const total = officialStats?.totalDraws || 0;
        const ranking = Array.from({ length: 10 }, (_, r) => ({
          reintegro: r,
          count: officialStats?.reintegroCounts.get(r) ?? 0,
        })).sort((a, b) => b.count - a.count || a.reintegro - b.reintegro);
        const maxCount = Math.max(1, ranking[0]?.count ?? 1);
        const topReintegro = ranking[0];

        return (
          <Modal
            title="Estudio de Reintegros y Rentabilidad"
            subtitle={`Periodo: ${formatDateShort(statsFromDate)} al ${formatDateShort(statsToDate)} · ${total} sorteos`}
            icon={<Sparkles className="w-5 h-5 text-amber-400" />}
            onClose={() => setShowReintegrosModal(false)}
            width="max-w-lg"
          >
            <div className="space-y-4">
              {topReintegro && total > 0 && (
                <div className="bg-emerald-950/30 border border-emerald-500/40 rounded-xl p-3.5 flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-emerald-300">Reintegro más rentable</div>
                    <div className="text-xs text-slate-300 mt-0.5">
                      Ha salido <strong className="text-white">{topReintegro.count} veces</strong> ({((topReintegro.count / total) * 100).toFixed(1)}% de sorteos).
                    </div>
                  </div>
                  <div className="w-12 h-12 rounded-2xl bg-gradient-to-b from-emerald-400 to-emerald-600 text-slate-950 font-black text-xl flex items-center justify-center shadow-lg shrink-0">
                    R{topReintegro.reintegro}
                  </div>
                </div>
              )}

              <div className="space-y-2 max-h-[45vh] overflow-y-auto pr-1">
                {ranking.map((item, idx) => {
                  const pct = total > 0 ? (item.count / total) * 100 : 0;
                  const barWidth = Math.max(4, Math.round((item.count / maxCount) * 100));
                  return (
                    <div key={item.reintegro} className="bg-slate-900/80 border border-slate-800 rounded-xl p-2.5 flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-lg font-black text-xs flex items-center justify-center shrink-0 ${
                        idx === 0 ? 'bg-amber-400 text-slate-950' : idx <= 2 ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'bg-slate-800 text-slate-300'
                      }`}>
                        R{item.reintegro}
                      </div>
                      <div className="flex-1 min-w-0 space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-semibold text-white">#{idx + 1} · Reintegro {item.reintegro}</span>
                          <span className="tabular-nums text-slate-300 font-bold">{item.count} veces <span className="text-slate-400 font-normal">({pct.toFixed(1)}%)</span></span>
                        </div>
                        <div className="w-full h-2 bg-slate-950 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${idx === 0 ? 'bg-amber-400' : idx <= 2 ? 'bg-emerald-400' : 'bg-slate-600'}`}
                            style={{ width: `${barWidth}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <p className="text-[11px] text-slate-400 leading-relaxed">
                Acertar el reintegro devuelve el 100% del importe jugado en el boleto (1 € por cada apuesta). Elegir el reintegro con mayor frecuencia ayuda a recuperar más semanas el coste del boleto.
              </p>

              <div className="flex flex-wrap justify-between items-center gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => void handleShowReintegrosReport()}
                  className="px-3.5 py-2 text-xs font-semibold rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 shadow-md flex items-center gap-1.5"
                >
                  Copiar informe (WhatsApp)
                </button>
                <button
                  type="button"
                  onClick={() => setShowReintegrosModal(false)}
                  className="px-4 py-2 text-xs text-slate-300 bg-slate-900 hover:bg-slate-800 rounded-xl border border-slate-800"
                >
                  Cerrar
                </button>
              </div>
            </div>
          </Modal>
        );
      })()}

      {showFixedQueryModal && isAdmin && (
        <Modal title="Añadir consulta fija" subtitle="Solo el administrador puede crear nuevas opciones" icon={<Sparkles className="w-5 h-5 text-amber-400" />} onClose={() => setShowFixedQueryModal(false)}>
          <form onSubmit={(event) => void handleAddFixedQuery(event)} className="space-y-4">
            <label className="block space-y-1">
              <span className="text-xs font-medium text-slate-300">Título del botón</span>
              <input
                required
                maxLength={80}
                value={fixedQueryForm.title}
                onChange={(event) => setFixedQueryForm((prev) => ({ ...prev, title: event.target.value }))}
                placeholder="Ej. Comunicado de cumpleaños"
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white focus:border-amber-400"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-slate-300">Descripción (opcional)</span>
              <input
                maxLength={120}
                value={fixedQueryForm.description}
                onChange={(event) => setFixedQueryForm((prev) => ({ ...prev, description: event.target.value }))}
                placeholder="Qué hace esta opción"
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white focus:border-amber-400"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-slate-300">Texto que se mostrará y copiará</span>
              <textarea
                required
                rows={5}
                value={fixedQueryForm.result}
                onChange={(event) => setFixedQueryForm((prev) => ({ ...prev, result: event.target.value }))}
                placeholder="Escribe aquí el comunicado o información fija"
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white focus:border-amber-400"
              />
            </label>
            <div className="flex justify-end gap-3 pt-4 border-t border-slate-800">
              <button type="button" onClick={() => setShowFixedQueryModal(false)} className="px-4 py-2 text-xs text-slate-300 bg-slate-900 hover:bg-slate-800 rounded-xl">Cancelar</button>
              <button type="submit" className="px-5 py-2 text-xs font-semibold text-slate-950 bg-amber-400 hover:bg-amber-300 rounded-xl shadow-md">Guardar opción fija</button>
            </div>
          </form>
        </Modal>
      )}

      {isMusicPlaying && (
        <aside aria-label="Reproductor de música" className="fixed bottom-4 right-4 z-40 max-w-[calc(100vw-2rem)] flex items-center gap-2.5 px-3.5 py-2 rounded-xl bg-slate-900/95 border border-amber-500/40 shadow-2xl backdrop-blur text-xs text-amber-100 animate-fadeIn">
          <div className="w-6 h-6 rounded-lg bg-amber-500/20 flex items-center justify-center shrink-0 text-amber-400">
            <Volume2 className="w-3.5 h-3.5 animate-pulse" />
          </div>
          <div className="min-w-0 max-w-[150px] sm:max-w-[200px]">
            <div className="text-[11px] font-semibold text-white truncate" title={currentTrack.name}>{currentTrack.name}</div>
            <div className="text-[10px] text-amber-300/80">Sonando de fondo</div>
          </div>
          <button
            type="button"
            onClick={handleToggleMusic}
            className="px-2.5 py-1 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/30 rounded-lg font-semibold text-[11px] shrink-0 transition-colors"
          >
            Pausar
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('ai')}
            className="text-slate-400 hover:text-white text-[11px] underline shrink-0"
            title="Ir a las opciones de música en IA"
          >
            Ajustes
          </button>
        </aside>
      )}

      <PwaInstallPrompt />

      <footer className="mt-auto border-t border-slate-800/80 bg-slate-950/60 px-4 py-3 text-center text-[11px] text-slate-600">
        <span className="font-medium text-slate-500">@Miguel Marín</span>
      </footer>

      <ToastStack toasts={toasts} onRemove={removeToast} />
    </div>
  );
}
