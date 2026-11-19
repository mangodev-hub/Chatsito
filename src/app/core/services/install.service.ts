import { Injectable, computed, signal } from '@angular/core';

/** Evento de Chrome para instalar la PWA (no está en los tipos de TypeScript). */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export type InstallResult = 'installed' | 'dismissed' | 'manual';

/**
 * Instalar la app desde un botón propio. Chrome avisa con `beforeinstallprompt` cuando la app es
 * instalable; se guarda ese aviso desde el arranque para lanzarlo al tocar el botón.
 */
@Injectable({ providedIn: 'root' })
export class InstallService {
  private deferred: BeforeInstallPromptEvent | null = null;
  private readonly canPrompt = signal(false);
  private readonly installed = signal(this.isStandalone());

  /** Mostrar el botón mientras la app no se esté usando ya instalada. */
  readonly available = computed(() => !this.installed());
  /** Chrome puede abrir su diálogo de instalación directamente. */
  readonly native = this.canPrompt.asReadonly();

  constructor() {
    window.addEventListener('beforeinstallprompt', (event) => {
      event.preventDefault();
      this.deferred = event as BeforeInstallPromptEvent;
      this.canPrompt.set(true);
    });
    window.addEventListener('appinstalled', () => {
      this.deferred = null;
      this.canPrompt.set(false);
      this.installed.set(true);
    });
    matchMedia('(display-mode: standalone)').addEventListener('change', () => this.installed.set(this.isStandalone()));
  }

  /** Abre el diálogo de Chrome; si no está disponible, toca mostrar los pasos manuales. */
  async install(): Promise<InstallResult> {
    const event = this.deferred;
    if (!event) return 'manual';
    this.deferred = null;
    this.canPrompt.set(false);
    await event.prompt();
    const { outcome } = await event.userChoice;
    return outcome === 'accepted' ? 'installed' : 'dismissed';
  }

  private isStandalone(): boolean {
    return (
      matchMedia('(display-mode: standalone)').matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true
    );
  }
}
