import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { AlertController } from '@ionic/angular';

import { InstallService } from '../../core/services/install.service';

/** Botón "Instalar app". Se oculta solo cuando la app ya se abre instalada. */
@Component({
  selector: 'app-install-button',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (installer.available()) {
      <button
        type="button"
        [class]="compact() ? 'icon-btn install-icon' : 'install-pill'"
        [attr.aria-label]="compact() ? 'Instalar app' : null"
        [title]="'Instalar Day & Night en tu teléfono'"
        (click)="install()"
      >
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path
            d="M12 4v10m0 0-4-4m4 4 4-4M5 17v2a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2"
            fill="none"
            stroke="currentColor"
            stroke-width="2.2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
        @if (!compact()) {
          <span>Instalar app</span>
        }
      </button>
    }
  `,
  styles: `
    :host {
      display: contents;
    }

    .install-pill {
      appearance: none;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 7px 16px;
      border: var(--sketch);
      border-radius: 999px;
      background: var(--bg-accent-warm);
      color: var(--on-accent);
      box-shadow: var(--shadow-hard);
      font: 800 14px var(--font-body);
      cursor: pointer;
      -webkit-tap-highlight-color: transparent;
      transition:
        transform 120ms ease,
        box-shadow 120ms ease;

      &:active {
        transform: translateY(2px);
        box-shadow: 0 1px 0 var(--border-sketch);
      }
    }

    .install-icon {
      width: 40px;
      height: 40px;
      color: var(--ink-primary);
    }
  `,
})
export class InstallButtonComponent {
  /** Solo el ícono (para la barra de la sala). */
  readonly compact = input(false);

  protected readonly installer = inject(InstallService);
  private readonly alerts = inject(AlertController);

  protected async install(): Promise<void> {
    const result = await this.installer.install();
    if (result !== 'manual') return;
    // Chrome aún no ofreció su diálogo (o ya se descartó): pasos a mano.
    const alert = await this.alerts.create({
      header: 'Instalar Day & Night',
      message:
        'En Chrome toca el menú ⋮ (arriba a la derecha) y elige «Instalar app» o «Agregar a la pantalla principal».',
      cssClass: 'alert-sketch',
      buttons: ['Entendido'],
    });
    await alert.present();
  }
}
