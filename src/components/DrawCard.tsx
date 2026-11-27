import { Camera, Edit2, ImageIcon, Trash2 } from 'lucide-react';
import type { DrawRecord } from '../data/initialSyndicateData';
import { drawBetLines, money } from '../lib/finance';
import { CombinationComparison } from './ui';

interface DrawCardProps {
  draw: DrawRecord;
  compact?: boolean;
  canUploadTicket: boolean;
  isAdmin: boolean;
  canDelete: boolean;
  onViewTicket: () => void;
  onUploadTicket: () => void;
  onEditCombination: (kind: 'bet' | 'official', line?: number) => void;
  onDelete: () => void;
}

/** Misma tarjeta para el resumen y para la vista completa de sorteos. */
export function DrawCard({
  draw, compact = false, canUploadTicket, isAdmin, canDelete,
  onViewTicket, onUploadTicket, onEditCombination, onDelete,
}: DrawCardProps) {
  return (
    <div
      className={`${draw.prizeWon > 0 ? 'border-amber-500/40 bg-amber-950/10' : 'border-slate-800 bg-slate-900/60 hover:border-slate-700'} ${compact ? 'p-4 rounded-xl' : 'p-5 rounded-2xl'} border transition-colors flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3`}
    >
      <div className="space-y-2 flex-1 min-w-0 w-full">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-mono font-bold text-slate-400">#{draw.index}</span>
          <span className="font-semibold text-white">{draw.dayOfWeek} · {draw.displayDate}</span>
          <span className="text-slate-400">· {drawBetLines(draw).length} apuestas × 1 € = {money(draw.betCost)}</span>
          {draw.prizeWon > 0 && (
            <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-400 font-bold border border-amber-500/30">
              +{money(draw.prizeWon)}
            </span>
          )}
          {draw.status === 'pendiente' && (
            <span className="px-2 py-0.5 rounded bg-slate-700/60 text-slate-300 border border-slate-600">Pendiente</span>
          )}
          {draw.createdBy === 'socio' && (
            <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">Apuesta de socio</span>
          )}
        </div>

        <div className="flex flex-wrap items-start gap-3 pt-0.5">
          <CombinationComparison
            bets={drawBetLines(draw)}
            official={draw.officialCombination}
            jokerPlayed={draw.jokerPlayed}
            large={!compact}
          />
          {isAdmin && (
            <div className="flex gap-1 shrink-0">
              <button
                onClick={() => onEditCombination('bet', 1)}
                className="p-1 text-slate-400 hover:text-amber-400 hover:bg-slate-800 rounded transition-colors"
                title="Editar nuestras apuestas"
                aria-label="Editar nuestras apuestas"
              >
                <Edit2 className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => onEditCombination('official')}
                className="p-1 text-slate-400 hover:text-sky-400 hover:bg-slate-800 rounded transition-colors"
                title="Editar la combinación oficial"
                aria-label="Editar la combinación oficial"
              >
                <Edit2 className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>

        {draw.notes && <div className="text-xs text-slate-400">{draw.notes}</div>}
      </div>

      <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
        {draw.ticketImage ? (
          <button onClick={onViewTicket} className="px-2.5 py-1.5 text-xs font-medium text-emerald-300 bg-emerald-950/80 hover:bg-emerald-900 border border-emerald-700/60 rounded-lg transition-colors flex items-center gap-1.5">
            <ImageIcon className="w-3.5 h-3.5 text-emerald-400" />
            <span>{compact ? 'Ver Boleto' : 'Ver Foto del Boleto'}</span>
          </button>
        ) : canUploadTicket ? (
          <button onClick={onUploadTicket} className="px-2.5 py-1.5 text-xs font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg transition-colors flex items-center gap-1.5">
            <Camera className="w-3.5 h-3.5 text-amber-400" />
            <span>Subir Boleto</span>
          </button>
        ) : (
          <span className="text-xs text-slate-500 italic">Sin foto de boleto</span>
        )}
        {canDelete && (
          <button
            onClick={onDelete}
            className="p-2 text-slate-400 hover:text-red-400 hover:bg-slate-800 rounded-xl transition-colors"
            title="Eliminar apuesta añadida por error"
            aria-label="Eliminar apuesta"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
}
