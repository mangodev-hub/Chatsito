import type { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () =>
      import('./features/character-select/character-select.page').then((m) => m.CharacterSelectPage),
  },
  {
    path: 'room/:code',
    loadComponent: () => import('./features/chat-room/chat-room.page').then((m) => m.ChatRoomPage),
  },
  { path: '**', redirectTo: '' },
];
