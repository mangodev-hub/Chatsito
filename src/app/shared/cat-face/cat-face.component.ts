import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import type { CatType, Reaction } from '../../core/models/chat.models';

interface Palette {
  fur: string;
  line: string;
  ear: string;
  feature: string;
}

const PALETTE: Readonly<Record<CatType, Palette>> = {
  white_cat: { fur: '#fffdf9', line: '#3b2e2a', ear: '#ffc9d3', feature: '#3b2e2a' },
  black_cat: { fur: '#3d3a46', line: '#1e1c2a', ear: '#e9a3b3', feature: '#faf3e3' },
};

/** Carita de gatito (Nube o Mango) con una expresión. SVG en línea: nítida a cualquier tamaño. */
@Component({
  selector: 'app-cat-face',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg viewBox="0 0 48 48" [attr.width]="size()" [attr.height]="size()" aria-hidden="true">
      <!-- orejas -->
      <path
        d="M8.5 22 L11 5.5 L22 14 Z"
        [attr.fill]="p().fur"
        [attr.stroke]="p().line"
        stroke-width="1.8"
        stroke-linejoin="round"
      />
      <path
        d="M39.5 22 L37 5.5 L26 14 Z"
        [attr.fill]="p().fur"
        [attr.stroke]="p().line"
        stroke-width="1.8"
        stroke-linejoin="round"
      />
      <path d="M12.3 16 L13 9.5 L17.6 13.2 Z" [attr.fill]="p().ear" />
      <path d="M35.7 16 L35 9.5 L30.4 13.2 Z" [attr.fill]="p().ear" />
      <!-- cabeza -->
      <ellipse
        cx="24"
        cy="27.5"
        rx="17.5"
        ry="14.5"
        [attr.fill]="p().fur"
        [attr.stroke]="p().line"
        stroke-width="1.8"
      />
      <!-- mejillas -->
      @if (reaction() !== 'sad') {
        <ellipse
          cx="12.5"
          cy="31.5"
          rx="3.2"
          ry="1.9"
          [attr.fill]="reaction() === 'angry' ? '#ff7a7a' : '#ffb7c5'"
          opacity="0.85"
        />
        <ellipse
          cx="35.5"
          cy="31.5"
          rx="3.2"
          ry="1.9"
          [attr.fill]="reaction() === 'angry' ? '#ff7a7a' : '#ffb7c5'"
          opacity="0.85"
        />
      }

      @switch (reaction()) {
        @case ('love') {
          <path d="M17 29.5 l-3.6 -3.6 a2.1 2.1 0 0 1 3.6 -2.4 a2.1 2.1 0 0 1 3.6 2.4 Z" fill="#ef5f78" />
          <path d="M31 29.5 l-3.6 -3.6 a2.1 2.1 0 0 1 3.6 -2.4 a2.1 2.1 0 0 1 3.6 2.4 Z" fill="#ef5f78" />
          <path
            d="M20 33 q2 2.6 4 0 q2 2.6 4 0"
            fill="none"
            [attr.stroke]="p().feature"
            stroke-width="1.6"
            stroke-linecap="round"
          />
        }
        @case ('laugh') {
          <path
            d="M14 27.5 l3 -3.2 l3 3.2"
            fill="none"
            [attr.stroke]="p().feature"
            stroke-width="1.9"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
          <path
            d="M28 27.5 l3 -3.2 l3 3.2"
            fill="none"
            [attr.stroke]="p().feature"
            stroke-width="1.9"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
          <path
            d="M19 31.2 h10 q0 6.3 -5 6.3 q-5 0 -5 -6.3 Z"
            fill="#e8798a"
            [attr.stroke]="p().feature"
            stroke-width="1.5"
            stroke-linejoin="round"
          />
          <path d="M9.5 24 q-1.6 2.4 0 3.4 q1.6 -1 0 -3.4 Z" fill="#8ec5ff" />
          <path d="M38.5 24 q-1.6 2.4 0 3.4 q1.6 -1 0 -3.4 Z" fill="#8ec5ff" />
        }
        @case ('happy') {
          <circle cx="17" cy="26.5" r="2.4" [attr.fill]="p().feature" />
          <circle cx="31" cy="26.5" r="2.4" [attr.fill]="p().feature" />
          <circle cx="17.8" cy="25.6" r="0.8" [attr.fill]="p().fur" />
          <circle cx="31.8" cy="25.6" r="0.8" [attr.fill]="p().fur" />
          <path
            d="M20 32.4 q2 2.6 4 0 q2 2.6 4 0"
            fill="none"
            [attr.stroke]="p().feature"
            stroke-width="1.6"
            stroke-linecap="round"
          />
        }
        @case ('wow') {
          <circle cx="17" cy="26" r="3.4" [attr.fill]="p().fur" [attr.stroke]="p().feature" stroke-width="1.6" />
          <circle cx="31" cy="26" r="3.4" [attr.fill]="p().fur" [attr.stroke]="p().feature" stroke-width="1.6" />
          <circle cx="17" cy="26.3" r="1.6" [attr.fill]="p().feature" />
          <circle cx="31" cy="26.3" r="1.6" [attr.fill]="p().feature" />
          <ellipse cx="24" cy="34.2" rx="2" ry="2.6" [attr.fill]="p().feature" />
          <path
            d="M5 13 l2.5 1.2 M4 18 l2.8 0 M43 13 l-2.5 1.2 M44 18 l-2.8 0"
            [attr.stroke]="p().line"
            stroke-width="1.5"
            stroke-linecap="round"
          />
        }
        @case ('sad') {
          <path
            d="M13.5 22.5 l5.5 -1.6 M34.5 22.5 l-5.5 -1.6"
            [attr.stroke]="p().feature"
            stroke-width="1.6"
            stroke-linecap="round"
          />
          <circle cx="17" cy="27" r="2.2" [attr.fill]="p().feature" />
          <circle cx="31" cy="27" r="2.2" [attr.fill]="p().feature" />
          <path d="M15.6 29.6 q-1.8 3 0 4.4 q1.8 -1.4 0 -4.4 Z" fill="#8ec5ff" />
          <path
            d="M20.5 35 q3.5 -3 7 0"
            fill="none"
            [attr.stroke]="p().feature"
            stroke-width="1.6"
            stroke-linecap="round"
          />
        }
        @case ('angry') {
          <path
            d="M13 22.5 l6.2 2.4 M35 22.5 l-6.2 2.4"
            [attr.stroke]="p().feature"
            stroke-width="1.9"
            stroke-linecap="round"
          />
          <path d="M14.6 26.6 a2.5 2.5 0 0 0 5 0 Z" [attr.fill]="p().feature" />
          <path d="M28.4 26.6 a2.5 2.5 0 0 0 5 0 Z" [attr.fill]="p().feature" />
          <path
            d="M20.5 34.6 q3.5 -2.6 7 0"
            fill="none"
            [attr.stroke]="p().feature"
            stroke-width="1.7"
            stroke-linecap="round"
          />
          <path
            d="M37.5 8.5 l1.2 2.8 M42.5 9.5 l-2.8 1.6 M41.5 4.5 l-1.6 2.8 M36 5 l2.4 2"
            stroke="#ef5f78"
            stroke-width="1.6"
            stroke-linecap="round"
          />
        }
      }
    </svg>
  `,
  styles: `
    :host {
      display: inline-grid;
      place-items: center;
      line-height: 0;
    }
  `,
})
export class CatFaceComponent {
  readonly type = input.required<CatType>();
  readonly reaction = input.required<Reaction>();
  readonly size = input(28);

  protected readonly p = computed(() => PALETTE[this.type()]);
}
