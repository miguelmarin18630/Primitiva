import type { ReactNode } from 'react';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import type { BetLine, WinningCombination } from '../data/initialSyndicateData';

interface ModalProps {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  width?: string;
}

/** Carcasa única para todos los diálogos: evita repetir overlay, cierre y estilos. */
export function Modal({ title, subtitle, icon, onClose, children, width = 'max-w-md' }: ModalProps) {
  return (
    <div
      className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-2.5 sm:p-4 z-50 animate-fadeIn"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`bg-slate-950 border border-slate-800 rounded-2xl ${width} w-full p-4 sm:p-6 space-y-4 sm:space-y-5 shadow-2xl max-h-[92vh] max-h-[92dvh] overflow-y-auto`}
      >
        <div className="flex justify-between items-start gap-4">
          <div className="space-y-1">
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              {icon}
              {title}
            </h3>
            {subtitle && <p className="text-xs text-slate-400">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 shrink-0" aria-label="Cerrar">
            <X className="w-5 h-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

type Tone = 'emerald' | 'blue' | 'amber' | 'rose' | 'slate';

const toneIcon: Record<Tone, string> = {
  emerald: 'bg-emerald-500/10 text-emerald-400',
  blue: 'bg-blue-500/10 text-blue-400',
  amber: 'bg-amber-500/10 text-amber-400',
  rose: 'bg-rose-500/10 text-rose-400',
  slate: 'bg-slate-500/10 text-slate-400',
};

interface StatCardProps {
  label: string;
  value: string;
  hint: string;
  icon: ReactNode;
  tone?: Tone;
  highlighted?: boolean;
}

export function StatCard({ label, value, hint, icon, tone = 'slate', highlighted = false }: StatCardProps) {
  return (
    <div
      className={`min-w-0 overflow-hidden ${highlighted ? 'bg-gradient-to-br from-emerald-950/80 via-slate-950 to-slate-950 border-2 border-emerald-500/40 shadow-lg' : 'bg-slate-950/70 border border-slate-800 shadow-sm'} rounded-2xl p-3 sm:p-5 transition-colors hover:border-slate-600`}
    >
      <div className={`flex items-center justify-between gap-1.5 text-[11px] sm:text-xs mb-1.5 sm:mb-2 font-medium ${highlighted ? 'text-emerald-400 font-bold uppercase tracking-wider' : 'text-slate-400'}`}>
        <span className="min-w-0 break-words leading-tight">{label}</span>
        <div className={`w-6 h-6 sm:w-7 sm:h-7 shrink-0 rounded-lg flex items-center justify-center ${toneIcon[tone]}`}>{icon}</div>
      </div>
      <div className={`text-lg sm:text-2xl font-extrabold tabular-nums break-words ${highlighted ? 'text-emerald-400' : tone === 'amber' ? 'text-amber-400' : tone === 'emerald' ? 'text-emerald-400' : 'text-white'}`}>
        {value}
      </div>
      <div className={`text-[10px] sm:text-[11px] mt-1 sm:mt-1.5 font-medium break-words leading-snug ${highlighted ? 'text-emerald-300' : tone === 'slate' ? 'text-slate-400' : toneIcon[tone].split(' ')[1]}`}>
        {hint}
      </div>
    </div>
  );
}

interface CombinationBallsProps {
  combination: WinningCombination;
  large?: boolean;
  /** Combinación contraria: sus valores iguales se resaltan en verde. */
  compareWith?: WinningCombination;
  tone?: 'bet' | 'official';
  showJoker?: boolean;
}

export function CombinationBalls({ combination, large = false, compareWith, tone = 'bet', showJoker = true }: CombinationBallsProps) {
  const size = large ? 'w-7 h-7 text-xs' : 'w-6 h-6 text-xs';
  const matchedNumbers = new Set(compareWith?.numbers ?? []);
  const match = (matched: boolean, base: string) =>
    matched ? `${base} ring-2 ring-emerald-300 bg-emerald-500/25 border-emerald-300 text-white` : base;
  const mainBase = tone === 'bet'
    ? 'bg-slate-800 border border-amber-500/40 text-amber-300'
    : 'bg-slate-800 border border-sky-500/40 text-sky-300';

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {combination.numbers.map((number, index) => (
        <span
          key={index}
          className={`${size} rounded-full flex items-center justify-center font-bold shadow-sm ${match(matchedNumbers.has(number), mainBase)}`}
          title={matchedNumbers.has(number) ? `${number}: coincide con la combinación contraria` : String(number)}
        >
          {number}
        </span>
      ))}
      <span
        className={`${size} rounded-full bg-blue-950 border border-blue-500/40 text-blue-300 flex items-center justify-center font-bold shadow-sm ${match(compareWith?.complementario === combination.complementario, '')}`}
        title="Complementario"
      >
        C{combination.complementario}
      </span>
      <span
        className={`${size} rounded-full bg-emerald-950 border border-emerald-500/40 text-emerald-300 flex items-center justify-center font-bold shadow-sm ${match(compareWith?.reintegro === combination.reintegro, '')}`}
        title="Reintegro"
      >
        R{combination.reintegro}
      </span>
      {showJoker && combination.joker && (
        <span className={`px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-mono text-xs border border-slate-700 ml-1 ${compareWith?.joker === combination.joker ? 'ring-2 ring-emerald-300 text-white' : ''}`}>
          Joker: {combination.joker}
        </span>
      )}
    </div>
  );
}

/** Muestra todas las apuestas jugadas (una por línea del boleto) frente a la oficial. */
export function CombinationComparison({ bets, official, jokerPlayed, large = false }: {
  bets: BetLine[];
  official?: WinningCombination;
  jokerPlayed?: boolean;
  large?: boolean;
}) {
  const size = large ? 'w-7 h-7 text-xs' : 'w-6 h-6 text-xs';
  const matchedNumbers = new Set(official?.numbers ?? []);
  const allOurs: WinningCombination | undefined = bets.length
    ? { numbers: [...new Set(bets.flatMap((bet) => bet.numbers))], complementario: 0, reintegro: 0 }
    : undefined;
  const uniqueReintegros = [...new Set(bets.map((bet) => bet.reintegro).filter((r): r is number => r !== undefined))];
  const sharedReintegro = uniqueReintegros.length === 1 ? uniqueReintegros[0] : undefined;
  const jokerNotPlayed = jokerPlayed !== true;

  return (
    <div className="space-y-1.5 min-w-0 w-full">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
        Nuestras apuestas {bets.length > 0 && `(${bets.length} × 1 €)`}
      </div>
      {bets.length > 0 ? (
        <div className="space-y-1.5">
          {bets.map((bet) => {
            const aciertos = bet.numbers.filter((number) => matchedNumbers.has(number)).length;
            return (
              <div key={bet.line} className="flex flex-wrap items-center gap-1.5">
                <span className="w-5 shrink-0 font-mono text-[11px] font-bold text-amber-400">{bet.line}.</span>
                {bet.numbers.map((number) => (
                  <span
                    key={number}
                    className={`${size} rounded-full flex items-center justify-center font-bold shadow-sm border ${
                      matchedNumbers.has(number)
                        ? 'ring-2 ring-emerald-300 bg-emerald-500/25 border-emerald-300 text-white'
                        : 'bg-slate-800 border-amber-500/40 text-amber-300'
                    }`}
                    title={matchedNumbers.has(number) ? `${number}: coincide con la oficial` : String(number)}
                  >
                    {number}
                  </span>
                ))}
                {sharedReintegro === undefined && bet.reintegro !== undefined && (
                  <span
                    className={`${size} rounded-full bg-emerald-950 border border-emerald-500/40 text-emerald-300 flex items-center justify-center font-bold ${
                      official?.reintegro === bet.reintegro ? 'ring-2 ring-emerald-300 text-white' : ''
                    }`}
                    title="Reintegro"
                  >
                    R{bet.reintegro}
                  </span>
                )}
                {official && (
                  <span className={`text-[10px] ml-0.5 ${aciertos >= 4 ? 'text-emerald-300 font-bold' : 'text-slate-500'}`}>
                    {aciertos} aciertos
                  </span>
                )}
              </div>
            );
          })}
          {(sharedReintegro !== undefined || jokerNotPlayed) && (
            <div className="flex flex-wrap items-center gap-2 pt-0.5">
              {sharedReintegro !== undefined && (
                <span
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-950 border border-emerald-500/40 text-emerald-300 ${
                    official?.reintegro === sharedReintegro ? 'ring-2 ring-emerald-300 text-white' : ''
                  }`}
                  title={official?.reintegro === sharedReintegro ? 'Reintegro premiado (coincide con el oficial)' : 'Reintegro del boleto'}
                >
                  Reintegro: {sharedReintegro}
                </span>
              )}
              {jokerNotPlayed && (
                <span className="inline-flex items-center px-2 py-0.5 rounded bg-slate-800/90 text-slate-300 font-mono text-[11px] border border-slate-700">
                  Joker: NO
                </span>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] text-slate-500 italic">No guardamos los números jugados en este sorteo.</span>
          {jokerNotPlayed && (
            <span className="inline-flex items-center px-2 py-0.5 rounded bg-slate-800/90 text-slate-300 font-mono text-[11px] border border-slate-700">
              Joker: NO
            </span>
          )}
        </div>
      )}
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 pt-0.5">Ganadora oficial</div>
      {official ? (
        <CombinationBalls combination={official} compareWith={allOurs} large={large} tone="official" showJoker={jokerPlayed === true} />
      ) : (
        <span className="text-[11px] text-slate-500 italic">Pendiente de celebración / publicación (se recupera a las 23:00).</span>
      )}
    </div>
  );
}

export interface Toast {
  id: string;
  type: 'success' | 'error' | 'info';
  title?: string;
  message: string;
}

export function ToastStack({ toasts, onRemove }: { toasts: Toast[]; onRemove: (id: string) => void }) {
  const border: Record<Toast['type'], string> = {
    success: 'border-emerald-500/40 shadow-emerald-500/10',
    error: 'border-rose-500/40 shadow-rose-500/10',
    info: 'border-amber-500/40 shadow-amber-500/10',
  };
  return (
    <div aria-live="polite" className="fixed bottom-4 left-4 right-4 sm:bottom-6 sm:left-auto sm:right-6 z-50 flex flex-col gap-2.5 max-w-sm pointer-events-none">
      {toasts.map((toast) => (
        <div key={toast.id} className={`pointer-events-auto flex items-start gap-3 p-4 rounded-2xl border shadow-2xl backdrop-blur-md bg-slate-950/95 text-slate-100 animate-toast ${border[toast.type]}`}>
          <div className="shrink-0 mt-0.5">
            {toast.type === 'success' && <CheckCircle2 className="w-5 h-5 text-emerald-400" />}
            {toast.type === 'error' && <AlertCircle className="w-5 h-5 text-rose-400" />}
            {toast.type === 'info' && <Info className="w-5 h-5 text-amber-400" />}
          </div>
          <div className="flex-1 min-w-0">
            {toast.title && <div className="text-xs font-bold text-white mb-0.5">{toast.title}</div>}
            <div className="text-xs text-slate-300 leading-relaxed">{toast.message}</div>
          </div>
          <button onClick={() => onRemove(toast.id)} className="shrink-0 text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800" title="Cerrar notificación">
            <X className="w-4 h-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
