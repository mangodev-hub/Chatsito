import { Component, inject } from '@angular/core';
import { SwUpdate, type VersionReadyEvent } from '@angular/service-worker';
import { IonApp, IonRouterOutlet, ToastController } from '@ionic/angular';
import { filter } from 'rxjs';

import { SoundService } from './core/services/sound.service';

const UPDATE_CHECK_MS = 30 * 60 * 1000;

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  imports: [IonApp, IonRouterOutlet],
})
export class AppComponent {
  private readonly updates = inject(SwUpdate);
  private readonly toasts = inject(ToastController);
  /** Se crea al arrancar para que cualquier toque (también en la pantalla de inicio) active el audio. */
  protected readonly sound = inject(SoundService);

  constructor() {
    if (!this.updates.isEnabled) return;
    // App instalada: avisa cuando hay una versión nueva publicada en Firebase.
    this.updates.versionUpdates
      .pipe(filter((e): e is VersionReadyEvent => e.type === 'VERSION_READY'))
      .subscribe(() => void this.offerUpdate());
    setInterval(() => void this.updates.checkForUpdate().catch(() => undefined), UPDATE_CHECK_MS);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void this.updates.checkForUpdate().catch(() => undefined);
    });
  }

  private async offerUpdate(): Promise<void> {
    const toast = await this.toasts.create({
      message: 'Hay una versión nueva de Day & Night ✨',
      position: 'top',
      cssClass: 'toast-sketch',
      buttons: [
        {
          text: 'Actualizar',
          handler: () => {
            void this.updates.activateUpdate().then(() => document.location.reload());
          },
        },
      ],
    });
    await toast.present();
  }
}
