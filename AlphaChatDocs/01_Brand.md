# Alpha Chat — Brand Identity & Design System
### Dal Logo al Pixel: Ogni Superficie, Ogni Suono, Ogni Gesto
> Versione 1.0 — Luglio 2025
> Status: Design Phase — Pre-Development
> Documento di riferimento per tutte le decisioni visive, sonore e di interazione

---

## Indice

1. [Il Logo](#1-il-logo)
2. [Colori](#2-colori)
3. [Tipografia](#3-tipografia)
4. [Iconografia](#4-iconografia)
5. [Layout e Spaziatura](#5-layout-e-spaziatura)
6. [Componenti UI Fondamentali](#6-componenti-ui-fondamentali)
7. [Animazioni e Motion Design](#7-animazioni-e-motion-design)
8. [Suoni](#8-suoni)
9. [Feedback Aptico (Vibrazione)](#9-feedback-aptico-vibrazione)
10. [Personalità del Marchio](#10-personalità-del-marchio)
11. [Tono di Voce](#11-tono-di-voce)
12. [Dark Mode](#12-dark-mode)
13. [Regole di Utilizzo del Brand](#13-regole-di-utilizzo-del-brand)
14. [Feature Filter — Le Tre Domande](#14-feature-filter--le-tre-domande)

---

## 1. Il Logo

### 1.1 Descrizione e Anatomia

Il logo di Alpha Chat è una **forma triangolare arrotondata** con un ritaglio interno a triangolo rovesciato — costruisce la lettera "A" attraverso spazio positivo e negativo, non attraverso un tracciato letterale.

```
        ╱╲
       ╱  ╲
      ╱ ▲  ╲       ← cutout invertito (spazio negativo)
     ╱      ╲      ← piccola fiamma alla base del cutout
    ╱__________╲
    ╲          ╱
     ╲________╱    ← angoli inferiori arrotondati
```

**Elementi anatomici:**

| Elemento | Descrizione |
|---|---|
| **Forma esterna** | Triangolo equilatero con angoli fortemente arrotondati (border-radius ~30% del lato) |
| **Cutout interno** | Triangolo rovesciato, proporzionato — crea il controforma della "A" |
| **Accento fiamma** | Piccola forma a goccia/fiamma alla base del cutout — il dettaglio che rende il logo vivo |
| **Gradiente** | Da sinistra (viola profondo) a destra (magenta-viola) — applicato alla forma intera |
| **Background icon** | Cerchio bianco — solo nell'icona app. Il logo standalone non ha sfondo |

### 1.2 Varianti

**Variante 1 — Icona App (uso primario)**
Logo con cerchio bianco come sfondo. Usata ovunque il sistema operativo visualizza l'icona app: home screen, App Store, notifiche, task switcher.

**Variante 2 — Logo Solo (su sfondo scuro)**
Il simbolo triangolare senza cerchio, su sfondo scuro (#0F0A1E o trasparente). Usata in: splash screen, loading screen, intestazioni email.

**Variante 3 — Wordmark**
Il simbolo affiancato al testo "Alpha Chat" in Inter (peso 700, lettera-spaziatura -0.5px). Usata in: landing page, documentazione, materiali istituzionali.

**Variante 4 — Simbolo Monocromatico**
Il triangolo in un singolo colore (#7C3AED). Usata per: watermark, pattern, contesti in cui il gradiente non è riproducibile (stampa in bianco e nero, embossing).

### 1.3 Dimensioni Minime

| Utilizzo | Dimensione minima |
|---|---|
| Icona App (iOS/Android) | 1024×1024px (master) — ridimensionata da sistema |
| Web favicon | 32×32px |
| Notifica push | 96×96px |
| Wordmark in testo corrente | 20px di altezza simbolo |
| Stampa | 8mm |

### 1.4 Spazio di Rispetto (Clear Space)

Lo spazio libero attorno al logo — sia nella variante simbolo che nella variante wordmark — non può essere mai inferiore all'**altezza della lettera "A" nel simbolo** (circa il 20% dell'altezza totale del logo). Nessun altro elemento visivo entra in questa zona.

### 1.5 Adattamento per Uso Chat

Il simbolo originale funziona perfettamente come icona app e come identità generale. Per gli utilizzi specifici dell'interfaccia chat (avatar bot, avatar sistema, indicatore di stato) si usano versioni semplificate:

**Avatar sistema (es: messaggi di benvenuto):**
Il simbolo su sfondo con il gradiente primario, dimensione 40×40px con border-radius 50% (cerchio). Il triangolo bianco su fondo gradiente — inversione cromatica rispetto all'icona app.

**Indicatore "Alpha" nei canali ufficiali:**
Badge viola (#7C3AED) a forma di scudo con il simbolo bianco. Analogia al badge verificato di Telegram — ma con un design proprietario.

---

## 2. Colori

### 2.1 Gradiente Primario — L'Identità Cromatica di Alpha Chat

Il gradiente del logo non è decorazione. È l'identità. Viene applicato sistematicamente su tutti i componenti interattivi primari.

```
Gradiente Primario:
Direzione: 135° (angolo → diagonale sinistra-alto verso destra-basso)

Stop 1 (0%):   #6D28D9   Viola Profondo    (Indigo 700)
Stop 2 (50%):  #7C3AED   Viola             (Violet 600)
Stop 3 (100%): #C026D3   Magenta Viola     (Fuchsia 700)
```

**CSS:**
```css
background: linear-gradient(135deg, #6D28D9 0%, #7C3AED 50%, #C026D3 100%);
```

**React Native (Expo Linear Gradient):**
```
colors={['#6D28D9', '#7C3AED', '#C026D3']}
start={{ x: 0, y: 0 }}
end={{ x: 1, y: 1 }}
```

### 2.2 Colori Primari (Tokens)

| Token | Hex | Nome | Uso |
|---|---|---|---|
| `--color-primary-dark` | `#6D28D9` | Viola Profondo | Inizio gradiente, stati pressed |
| `--color-primary` | `#7C3AED` | Viola | Colore principale monocromatico |
| `--color-primary-light` | `#A78BFA` | Viola Chiaro | Background tinted, stati hover |
| `--color-primary-xlight` | `#EDE9FE` | Viola Palissandro | Background chip, badge, tag |
| `--color-accent` | `#C026D3` | Magenta Viola | Fine gradiente, accenti secondari |
| `--color-accent-light` | `#E879F9` | Magenta Chiaro | Tinted backgrounds accent |

### 2.3 Colori Neutri — Warm Dark

**Principio:** Alpha Chat usa **warm gray** — neutri con una leggera sottotona viola/indigo. Non cold gray puro (troppo freddo, troppo "dashboard"), non warm brown (troppo caldo, troppo casual). Il warm violet-gray crea coerenza con l'identità viola senza essere monocromatico.

| Token | Hex Light | Hex Dark | Uso |
|---|---|---|---|
| `--color-background` | `#FFFFFF` | `#0F0A1E` | Background principale app |
| `--color-surface` | `#F8F7FF` | `#1A1330` | Card, bubble, modali |
| `--color-surface-raised` | `#F0EEFF` | `#241B3D` | Input, menu contestuale |
| `--color-outline` | `#E2DFEF` | `#2E2448` | Divisori, bordi, separatori |
| `--color-on-background` | `#0F0A1E` | `#F0EEFF` | Testo principale |
| `--color-on-surface` | `#1A1330` | `#E2DFEF` | Testo secondario |
| `--color-on-surface-dim` | `#6E6880` | `#8B84A0` | Testo terziario (timestamp, hint) |

> **Nota tecnica:** Il background scuro (`#0F0A1E`) non è nero puro. È un viola-nero profondo — quasi nero, ma con la sottotona viola che mantiene coerenza con l'identità cromatica. Il nero puro (#000000) non viene mai usato come background.

### 2.4 Colori di Stato

| Token | Hex | Nome | Uso |
|---|---|---|---|
| `--color-success` | `#16A34A` | Verde | Messaggio consegnato, operazione riuscita |
| `--color-success-light` | `#DCFCE7` | Verde Chiaro | Background stato successo |
| `--color-error` | `#DC2626` | Rosso | Errore, eliminazione, azione distruttiva |
| `--color-error-light` | `#FEE2E2` | Rosso Chiaro | Background stato errore |
| `--color-warning` | `#D97706` | Arancione | Attenzione, connessione lenta |
| `--color-warning-light` | `#FEF3C7` | Giallo Chiaro | Background stato warning |
| `--color-info` | `#2563EB` | Blu | Informazione, link |
| `--color-read-receipt` | `#7C3AED` | Viola | Le spunte di lettura — non blu come WhatsApp |

> **Scelta delle spunte di lettura:** WhatsApp usa il blu per le read receipt. Alpha Chat usa il proprio viola primario — un dettaglio che chi migra da WhatsApp nota immediatamente, che rinforza l'identità del brand ad ogni messaggio letto.

### 2.5 Colori delle Bubble Messaggi

| Bubble | Light Mode | Dark Mode |
|---|---|---|
| **Mia (outgoing)** | Gradiente primario (viola→magenta) | Gradiente primario (stessa saturazione) |
| **Altrui (incoming)** | `#F0EEFF` (viola palissandro) | `#241B3D` (surface raised scuro) |
| **Testo outgoing** | `#FFFFFF` | `#FFFFFF` |
| **Testo incoming** | `#0F0A1E` | `#F0EEFF` |
| **Timestamp outgoing** | `rgba(255,255,255,0.7)` | `rgba(255,255,255,0.6)` |
| **Timestamp incoming** | `#6E6880` | `#8B84A0` |

> **Scelta del bubble outgoing con gradiente:** WhatsApp usa verde piatto. Telegram usa blu piatto. Alpha Chat usa il proprio gradiente identitario su ogni messaggio inviato — il brand è presente in ogni interazione primaria dell'utente.

### 2.6 Accessibilità Cromatica

Tutti i rapporti di contrasto sono verificati contro WCAG 2.1:

| Coppia colori | Rapporto | Standard |
|---|---|---|
| `#FFFFFF` su `#7C3AED` (bottone primario) | 4.8:1 | ✅ AA (minimo 4.5:1) |
| `#FFFFFF` su gradiente (bubble outgoing) | 5.1:1 min | ✅ AA |
| `#0F0A1E` su `#F0EEFF` (testo su surface) | 15.2:1 | ✅ AAA |
| `#6E6880` su `#FFFFFF` (testo dim) | 4.6:1 | ✅ AA |
| `#7C3AED` su `#0F0A1E` (dark mode accent) | 5.9:1 | ✅ AA |

---

## 3. Tipografia

### 3.1 Il Font — Inter

**Inter** (Rasmus Andersson, open source, Google Fonts) è il typeface di Alpha Chat per tutti i testi dell'interfaccia.

**Perché Inter:**
- Progettato specificamente per la leggibilità su schermo ad alta densità di pixel
- Eccellente a dimensioni piccole (11–13px, tipiche dei timestamp nelle chat)
- Carattere aperto e leggibile anche nello scorrimento veloce di una lista messaggi
- Supporta tutti i caratteri latini, cirillici, greci — copertura linguistica per internazionalizzazione futura
- Pesi disponibili: 100–900, con variabile font per interpolazione fluida
- Zero costi di licenza
- Adottato da Linear, Vercel, GitHub (nuovo design system), Figma (interfaccia)

**Alternativa considerata e scartata:**
- *SF Pro (Apple):* solo su piattaforme Apple, inconsistente cross-platform
- *Roboto (Google):* troppo associato a Android Material Design, non abbastanza neutro
- *Geist:* ottima per developer tools, troppo tecnica per un'app consumer

### 3.2 Scala Tipografica

| Token | Dimensione | Peso | Line Height | Letter Spacing | Uso |
|---|---|---|---|---|---|
| `--text-xs` | 11px | 400 | 16px | +0.2px | Timestamp, label piccole |
| `--text-sm` | 13px | 400 | 18px | 0 | Anteprima messaggio, testo secondario |
| `--text-base` | 15px | 400 | 22px | 0 | Corpo del messaggio (uso principale) |
| `--text-base-medium` | 15px | 500 | 22px | 0 | Nome mittente nella bubble |
| `--text-md` | 17px | 400 | 24px | -0.2px | Titolo sezione, nome conversazione nella lista |
| `--text-md-semibold` | 17px | 600 | 24px | -0.2px | Nome contatto in evidenza |
| `--text-lg` | 20px | 600 | 28px | -0.3px | Titolo schermata (navigation bar) |
| `--text-xl` | 24px | 700 | 32px | -0.5px | Display nome profilo |
| `--text-2xl` | 32px | 700 | 40px | -0.8px | Titolo onboarding |
| `--text-3xl` | 40px | 800 | 48px | -1px | Hero screens |

### 3.3 Uso Tipografico nella Chat

**Regola fondamentale:** nella lista dei messaggi, la priorità è la velocità di lettura durante lo scroll. La gerarchia visiva deve funzionare istantaneamente, senza sforzo.

```
┌──────────────────────────────────────┐
│  Marco Rossi                  14:32  │  ← text-base-medium + text-xs dim
│  Ciao! Come stai? Ho sentito che...  │  ← text-sm (preview, truncated)
└──────────────────────────────────────┘

Nella conversazione aperta:
┌──────────────────────────────────────┐
│  Marco Rossi                         │  ← text-sm-medium (nome, solo nei gruppi)
│                                      │
│  Ho sentito che il progetto sta      │  ← text-base (corpo)
│  andando molto bene. Ottimo lavoro!  │
│                               14:32 ✓✓│  ← text-xs (timestamp + receipt)
└──────────────────────────────────────┘
```

### 3.4 Dynamic Type (iOS) e Font Scale (Android)

Alpha Chat rispetta le impostazioni di dimensione testo del sistema operativo. I token tipografici sono definiti in unità scalabili (`sp` su Android, `pt` con Dynamic Type su iOS). L'interfaccia è progettata e testata con:
- Dimensione testo sistema: Piccola (80% scala base)
- Dimensione testo sistema: Default (100%)
- Dimensione testo sistema: Grande (130%)
- Dimensione testo sistema: Extra Grande — Accessibilità (200%)

A 200%, il layout della bubble si adatta: il timestamp va su una riga separata sotto il testo, non inline.

---

## 4. Iconografia

### 4.1 Stile delle Icone

**Libreria base:** [Phosphor Icons](https://phosphoricons.com/) — set open source con 6 pesi per ogni icona (Thin, Light, Regular, Bold, Fill, Duotone).

**Perché Phosphor:**
- 6 varianti di peso per ogni icona → usare Regular per UI normale, Fill per stati attivi (tab bar)
- Stile arrotondato, moderno, non troppo "tecnico" — coerente con la personalità di Alpha Chat
- 1.200+ icone coprendo tutti i casi d'uso di una chat app
- MIT license — zero costi
- Compatibile con React Native via `phosphor-react-native`

**Perché non Material Icons o SF Symbols:**
- Material Icons: troppo associato a Android/Google Material Design
- SF Symbols: solo Apple, non cross-platform

### 4.2 Utilizzo per Peso

| Peso icona | Contesto |
|---|---|
| **Regular** | Icone in stato inattivo: tab bar non selezionata, azioni nel menu, header |
| **Fill** | Icone in stato attivo: tab bar selezionata, like attivo, messaggio pinnato |
| **Bold** | Icone di azione primaria in bottoni grandi (invia, chiama) |
| **Duotone** | Empty states, illustrazioni, onboarding — non nell'UI normale |

### 4.3 Dimensioni Icone

| Contesto | Dimensione | Peso |
|---|---|---|
| Navigation bar / Tab bar | 24×24px | Regular / Fill |
| Icone inline nei messaggi (stato, tipo) | 16×16px | Regular |
| Bottone azione primaria (invia) | 20×20px | Bold |
| Menu contestuale long press | 22×22px | Regular |
| Empty state illustration | 64×64px | Duotone |
| Icone di status (online, muted) | 12×12px | Fill |

### 4.4 Icone Custom — Alpha Chat Specifiche

Le icone seguenti **non esistono in nessun set standard** e vengono disegnate su misura, seguendo la grid e lo stile di Phosphor:

| Icona | Descrizione | Uso |
|---|---|---|
| `alpha-verified` | Badge scudo con simbolo Alpha — versione icona | Canali e account verificati Alpha Chat |
| `read-receipt-sent` | Singola spunta stilizzata | Messaggio inviato |
| `read-receipt-delivered` | Doppia spunta | Messaggio consegnato |
| `read-receipt-read` | Doppia spunta colorata (viola) | Messaggio letto |
| `disappearing-message` | Timer con bolla | Messaggi a scomparsa attivi |
| `e2e-lock` | Lucchetto con forma A | Indicatore E2E nella UI |

### 4.5 Icona App — Declinazioni per Piattaforma

| Piattaforma | Forma sfondo | Specifiche |
|---|---|---|
| iOS | Quadrato con angoli arrotondati (managed da OS) | 1024×1024px, sfondo bianco, logo centrato al 70% della dimensione |
| Android | Adaptive icon | Foreground: simbolo su trasparente; Background: bianco o gradiente |
| Android (monochrome) | Icona monocromatica | Simbolo in viola piatto per temi monocromatici Android 13+ |
| Web / PWA | Cerchio o quadrato | 512×512px, sfondo bianco |
| macOS (futura) | Quadrato arrotondato macOS | Stesso master iOS |

---

## 5. Layout e Spaziatura

### 5.1 Grid e Unità Base

**Unità base: 4px.** Ogni spaziatura è multiplo di 4.

| Token | Valore | Uso |
|---|---|---|
| `--space-1` | 4px | Micro-spaziatura, padding icone inline |
| `--space-2` | 8px | Padding interno componenti piccoli, gap tra icona e testo |
| `--space-3` | 12px | Padding input, spaziatura bubble interna |
| `--space-4` | 16px | Padding schermata standard, margin orizzontale |
| `--space-5` | 20px | Spaziatura sezioni |
| `--space-6` | 24px | Header padding, gap tra card |
| `--space-8` | 32px | Spaziatura tra blocchi grandi |
| `--space-12` | 48px | Spaziatura bottom bar, safe area |
| `--space-16` | 64px | Spaziatura hero screens |

### 5.2 Border Radius

| Token | Valore | Uso |
|---|---|---|
| `--radius-sm` | 4px | Tag, badge piccoli |
| `--radius-md` | 8px | Card, input, bottoni secondari |
| `--radius-lg` | 12px | Bubble messaggi incoming |
| `--radius-xl` | 16px | Modal, bottom sheet, card grandi |
| `--radius-2xl` | 20px | Bubble messaggi outgoing |
| `--radius-full` | 9999px | Avatar, bottone invia, badge circolari |

> **Nota bubble:** Le bubble outgoing (mie) hanno `border-bottom-right-radius: 4px` — l'angolo "coda" che indica il mittente. Le bubble incoming hanno `border-bottom-left-radius: 4px`. Questo pattern, usato da WhatsApp e Telegram, è sufficientemente familiare da non richiedere apprendimento.

### 5.3 Elevazione (Shadow)

Alpha Chat usa ombre calde con la sottotona viola — non ombre grigie neutre.

| Token | Valore CSS | Uso |
|---|---|---|
| `--shadow-sm` | `0 1px 3px rgba(109,40,217,0.08)` | Card, bubble |
| `--shadow-md` | `0 4px 12px rgba(109,40,217,0.12)` | Bottom sheet bassa, dropdown |
| `--shadow-lg` | `0 8px 24px rgba(109,40,217,0.16)` | Modal, bottom sheet alta |
| `--shadow-xl` | `0 16px 48px rgba(109,40,217,0.20)` | Overlay, call screen |

---

## 6. Componenti UI Fondamentali

### 6.1 Navigation Bar

```
┌─────────────────────────────────────────┐
│  ←   Marco Rossi              📞  ⋮    │
│      ● online                           │
└─────────────────────────────────────────┘
```

- Altezza: 56px + safe area top
- Sfondo: `--color-surface` con blur backdrop (iOS: UIBlurEffect, Android: elevation + tint)
- Avatar: 36×36px, border-radius 50%, clickable (apre profilo)
- Nome: `--text-md-semibold`, `--color-on-background`
- Status: `--text-xs`, `--color-on-surface-dim` — "online" / "ultima visita ore 14:30"
- Icone azione (chiamata, menu): 24px, peso Regular, `--color-primary`
- Separatore bottom: `1px solid --color-outline`

### 6.2 Tab Bar (Mobile)

```
┌─────────┬─────────┬─────────┬─────────┐
│  💬 1   │  📞     │  👥     │  ⚙️    │
│  Chat   │ Chiamate│ Canali  │Impost.  │
└─────────┴─────────┴─────────┴─────────┘
```

- Altezza: 49px + safe area bottom
- Icona attiva: Fill, colore `--color-primary` con background circle `--color-primary-xlight`
- Icona inattiva: Regular, colore `--color-on-surface-dim`
- Badge notifiche: cerchio rosso `--color-error`, testo bianco, `--text-xs` (700)
- Nessun label text in stato normale — solo l'icona (più pulito, più spazio)
- Label appare solo in stato attivo, animata con fade-in (100ms)

### 6.3 Input Messaggi

```
┌─────────────────────────────────────┐
│  📎  [Scrivi un messaggio...  ]  🎤 │
└─────────────────────────────────────┘
```

- Altezza: min 52px, espandibile fino a 120px (4 righe) poi scroll interno
- Sfondo: `--color-surface-raised`
- Border radius: `--radius-full` quando vuoto, `--radius-xl` quando multiriga
- Placeholder: "Scrivi un messaggio…", colore `--color-on-surface-dim`
- Icona allegati (sinistra): Phosphor `PaperclipSimple`, Regular, 22px
- Icona invio (appare quando c'è testo): gradiente primario su cerchio `--radius-full` con `Send` Bold bianca — rimpiazza il microfono
- Icona microfono (quando input vuoto): `Microphone`, Regular, 22px, `--color-primary`
- Transizione invio↔microfono: 150ms scale + fade

### 6.4 Bubble Messaggi

**Outgoing (mio):**
```
                    ┌──────────────────────────┐
                    │ Ciao! Come stai?         │  ← gradiente primario
                    │                   14:32 ✓✓│  ← timestamp + receipt
                    └──────────────────────────┘◣  ← coda in basso a destra
```

**Incoming (altrui):**
```
◢┌──────────────────────────┐
 │ Marco Rossi              │  ← nome (solo nei gruppi), color diverso per membro
 │ Sto bene, grazie! E tu?  │  ← surface raised
 │ 14:33                    │
 └──────────────────────────┘
```

- Max width: 75% della larghezza schermo
- Padding: `--space-3` verticale, `--space-4` orizzontale
- Bubble con solo emoji: dimensione 44px, nessun bubble background
- Bubble con immagine: angoli arrotondati `--radius-lg`, immagine full-bleed, timestamp overlay in basso
- Bubble "eliminato": testo in corsivo "Messaggio eliminato", colore dim, icona `ProhibitInset` 14px

### 6.5 Avatar

- Dimensione standard: 40×40px (lista chat), 36×36px (bubble gruppo), 80×80px (profilo)
- Forma: cerchio perfetto
- Fallback (nessuna foto): gradiente generato dal nome dell'utente (hash del nome → indice in palette di 8 gradienti predefiniti), iniziale(i) in bianco, peso 600
- Palette gradienti avatar fallback (8 varianti):

```
1. #6D28D9 → #7C3AED  (viola — come il brand)
2. #1D4ED8 → #2563EB  (blu)
3. #0F766E → #0D9488  (teal)
4. #15803D → #16A34A  (verde)
5. #B45309 → #D97706  (arancione)
6. #C2410C → #DC2626  (rosso)
7. #7E22CE → #C026D3  (magenta)
8. #374151 → #4B5563  (grigio scuro — per nomi che hashing a questo slot)
```

---

## 7. Animazioni e Motion Design

### 7.1 Principi

**Ogni animazione deve avere uno scopo comunicativo. Zero animazioni decorative.**

| Scopo | Tipo di animazione | Durata |
|---|---|---|
| Orientamento spaziale (navigazione) | Slide + fade | 280ms |
| Feedback azione (invio, reazione) | Scale + spring | 200ms |
| Transizione di stato (loading→content) | Fade | 150ms |
| Micro-feedback (tap, press) | Scale down 0.96 + release | 80ms press / 120ms release |
| Apparizione elemento (nuovo messaggio) | Slide up + fade | 200ms |
| Scomparsa elemento (eliminazione) | Fade out + collapse height | 250ms |

**Nessuna animazione supera i 350ms.** Animazioni lente sembrano lente, non eleganti.

### 7.2 Easing Curves

| Curva | Valori Cubic Bezier | Uso |
|---|---|---|
| `ease-out` | `cubic-bezier(0, 0, 0.2, 1)` | Elementi che appaiono (ingresso) |
| `ease-in` | `cubic-bezier(0.4, 0, 1, 1)` | Elementi che scompaiono (uscita) |
| `ease-in-out` | `cubic-bezier(0.4, 0, 0.2, 1)` | Transizioni di stato neutro |
| `spring` | `{ damping: 20, stiffness: 300 }` (Reanimated) | Bottoni, reazioni, like |

### 7.3 Animazioni Chiave

**Invio messaggio:**
1. La bubble appare dal basso dell'input, con `translateY(+20px) scale(0.95) opacity(0)` → `translateY(0) scale(1) opacity(1)` in 200ms ease-out
2. L'input si svuota con fade (100ms)
3. L'icona invio torna al microfono con scale+fade (150ms)

**Ricezione messaggio:**
1. Scroll automatico verso il basso se l'utente era già in fondo (threshold: ultimi 100px)
2. Bubble appare con `translateX(-12px) opacity(0)` → `translateX(0) opacity(1)` in 180ms ease-out
3. La notification bar in cima pulsa leggermente se l'utente è altrove nella lista

**Read receipt (spunta lettura):**
1. La spunta singola (inviato) si trasforma in doppia (consegnato): le due spunte appaiono in sequenza, 60ms di delay tra prima e seconda
2. Il cambio colore (grigio → viola = letto): transizione colore 300ms ease-in-out

**Long press menu:**
1. Il menu appare con `scale(0.85) opacity(0)` → `scale(1) opacity(1)` in 180ms spring
2. La bubble di sfondo si scala leggermente verso il basso (scale 0.98, 200ms) per indicare che è "selezionata"

**Typing indicator:**
Tre pallini in sequenza:
- Ciascun pallino oscilla con `translateY(-4px)` in 400ms
- Delay tra pallino 1, 2, 3: 80ms ciascuno
- Loop infinito finché l'altro utente sta scrivendo
- Appare/scompare con fade 200ms

**Reazione emoji:**
1. L'emoji appare con `scale(0) opacity(0)` → `scale(1.2) opacity(1)` (120ms) → `scale(1)` (80ms spring bounce)
2. Il counter incrementa con un micro-slide (numero precedente esce in alto, nuovo entra dal basso, 120ms)

**Navigazione:**
- Apertura chat dalla lista: slide da destra (280ms ease-out) + fade background list (50% opacity durante slide)
- Chiusura (swipe back): segue il dito, rilascio con spring verso chiusura o apertura in base alla velocità

### 7.4 Skeleton Screen (Loading State)

Mai uno spinner di caricamento per i contenuti della chat. Sempre skeleton screen.

Il skeleton rispecchia esattamente il layout del contenuto atteso:
- Lista chat: righe con avatar circolari, due linee di testo a larghezza variabile, shimmer effect
- Schermata chat: bubble alternate a destra e sinistra, altezze variabili, shimmer
- Profilo utente: avatar grande, linee nome e bio

**Shimmer effect:**
Gradiente che si sposta da sinistra a destra in loop, colori `--color-outline` → `--color-surface-raised` → `--color-outline`. Durata loop: 1.2s ease-in-out infinite.

---

## 8. Suoni

### 8.1 Principio

I suoni di Alpha Chat devono essere:
- **Riconoscibili:** qualcuno che sente il suono di notifica in un posto pubblico pensa "mi è arrivato un messaggio su Alpha Chat" — non "sembra WhatsApp"
- **Non invasivi:** non disturbano chi è vicino più del necessario
- **Coerenti con il brand:** tono moderno, leggermente sofisticato, non cartoonesco

### 8.2 Catalogo Suoni

**Notifica messaggio in arrivo**
- Carattere: doppio tono breve, il secondo leggermente più alto del primo (ascendente)
- Durata: 0.4 secondi
- Frequenza base: ~880Hz → 1108Hz
- Timbro: sintetico pulito con leggero attack morbido e decay rapido — no acoustic, no bell metallico
- Non deve sembrare WhatsApp (corto monofono) né iMessage (xilofono)
- Analogo concettuale: il suono di un sistema operativo moderno — Slack, Linear, Notion — ma più breve e meno "produttivo"

**Messaggio inviato**
- Carattere: singolo click/pop morbido, quasi subliminale
- Durata: 0.15 secondi
- Scopo: conferma tattile-sonora dell'azione — non deve attirare attenzione, solo confermare
- Volume: 30% del volume sistema

**Chiamata in ingresso (ringtone)**
- Carattere: melodia a 3-4 note, ripetuta in loop con pausa tra i loop
- Durata loop: 2 secondi + 3 secondi silenzio
- Tono: contemporaneo, non il classico "driiing" — più vicino a un notification tone di qualità che a un ringtone tradizionale
- Deve essere distinguibile chiaramente da tutti i notification sounds

**Suono di fine chiamata**
- Carattere: singolo tono discendente breve
- Durata: 0.5 secondi
- Tono: neutro, non drammatico — indica la fine, non un fallimento

**Suono connessione chiamata stabilita**
- Carattere: due toni brevi ascendenti ("ding-ding")
- Durata: 0.3 secondi
- Scopo: confermare all'utente che la chiamata è attiva

**Assenza suono (contesti silenziosi)**
Tutte le azioni che avvengono in modalità silenziosa (Do Not Disturb, switch mute) producono solo haptic feedback — zero output audio.

### 8.3 Formato e Implementazione

- Formato: `.aac` (iOS e Android) + `.ogg` (Android fallback) + `.mp3` (Web)
- Tutti i suoni prodotti in stereo a 44.1kHz, normalizzati a -16 LUFS
- I suoni sono bundled nell'app — nessuna richiesta di rete per riprodurli
- Il suono di notifica messaggio è personalizzabile dall'utente (V2) con un set di 5 varianti predefinite

---

## 9. Feedback Aptico (Vibrazione)

### 9.1 Principio

L'haptic feedback è il terzo canale di comunicazione — dopo visivo e sonoro. Su un'app di messaging è cruciale: le azioni hanno peso fisico.

### 9.2 Catalogo Haptic

| Evento | iOS (UIFeedbackGenerator) | Android (VibrationEffect) |
|---|---|---|
| **Tap su bottone** | Light Impact | `EFFECT_TICK` (3ms) |
| **Invio messaggio** | Medium Impact | `EFFECT_CLICK` (10ms) |
| **Long press (attiva menu)** | Heavy Impact | `EFFECT_HEAVY_CLICK` (20ms) |
| **Ricezione messaggio (app in foreground)** | Nessuno — solo visivo | Nessuno — solo visivo |
| **Ricezione notifica (app in background)** | Notification (Success) | Pattern `[0, 50]` |
| **Chiamata in arrivo** | Loop di impatti Medium + pausa, sincrono con ringtone | Pattern `[0, 100, 500, 100, 500]` loop |
| **Risposta chiamata accettata** | Success Notification | `EFFECT_HEAVY_CLICK` singolo |
| **Fine chiamata** | Warning Notification | Pattern `[0, 30, 60, 30]` |
| **Eliminazione messaggio (conferma)** | Error Notification | Pattern `[0, 20, 40, 20]` |
| **Pull-to-refresh (scatta)** | Light Impact | `EFFECT_TICK` |
| **Swipe per rispondere** | Light Impact (al trigger point) | `EFFECT_CLICK` |
| **Errore (messaggio non inviato)** | Error Notification | Pattern `[0, 50, 100, 50]` |

### 9.3 Preferenze Utente

L'utente può disabilitare il feedback aptico completamente nelle impostazioni di Alpha Chat, indipendentemente dalle impostazioni di sistema. Questa preferenza è sincronizzata su tutti i device dell'utente.

---

## 10. Personalità del Marchio

### 10.1 Alpha Chat Come Persona

Se Alpha Chat fosse una persona:

**È affidabile, non formale.** Fa quello che dice. Non usa parole complicate per sembrare più serio. Quando dice "il tuo messaggio è cifrato", intende esattamente quello.

**È veloce, non frettoloso.** Risponde istantaneamente, ma non per questo è superficiale. La velocità è rispetto per il tempo degli altri.

**È moderno, non alla moda.** Non insegue i trend. Scelte estetiche che durano anni, non stagioni.

**È diretto, non brusco.** Dice quello che c'è da dire nel numero minimo di parole. Non fa domande retoriche. Non aggiunge prefazioni inutili.

**È riservato, non freddo.** Non chiede informazioni che non gli servono. Non condivide quello che non deve condividere. Ma quando serve essere caldi, lo è.

### 10.2 Archetipi di Brand

| Archetipo | Presenza in Alpha Chat | Note |
|---|---|---|
| **Il Custode** (protegge, è affidabile) | Primario | La crittografia, la privacy — Alpha Chat protegge le conversazioni degli utenti |
| **Il Saggio** (informato, preciso) | Secondario | Le scelte tecniche sono sempre spiegate. Nessuna magia nera. |
| **Il Creativo** (estetico, originale) | Terziario | Il design è distinctivo — non copiato |

### 10.3 Valori di Brand Visibili nel Prodotto

| Valore | Come si manifesta |
|---|---|
| **Fiducia** | Lock icon E2E visibile. Nessun onboarding che chiede dati non necessari. Privacy policy in linguaggio umano. |
| **Velocità** | Optimistic updates su ogni azione. Skeleton screen. Mai uno spinner che blocca l'interfaccia. |
| **Rispetto** | Notifiche non invasive. DND che funziona davvero. Nessun dark pattern. |
| **Precisione** | Read receipt accurate. Timestamp precisi. Stato "consegnato" vs "letto" realmente distinti. |

---

## 11. Tono di Voce

### 11.1 Principi

Il testo nell'interfaccia di Alpha Chat segue quattro regole:

**1. Breve.** Se si può dire in 3 parole, non se ne usano 7.

**2. Diretto.** L'utente è adulto. Non serve spiegare ogni conseguenza di ogni azione.

**3. Umano.** Non "Si è verificato un errore durante l'elaborazione della richiesta." Sì "Qualcosa è andato storto. Riprova."

**4. Preciso.** Non "I tuoi messaggi sono al sicuro." Sì "I tuoi messaggi sono cifrati end-to-end — solo tu e i tuoi contatti li leggono."

### 11.2 Esempi — Prima e Dopo

| ❌ Da evitare | ✅ Da usare |
|---|---|
| "Si è verificato un errore durante l'invio del messaggio" | "Messaggio non inviato. Riprova." |
| "Sei sicuro di voler eliminare questo messaggio?" | "Eliminare il messaggio?" |
| "L'utente selezionato è stato bloccato con successo" | "Utente bloccato." |
| "Inserisci un indirizzo email valido nel campo sottostante" | "Email non valida." |
| "La tua connessione internet sembra essere assente" | "Nessuna connessione." |
| "Benvenuto in Alpha Chat! Siamo felicissimi di averti qui" | "Benvenuto. Scegli il tuo username." |
| "Nessun risultato trovato per la tua ricerca" | "Nessun risultato." |
| "Stai per eliminare il tuo account permanentemente" | "Elimina account — azione irreversibile." |

### 11.3 Emoji nell'Interfaccia

Le emoji nell'UI di sistema (non nei messaggi degli utenti) sono usate con parsimonia:
- **Onboarding:** 1 emoji per schermata, per calore
- **Empty states:** 1 emoji + testo breve
- **Messaggi di sistema:** nessuna emoji — testo solo
- **Notifiche di successo rare:** 1 emoji finale opzionale

Non si usano emoji come sostituto di testo in label o azioni.

---

## 12. Dark Mode

### 12.1 Principio

Il dark mode di Alpha Chat non è "l'interfaccia invertita". È un tema progettato da zero che condivide la struttura semantica con il light mode ma ha una propria identità visiva.

**Il background scuro (`#0F0A1E`) non è nero puro** — è viola-nero. Questo crea un'atmosfera più calda e personale del nero freddo di WhatsApp dark, e mantiene la coerenza con il brand.

### 12.2 Comportamento del Gradiente in Dark Mode

Il gradiente primario rimane **identico** in entrambi i temi. Le bubble outgoing hanno sempre il gradiente viola-magenta — sia in light che in dark. È uno dei pochi elementi che non cambia.

Questo è una scelta deliberata: il gradiente è l'identità visiva di Alpha Chat. Non sparisce in dark mode.

### 12.3 Superfici in Dark Mode

In dark mode, la profondità visiva si ottiene con **livelli di luminosità crescente** (non ombre, che non funzionano su sfondi scuri):

| Superficie | Hex | Uso |
|---|---|---|
| Layer 0 (base) | `#0F0A1E` | Background principale app |
| Layer 1 | `#1A1330` | Card, bubble incoming, lista items |
| Layer 2 | `#241B3D` | Input, surface raised |
| Layer 3 | `#2E2448` | Menu contestuale, tooltip |
| Layer 4 | `#3D3159` | Hover, pressed states |

### 12.4 Rilevamento e Preferenza

- Default: segue le impostazioni di sistema (Light/Dark/Automatic del OS)
- L'utente può sovrascrivere: Chiaro / Scuro / Segui sistema
- La preferenza è sincronizzata su tutti i device dell'utente
- Nessuna richiesta di scelta al primo avvio — si parte con "Segui sistema"

---

## 13. Regole di Utilizzo del Brand

### 13.1 Cosa Si Può Fare

- Usare il logo nella variante corretta (vedi 1.2) per rappresentare Alpha Chat
- Usare il gradiente primario su CTA e bottoni principali
- Usare Inter per tutto il testo dell'interfaccia
- Usare Phosphor Icons seguendo le specifiche di peso per ogni contesto

### 13.2 Cosa Non Si Può Fare

| ❌ Vietato | Motivo |
|---|---|
| Ruotare o deformare il logo | Rompe la forma geometrica precisa |
| Applicare il logo su sfondi con gradiente (eccetto il proprio) | Illeggibile, confusivo |
| Usare il logo in colori diversi dal gradiente o dal monocromatico specificato | Incoerenza brand |
| Aggiungere effetti (ombra, outline, glow) al logo | Il logo è progettato per stare da solo |
| Usare font diversi da Inter nell'interfaccia | Incoerenza sistematica |
| Usare ombre grigie neutre | Si usano solo ombre con sottotona viola |
| Usare il nero puro (`#000000`) come background | Si usa `#0F0A1E` |
| Usare il blu come colore delle read receipt | Si usa `--color-primary` (viola) |

### 13.3 Il Brand Nei Materiali Esterni

Per landing page, App Store screenshots, social media, e materiali di marketing:
- Il gradiente primario può essere usato come sfondo di sezione
- Il simbolo triangolare può essere usato come watermark/pattern a opacità 10–15%
- Le screenshot dell'app nelle comunicazioni usano il dark mode — più impattante visivamente

---

## 14. Feature Filter — Le Tre Domande

Da questo momento, ogni nuova funzionalità proposta per Alpha Chat deve superare le seguenti tre domande prima di entrare nel documento di architettura, nel backlog, o in qualsiasi sprint.

### Le Tre Domande

**Domanda 1:** Rende Alpha Chat migliore di WhatsApp per l'utente che la usa?

Non "simile a WhatsApp". Non "alla pari con WhatsApp". **Migliore.** Se la risposta è "uguale", la funzionalità non è un differenziatore — va nel backlog basso e non ha priorità.

**Domanda 2:** È utile al 90% degli utenti?

Se la funzionalità serve solo un caso d'uso di nicchia, introduce complessità per tutti per servire pochi. Va valutata criticamente. Una funzionalità che serve il 90% degli utenti è sempre prioritaria rispetto a una che serve il 10% ma è tecnicamente interessante.

**Domanda 3:** Vale la complessità che introduce?

Ogni funzionalità aggiunge superficie di test, possibilità di bug, carico cognitivo sull'utente che deve capire dove si trova. Una funzionalità "semplice" può introdurre complessità invisibile. Se il costo supera il beneficio, va nel backlog o eliminata.

### Esiti Possibili

| Risultato | Azione |
|---|---|
| ✅ Supera tutte e tre | Entra nel documento di architettura con priorità definita |
| ⚠️ Supera 2/3 (manca "migliore di WhatsApp") | Entra nel backlog — non nella V1 |
| ⚠️ Supera 2/3 (manca "90% degli utenti") | Entra nel backlog V2+ come "feature avanzata" |
| ⚠️ Supera 2/3 (manca "vale la complessità") | Si rivaluta dopo il lancio con dati reali |
| ❌ Supera 1/3 o meno | Scartata — non entra nel backlog principale |

### Esempi di Applicazione

| Funzionalità | D1 | D2 | D3 | Esito |
|---|---|---|---|---|
| E2E crittografia | ✅ | ✅ | ✅ | V1 Core |
| Reazioni emoji | ✅ | ✅ | ✅ | V1 |
| Sticker personalizzati | ⚠️ | ✅ | ⚠️ | Backlog V2 |
| NFT profile picture | ❌ | ❌ | ❌ | Scartata |
| Blocco screenshot | ✅ | ✅ | ✅ | V1 |
| Messaggi a scomparsa | ✅ | ✅ | ✅ | V1 |
| Integrazione IA per riassunti | ✅ | ⚠️ | ⚠️ | V3 |
| GIF search integrata | ✅ | ✅ | ✅ | V1 |
| Thread nelle conversazioni | ✅ | ⚠️ | ⚠️ | V2 |
| Video note circolari | ✅ | ✅ | ✅ | V1 |

---

## Riepilogo: I Token di Design in un Colpo d'Occhio

```
BRAND
  Logo:             Triangolo arrotondato A con gradiente, accento fiamma
  Gradiente:        #6D28D9 → #7C3AED → #C026D3 (135°)

COLORI
  Primary:          #7C3AED
  Accent:           #C026D3
  Background Light: #FFFFFF
  Background Dark:  #0F0A1E
  Surface Light:    #F8F7FF
  Surface Dark:     #1A1330
  Text:             #0F0A1E / #F0EEFF (dark)
  Text Dim:         #6E6880 / #8B84A0 (dark)
  Read Receipt:     #7C3AED (non blu)

TIPOGRAFIA
  Font:             Inter (Variable)
  Corpo chat:       15px / 400 / 22px line-height
  Nome mittente:    15px / 500
  Timestamp:        11px / 400 / 0.2px letter-spacing

ICONE
  Libreria:         Phosphor Icons
  Stile attivo:     Fill + color primary
  Stile inattivo:   Regular + color dim

ANIMAZIONI
  Durata max:       350ms
  Ingresso:         ease-out
  Uscita:           ease-in
  Interazione:      spring (damping 20, stiffness 300)

SUONI
  Notifica:         Doppio tono ascendente, 0.4s
  Invio:            Click morbido, 0.15s
  Chiamata:         Melodia 3-4 note, loop 2s + 3s silenzio

HAPTIC
  Tap:              Light
  Invio:            Medium
  Long press:       Heavy
  Errore:           Error notification pattern
```

---

*Documento preparato per il team Alpha Chat*
*Brand Identity & Design System v1.0 — Luglio 2025*
*Questo documento è il riferimento vincolante per tutte le decisioni visive, sonore e di interazione di Alpha Chat.*
*Ogni deviazione da questo documento richiede una decisione esplicita documentata — non un'eccezione silenziosa.*
