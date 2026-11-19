# 🌗 Day & Night Sync

Chat en tiempo real con gatitos que reaccionan a tus mensajes. Elige a **Nube** (el gatito blanco del día 🌼) o a **Mango** (el gatito negro de la noche 🔔), comparte un código de sala y conversen frente a frente o en manada.

🔗 **Pruébalo:** [day-night-chat.web.app](https://day-night-chat.web.app)

---

## ✨ Funcionalidades

### Dos formas de chatear
- **1 a 1:** una sala para dos personas, con un balcón donde los dos gatitos se miran.
- **Manada:** una sala de grupo para hasta **15 gatitos**. Cada persona elige a Nube o a Mango y recibe un **color de collar** que la identifica en el chat.

### En el chat
- **Gatitos animados (Lottie):** respiran, escriben, saltan, se duermen cuando te vas y reaccionan según el tono del mensaje.
- **Modo Eclipse:** en el 1 a 1, si Nube y Mango están juntos, el fondo hace un degradado día/noche (tipo atardecer) que se inclina hacia quien habló último.
- **Mensajes secretos:** el texto queda tapado por una nubecita y se revela manteniéndolo presionado.
- **Reacciones con caritas de gatito:** mantén presionado un mensaje para reaccionar. Con doble toque posas tu gatito encima.
- **Detección de emoción:** los mensajes de amor, alegría o urgencia muestran un icono y hacen reaccionar al gatito.
- **Llamado de atención:** sacude la pantalla y hace vibrar el teléfono de tu compañero (en la Manada, el de todos).
- **"Escribiendo…" en vivo**, con detector de velocidad (WPM): si escribes rápido, tu gatito teclea más rápido.
- **Visto:** "visto" en el 1 a 1 y "visto por N" en la Manada.
- **Piedra, papel o tijera** en el 1 a 1: cada jugada viaja sellada y se revela solo cuando los dos eligieron.
- **Sonidos propios** del collar de cada gatito (margarita y cascabel), que se pueden silenciar.

### En la Manada
- Repisa con los mini gatitos de todos: en línea, dormidos 💤 o escribiendo.
- Cada burbuja muestra el nombre y el mini gatito de quien escribe, en su color de collar.
- Botón para salir del grupo (los mensajes se conservan).

### En el menú
- **Tus chats:** la lista de tus salas, con opción de ocultar un chat o borrar un 1 a 1.
- Unirse pegando el código o el enlace completo de la sala.
- **App instalable (PWA)** en el teléfono o la compu.
- Si cambias de teléfono, tu compañero puede liberar tu lugar para que vuelvas a entrar con el código.

---

## 🛠️ Tecnologías

| Parte | Herramienta |
|---|---|
| Interfaz | [Angular 22](https://angular.dev) (signals, standalone) + [Ionic 9](https://ionicframework.com) |
| Móvil | [Capacitor 8](https://capacitorjs.com) (vibración háptica) |
| Backend | [Supabase](https://supabase.com): Postgres, Auth anónima, Realtime (Presence, Broadcast y Postgres Changes) y RLS |
| Animaciones | [Lottie](https://airbnb.io/lottie) con `ngx-lottie` y Angular Animations |
| Hosting | [Firebase Hosting](https://firebase.google.com/products/hosting) + Service Worker (PWA) |
| Pruebas | Vitest (unitarias) y Playwright (e2e) |

---

## 📁 Estructura del proyecto

```
src/app/
├── core/
│   ├── models/          # Tipos, gatitos (CAT_META), colores de collar, reacciones
│   └── services/        # Supabase, sesión, chat en tiempo real, sonido, piedra-papel-tijera
├── features/
│   ├── character-select/    # Menú principal: elegir gatito, 1 a 1 / Manada, tus chats
│   └── chat-room/           # Sala de chat
│       └── components/
│           ├── cat-stage/       # Balcón de los dos gatitos (1 a 1)
│           ├── group-stage/     # Repisa de gatitos (Manada)
│           ├── message-bubble/  # Burbujas, secretos y reacciones
│           ├── chat-input/      # Campo de texto, modo secreto y llamado
│           └── rps-bar/         # Piedra, papel o tijera
├── shared/              # Botón de instalar, caritas de gatito
└── theme/variables.scss # Colores día / noche
supabase/migrations/     # Cambios de la base de datos, en orden
```

---

## 🚀 Cómo correrlo en tu compu

### Requisitos
- [Node.js](https://nodejs.org) (versión LTS reciente)
- [Ionic CLI](https://ionicframework.com/docs/cli) (opcional): `npm install -g @ionic/cli`

### Pasos

```bash
git clone https://github.com/mangodev-hub/Chatsito.git
cd Chatsito
npm install
ionic serve        # o: npm start
```

Se abre en `http://localhost:8100`.

- **Para probar en el celular** (conectado al mismo WiFi): `ionic serve --external` y abre la dirección que aparece.
- **Para probar con dos gatitos:** usa una ventana normal y otra en incógnito.

---

## 🗄️ Base de datos (Supabase)

La conexión está en `src/environments/environment.ts`. La clave que aparece ahí es la **publicable**: es segura en el cliente porque los datos están protegidos con RLS.

Si vas a usar tu propio proyecto de Supabase:

1. Activa **Allow anonymous sign-ins** en *Authentication → Sign In / Providers*.
2. Corre las migraciones de `supabase/migrations/` **en orden** (por fecha en el nombre) en el *SQL Editor*.
3. Cambia `supabaseUrl` y `supabaseKey` en `src/environments/environment.ts` y `environment.prod.ts`.

---

## 📦 Publicar

```bash
npm run build
firebase deploy --only hosting
```

El build se genera en la carpeta `www/`, que es la que publica Firebase Hosting.

---

## 🧪 Scripts útiles

| Comando | Para qué sirve |
|---|---|
| `npm start` | Servidor de desarrollo |
| `npm run build` | Build de producción |
| `npm run lint` | ESLint + Prettier |
| `npm run test:unit` | Pruebas unitarias |
| `npm run test:e2e` | Pruebas end-to-end con Playwright |

---

## 👩‍💻👨‍💻 Autores

- **Amy Díaz**: [@Amy-Mishell06](https://github.com/Amy-Mishell06)
- **Carlos Puente**

Hecho con 🌼, 🔔 y muchos michis.
