import { useEffect, useRef, useState } from 'react';
import { Download, Share2, Smartphone, X } from 'lucide-react';
import { SYNDICATE_APP_NAME } from '../data/initialSyndicateData';

/** Evento no estándar de Chrome para instalar la PWA con un solo toque. */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

declare global {
  interface WindowEventMap {
    beforeinstallprompt: BeforeInstallPromptEvent;
  }
}

interface NavigatorWithInstallApps extends Navigator {
  getInstalledRelatedApps?: () => Promise<Array<{ id: string; platform: string }>>;
  standalone?: boolean;
}

type InstallFlag = { status: 'done' } | { status: 'later'; at: number };

const STORAGE_KEY = 'primitiva_pwa_setup_v1';
const POSTPONE_MS = 7 * 24 * 60 * 60 * 1000;

function readFlag(): InstallFlag | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as InstallFlag;
    if (parsed?.status === 'done') return parsed;
    if (parsed?.status === 'later' && Number.isFinite(parsed.at)) return parsed;
  } catch {
    // Almacenamiento bloqueado o dato corrupto: se vuelve a preguntar.
  }
  return null;
}

function saveFlag(flag: InstallFlag): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(flag));
  } catch {
    // Sin almacenamiento el aviso puede repetirse, pero la app sigue funcionando.
  }
}

function isRunningAsShortcut(): boolean {
  const nav = navigator as NavigatorWithInstallApps;
  return window.matchMedia('(display-mode: standalone)').matches || nav.standalone === true;
}

/**
 * En la primera apertura comprueba si ya se usa como acceso directo y, si no,
 * ofrece instalarlo. Los navegadores móviles exigen confirmación del usuario:
 * no se puede crear un icono en pantalla de forma silenciosa.
 */
export function PwaInstallPrompt() {
  const deferredPrompt = useRef<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);
  const [canInstall, setCanInstall] = useState(false);

  useEffect(() => {
    let active = true;

    if (isRunningAsShortcut()) {
      saveFlag({ status: 'done' });
      return;
    }

    const flag = readFlag();
    if (flag?.status === 'done') return;
    if (flag?.status === 'later' && Date.now() - flag.at < POSTPONE_MS) return;

    const onBeforeInstallPrompt = (event: BeforeInstallPromptEvent) => {
      event.preventDefault();
      if (!active) return;
      deferredPrompt.current = event;
      setCanInstall(true);
      setVisible(true);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);

    const nav = navigator as NavigatorWithInstallApps;
    if (typeof nav.getInstalledRelatedApps === 'function') {
      void nav.getInstalledRelatedApps()
        .then((apps) => {
          if (!active) return;
          if (apps.length > 0) {
            saveFlag({ status: 'done' });
            setVisible(false);
            return;
          }
          setVisible(true);
        })
        .catch(() => {
          if (active) setVisible(true);
        });
    } else {
      setVisible(true);
    }

    return () => {
      active = false;
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    };
  }, []);

  const dismiss = (flag: InstallFlag) => {
    saveFlag(flag);
    deferredPrompt.current = null;
    setVisible(false);
  };

  const install = async () => {
    const event = deferredPrompt.current;
    if (!event) return;
    try {
      await event.prompt();
      const choice = await event.userChoice;
      dismiss(choice.outcome === 'accepted' ? { status: 'done' } : { status: 'later', at: Date.now() });
    } catch {
      setCanInstall(false);
    }
  };

  if (!visible) return null;

  const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  return (
    <aside
      role="dialog"
      aria-label="Añadir aplicación a la pantalla de inicio"
      className="fixed bottom-4 left-4 right-4 sm:bottom-6 sm:left-auto sm:right-6 z-50 max-w-sm rounded-2xl border-2 border-amber-400/80 bg-gradient-to-br from-slate-950 via-emerald-950/90 to-slate-950 p-4 shadow-[0_12px_45px_rgba(251,191,36,0.3)] ring-2 ring-amber-400/25 backdrop-blur-md animate-toast"
    >
      <div className="flex items-start gap-3">
        <div className="w-11 h-11 shrink-0 rounded-xl bg-gradient-to-br from-amber-300 via-amber-400 to-emerald-400 flex items-center justify-center shadow-lg shadow-amber-500/30 text-slate-950">
          <Smartphone className="w-6 h-6 stroke-[2.2]" />
        </div>
        <div className="min-w-0 flex-1 space-y-2.5">
          <div className="flex items-start justify-between gap-2">
            <div className="space-y-1">
              <span className="inline-block rounded-md bg-amber-400/20 border border-amber-300/50 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-amber-300">
                Instalar aplicación
              </span>
              <h2 className="text-base font-extrabold text-white leading-tight">Añade {SYNDICATE_APP_NAME}</h2>
            </div>
            <button
              onClick={() => dismiss({ status: 'later', at: Date.now() })}
              className="shrink-0 rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
              aria-label="Cerrar aviso"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <p className="text-xs leading-relaxed text-slate-200">
            Instálala en tu pantalla de inicio para abrirla al instante y a pantalla completa, como una app nativa.
          </p>
          {isIos ? (
            <div className="rounded-xl border-2 border-amber-400/60 bg-amber-400/15 p-3 text-xs leading-relaxed text-amber-50 shadow-inner">
              En iPhone/iPad: pulsa{' '}
              <span className="inline-flex items-center gap-1 rounded bg-amber-300 px-1.5 py-0.5 font-bold text-slate-950">
                <Share2 className="w-3.5 h-3.5" /> Compartir
              </span>{' '}
              y elige{' '}
              <strong className="text-amber-300 underline decoration-amber-400/70 underline-offset-2">
                Añadir a pantalla de inicio
              </strong>.
            </div>
          ) : canInstall ? (
            <button
              onClick={() => void install()}
              className="w-full flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-amber-300 via-amber-400 to-emerald-400 px-4 py-3 text-sm font-extrabold text-slate-950 shadow-xl shadow-amber-500/35 ring-2 ring-amber-200/80 hover:brightness-110 active:scale-[0.98] transition-all cursor-pointer"
            >
              <Download className="w-5 h-5 stroke-[2.5] animate-bounce" />
              <span>Instalar app ahora</span>
            </button>
          ) : (
            <div className="rounded-xl border-2 border-amber-400/60 bg-amber-400/15 p-3 text-xs leading-relaxed text-amber-50">
              Abre el menú de tu navegador y pulsa{' '}
              <strong className="text-amber-300 underline decoration-amber-400/70 underline-offset-2">
                Instalar aplicación
              </strong>{' '}
              o <strong className="text-amber-300">Añadir a pantalla de inicio</strong>.
            </div>
          )}
          <div className="flex items-center justify-between pt-0.5">
            <button
              onClick={() => dismiss({ status: 'done' })}
              className="text-[11px] font-semibold text-emerald-300 hover:text-emerald-200 hover:underline"
            >
              Ya tengo el acceso directo
            </button>
            <button
              onClick={() => dismiss({ status: 'later', at: Date.now() })}
              className="text-[11px] text-slate-400 hover:text-slate-200"
            >
              Más tarde
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}
