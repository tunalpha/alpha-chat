# Alpha Chat — Backend Standards
### Le Regole con cui Tutto il Backend Viene Scritto
> Versione 1.0 — Luglio 2025
> Status: Pre-Implementazione — Vincolante per ogni modulo backend
> Nessuna riga di codice backend viene scritta senza rispettare questo documento.

---

## Regola Fondamentale — Conformità Documentale

**Prima di implementare ogni modulo, l'agente verifica la conformità con:**

| Documento | Controllo |
|---|---|
| `00_Manifesto.md` | Il codice non viola nessuna delle 20 regole immutabili |
| `03_Bible.md` | Il comportamento rispetta le 52 regole verificabili |
| `04_Architecture.md` | La struttura segue l'architettura modular monolith v3.0 |
| `05_Database.md` | Ogni schema Mongoose corrisponde esattamente allo schema documentato |
| `06_API.md` | Ogni endpoint corrisponde alla specifica: URL, metodo, payload, errori, codici HTTP |

**Se viene trovata una contraddizione tra il codice e la documentazione:**
1. L'agente si ferma
2. Segnala la contraddizione esplicitamente (file A dice X, file B dice Y)
3. Non decide autonomamente — aspetta istruzione CTO
4. Non procede al modulo successivo finché la contraddizione non è risolta

---

## 1. Struttura delle Directory

```
artifacts/api-server/src/
│
├── config/                   # Configurazione centralizzata
│   ├── index.ts              # Entry point — esporta tutto il config validato
│   ├── app.config.ts         # Porta, CORS, env
│   ├── db.config.ts          # MongoDB URI, pool size, timeout
│   ├── redis.config.ts       # Upstash Redis URL
│   ├── jwt.config.ts         # Chiavi ES256, TTL access/refresh
│   ├── r2.config.ts          # Cloudflare R2 bucket, endpoint
│   └── rate-limit.config.ts  # Limiti per endpoint
│
├── models/                   # Mongoose Schema — solo struttura dati
│   ├── user.model.ts
│   ├── session.model.ts
│   ├── conversation.model.ts
│   ├── conversation-member.model.ts
│   ├── message.model.ts
│   ├── message-reaction.model.ts
│   ├── media.model.ts
│   ├── user-prekey.model.ts
│   ├── contact.model.ts
│   ├── report.model.ts
│   ├── channel.model.ts
│   ├── channel-member.model.ts
│   └── call-log.model.ts
│
├── repositories/             # Accesso dati — solo query MongoDB
│   ├── user.repository.ts
│   ├── session.repository.ts
│   ├── conversation.repository.ts
│   ├── message.repository.ts
│   └── ...
│
├── services/                 # Business logic — nessun accesso diretto a DB
│   ├── auth.service.ts
│   ├── user.service.ts
│   ├── message.service.ts
│   ├── media.service.ts
│   └── ...
│
├── controllers/              # HTTP layer — nessuna business logic
│   ├── auth.controller.ts
│   ├── user.controller.ts
│   ├── message.controller.ts
│   └── ...
│
├── routes/                   # Express Router — solo definizione route
│   ├── index.ts              # Router principale — monta tutti i moduli
│   ├── v1/
│   │   ├── index.ts          # /api/v1/ — monta tutti i sotto-router
│   │   ├── auth.routes.ts
│   │   ├── users.routes.ts
│   │   ├── chats.routes.ts
│   │   ├── messages.routes.ts
│   │   ├── groups.routes.ts
│   │   ├── channels.routes.ts
│   │   ├── media.routes.ts
│   │   ├── calls.routes.ts
│   │   ├── notifications.routes.ts
│   │   ├── reports.routes.ts
│   │   ├── settings.routes.ts
│   │   ├── devices.routes.ts
│   │   ├── system.routes.ts  # health, version, status
│   │   └── admin.routes.ts
│
├── validators/               # Validazione input — Zod schemas
│   ├── auth.validators.ts
│   ├── user.validators.ts
│   ├── message.validators.ts
│   └── ...
│
├── middleware/               # Express middleware
│   ├── auth.middleware.ts    # Verifica JWT, attacca user a req
│   ├── rate-limit.middleware.ts
│   ├── request-id.middleware.ts  # Genera X-Request-ID
│   ├── client-version.middleware.ts  # Verifica X-Client-Version
│   ├── validate.middleware.ts  # Wrapper Zod per body/query/params
│   └── audit-log.middleware.ts  # Log azioni admin
│
├── errors/                   # Sistema errori centralizzato
│   ├── AppError.ts           # Classe base errori applicativi
│   ├── error-codes.ts        # Tutti i codici errore come costanti TypeScript
│   └── error-handler.ts     # Express error handler globale
│
├── events/                   # WebSocket e eventi interni
│   ├── event-bus.ts          # Bus eventi interno (EventEmitter)
│   ├── ws.server.ts          # WebSocket server setup
│   └── handlers/             # Handler per ogni tipo di evento WS
│       ├── typing.handler.ts
│       ├── presence.handler.ts
│       └── ...
│
├── jobs/                     # Background jobs (asincroni)
│   ├── media-processing.job.ts  # EXIF strip, virus scan, thumbnail
│   ├── media-cleanup.job.ts     # Rimozione file R2 schedulata
│   └── session-cleanup.job.ts  # Cleanup sessioni scadute
│
├── utils/                    # Utility pure — nessun side effect
│   ├── crypto.ts             # Hash, HMAC, token generation
│   ├── pagination.ts         # Cursor encode/decode
│   ├── response.ts           # Factory per risposte standard
│   └── phone.ts              # Normalizzazione numeri E.164
│
├── lib/                      # Librerie e client external
│   ├── logger.ts             # Pino logger configurato
│   ├── mongodb.ts            # Connessione Mongoose
│   ├── redis.ts              # Client Upstash Redis
│   └── r2.ts                 # Client Cloudflare R2
│
├── types/                    # TypeScript types condivisi
│   ├── express.d.ts          # Augmentation req.user, req.requestId
│   ├── api.types.ts          # Tipi shared tra controller e service
│   └── env.d.ts              # Tipo per process.env validato
│
├── app.ts                    # Express app factory — no listen()
└── server.ts                 # Entry point — chiama app(), poi listen()
```

---

## 2. Regole Architetturali — Non Derogabili

### 2.1 — Separazione dei Layer

```
Request → Router → Middleware → Validator → Controller → Service → Repository → MongoDB
                                                             ↓
                                                         Utils / Lib
```

| Layer | Responsabilità | NON può |
|---|---|---|
| **Router** | Registrare route e middleware | Contenere logica |
| **Validator** | Validare e parsare input con Zod | Toccare il DB |
| **Controller** | Ricevere req, chiamare service, rispondere | Accedere a DB direttamente, contenere business logic |
| **Service** | Business logic, orchestrare operazioni | Chiamare modelli Mongoose direttamente |
| **Repository** | Query MongoDB via Mongoose | Contenere business logic |
| **Model** | Definire schema e indici | Contenere logica |

**Violazioni di questo schema sono rifiutate in code review.**

### 2.2 — Regola del Controller

Un controller è costituito da massimo 3 operazioni:
1. Estrarre i dati validati dal `req`
2. Chiamare il service
3. Rispondere con `res`

```typescript
// ✅ Corretto
export const register: RequestHandler = async (req, res, next) => {
  try {
    const input = req.body as RegisterInput; // già validato dal middleware
    const result = await authService.register(input, req.deviceId);
    res.status(201).json(successResponse(result));
  } catch (err) {
    next(err);
  }
};

// ❌ Sbagliato — business logic nel controller
export const register: RequestHandler = async (req, res) => {
  const existing = await User.findOne({ username: req.body.username });
  if (existing) { res.status(409).json({ error: 'USERNAME_TAKEN' }); return; }
  const hash = await argon2.hash(req.body.password);
  // ...
};
```

### 2.3 — Regola del Service

Ogni service method:
- Riceve tipi TypeScript stretti — mai `any`
- Lancia `AppError` per condizioni di errore attese
- Non gestisce request/response HTTP
- Non importa da `express`

```typescript
// ✅ Corretto
export async function register(input: RegisterInput, deviceId: string): Promise<RegisterResult> {
  const existing = await userRepository.findByUsername(input.username);
  if (existing) throw new AppError('USERNAME_TAKEN', 409);
  // ...
}

// ❌ Sbagliato — req/res nel service
export async function register(req: Request, res: Response) { ... }
```

### 2.4 — Regola del Repository

Ogni metodo del repository:
- Ha un nome descrittivo dell'operazione (`findByUsername`, `createWithSession`, `markDeleted`)
- Riceve e restituisce tipi TypeScript — mai documenti Mongoose raw esposti al service
- È l'unico punto dove si chiama `Model.findOne()`, `Model.create()`, ecc.

```typescript
// ✅ Corretto
export async function findByUsername(username: string): Promise<UserDocument | null> {
  return User.findOne({ username: username.toLowerCase(), deleted_at: null });
}

// ❌ Sbagliato — query Mongoose nel service
const user = await User.findOne({ username });
```

### 2.5 — Gestione Errori — Un Solo Posto

Nessun `try/catch` nei controller eccetto il wrapper standard. Nessun `try/catch` nei service — i service lanciano `AppError`, il handler globale li gestisce.

```typescript
// errors/AppError.ts
export class AppError extends Error {
  constructor(
    public readonly code: string,
    public readonly httpStatus: number,
    public readonly field?: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(code);
    this.name = 'AppError';
  }
}
```

```typescript
// errors/error-handler.ts — registrato ULTIMO in app.ts
export const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  if (err instanceof AppError) {
    return res.status(err.httpStatus).json(errorResponse(err, req.requestId));
  }
  if (err instanceof ZodError) {
    const field = err.errors[0]?.path.join('.');
    return res.status(400).json(errorResponse(
      new AppError('VALIDATION_ERROR', 400, field),
      req.requestId
    ));
  }
  logger.error({ err, requestId: req.requestId }, 'Unhandled error');
  return res.status(500).json(errorResponse(new AppError('INTERNAL_ERROR', 500), req.requestId));
};
```

---

## 3. Formato Risposta — Implementazione

### Factory `successResponse`

```typescript
// utils/response.ts
export function successResponse<T>(data: T, meta?: Record<string, unknown>) {
  return {
    data,
    meta: {
      request_id: meta?.requestId ?? null,
      timestamp: new Date().toISOString(),
      ...meta,
    },
  };
}

export function paginatedResponse<T>(
  data: T[],
  pagination: { cursor: string | null; has_more: boolean; total?: number },
  requestId?: string
) {
  return {
    data,
    pagination,
    meta: {
      request_id: requestId ?? null,
      timestamp: new Date().toISOString(),
    },
  };
}

export function errorResponse(err: AppError, requestId?: string) {
  return {
    error: {
      code: err.code,
      message: ERROR_MESSAGES[err.code] ?? err.code,
      field: err.field ?? null,
      details: err.details ?? null,
      docs: `https://docs.alphachat.app/errors/${err.code}`,
    },
    meta: {
      request_id: requestId ?? null,
      timestamp: new Date().toISOString(),
    },
  };
}
```

---

## 4. Sicurezza — Middleware Obbligatori

### 4.1 — Stack di Sicurezza (ordine in `app.ts`)

```typescript
// 1. Helmet — HTTP security headers
app.use(helmet({
  contentSecurityPolicy: true,
  crossOriginEmbedderPolicy: true,
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
}));

// 2. CORS — whitelist esplicita
app.use(cors({
  origin: config.app.allowedOrigins,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Authorization', 'Content-Type', 'X-Device-ID', 'X-Request-ID', 'X-Client-Version'],
  credentials: true,
  maxAge: 86400,
}));

// 3. Request ID — ogni request ha un ID tracciabile
app.use(requestIdMiddleware);

// 4. Rate limit globale — fallback di sicurezza
app.use(globalRateLimiter);

// 5. Body parser — limite esplicito
app.use(express.json({ limit: '1mb' }));

// 6. Request logger (pino-http)
app.use(httpLogger);

// 7. Client version check
app.use(clientVersionMiddleware);
```

### 4.2 — Sanitizzazione Input

Ogni endpoint con body usa uno Zod schema. Le regole Zod:
- String: `.trim()` sempre
- String opzionale: `.optional().default('')` o `.nullable().default(null)` — mai `string | undefined` non gestito
- Email: `.email().toLowerCase()`
- ObjectId: validatore custom `z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid ID')`
- Enum: `z.enum(['value1', 'value2'])` — mai string libere
- Array: `.min(1).max(N)` sempre specificati

```typescript
// validators/auth.validators.ts
export const RegisterSchema = z.object({
  username: z.string().trim().min(3).max(30).regex(/^[a-z0-9_.]+$/).toLowerCase(),
  display_name: z.string().trim().min(1).max(60),
  password: z.string().min(8).max(128).regex(/^(?=.*[A-Z])(?=.*\d)/),
  phone: z.string().trim().optional(),
  email: z.string().trim().email().toLowerCase().optional(),
});
export type RegisterInput = z.infer<typeof RegisterSchema>;
```

### 4.3 — Auth Middleware

```typescript
// middleware/auth.middleware.ts
export const requireAuth: RequestHandler = async (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return next(new AppError('AUTH_TOKEN_MISSING', 401));

  const payload = verifyAccessToken(token); // lancia AppError se non valido
  
  // Controlla Redis blocklist
  const isRevoked = await redis.get(`jwt:blocklist:${payload.jti}`);
  if (isRevoked) return next(new AppError('AUTH_TOKEN_REVOKED', 401));

  req.user = { id: payload.sub, role: payload.role };
  req.requestId = req.headers['x-request-id'] as string;
  next();
};

export const requireAdmin: RequestHandler = (req, res, next) => {
  if (req.user?.role !== 'admin') return next(new AppError('INSUFFICIENT_PERMISSIONS', 403));
  next();
};
```

### 4.4 — Rate Limiting

Ogni route sensibile ha il proprio rate limiter configurato in `config/rate-limit.config.ts`. Il limiter usa Redis come store (Upstash) per funzionare su più istanze.

```typescript
// Esempio — rate limiter per login
export const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minuti
  max: 10,
  store: new RedisStore({ client: redis }),
  keyGenerator: (req) => req.ip ?? 'unknown',
  handler: (req, res) => res.status(429).json(errorResponse(new AppError('RATE_LIMIT_EXCEEDED', 429))),
  standardHeaders: true,
  legacyHeaders: false,
});
```

---

## 5. TypeScript — Regole Strict

### 5.1 — tsconfig.json (strict mode obbligatorio)

```json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

### 5.2 — Regole TypeScript

| Regola | Motivazione |
|---|---|
| Nessun `any` — mai | `any` disabilita TypeScript silenziosamente |
| Nessun `as Type` senza commento | Cast non controllato = bug silenzioso |
| Preferire `unknown` a `any` per input esterno | Force explicit narrowing |
| Return type esplicito su funzioni pubbliche | Documentazione e contratto |
| Interface per oggetti di dominio, type per union | Convenzione progetto |
| `const` sempre, `let` solo quando necessario | Prevenire reassignment non intenzionale |

### 5.3 — Express Type Augmentation

```typescript
// types/express.d.ts
declare namespace Express {
  interface Request {
    user?: {
      id: string;
      role: 'user' | 'admin';
    };
    requestId: string;
    deviceId: string;
  }
}
```

---

## 6. Logger — Pino

### 6.1 — Configurazione

```typescript
// lib/logger.ts
export const logger = pino({
  level: config.app.env === 'production' ? 'info' : 'debug',
  redact: {
    paths: [
      'req.headers.authorization',
      'req.body.password',
      'req.body.current_password',
      'req.body.new_password',
      'req.body.refresh_token',
      'req.body.uri',           // MongoDB URI con credenziali
      '*.phone',
      '*.email',
    ],
    censor: '[REDACTED]',
  },
  serializers: {
    req: pino.stdSerializers.req,
    res: pino.stdSerializers.res,
    err: pino.stdSerializers.err,
  },
});
```

### 6.2 — Regole di Logging

| Livello | Quando usarlo |
|---|---|
| `logger.fatal` | Il processo deve terminare (OOM, DB irraggiungibile) |
| `logger.error` | Errore non gestito, eccezione imprevista |
| `logger.warn` | Condizione anomala ma gestita (rate limit, token riciclato) |
| `logger.info` | Evento di business significativo (login, messaggio inviato) |
| `logger.debug` | Debug in sviluppo (query eseguite, cache hit/miss) |

**Non loggare mai:**
- Password, hash di password
- Refresh token o access token
- URI MongoDB (contengono credenziali)
- Numeri di telefono
- Email (per l'GDPR: loggare solo `user_id`)

---

## 7. Configurazione — Env Validation

Tutte le variabili d'ambiente sono validate all'avvio con Zod. Se una variabile obbligatoria manca, il processo termina con `logger.fatal` prima di accettare traffico.

```typescript
// config/index.ts
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  PORT: z.string().transform(Number).pipe(z.number().min(1).max(65535)),
  MONGODB_URI: z.string().url(),
  UPSTASH_REDIS_URL: z.string().url(),
  UPSTASH_REDIS_TOKEN: z.string().min(1),
  JWT_PRIVATE_KEY: z.string().min(1),    // ES256 private key PEM base64
  JWT_PUBLIC_KEY: z.string().min(1),     // ES256 public key PEM base64
  JWT_ACCESS_TTL_SECONDS: z.string().transform(Number).default('900'),
  JWT_REFRESH_TTL_SECONDS: z.string().transform(Number).default('2592000'),
  R2_ACCOUNT_ID: z.string().min(1),
  R2_ACCESS_KEY_ID: z.string().min(1),
  R2_SECRET_ACCESS_KEY: z.string().min(1),
  R2_BUCKET_NAME: z.string().min(1),
  PHONE_PEPPER: z.string().min(32),
  ALLOWED_ORIGINS: z.string().transform(s => s.split(',')),
  MIN_CLIENT_VERSION: z.string().default('1.0.0'),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  logger.fatal({ errors: parsed.error.flatten() }, 'Invalid environment configuration');
  process.exit(1);
}

export const config = parsed.data;
```

---

## 8. Qualità del Codice

### 8.1 — ESLint (regole obbligatorie)

```json
{
  "extends": ["eslint:recommended", "@typescript-eslint/recommended-strict"],
  "rules": {
    "@typescript-eslint/no-explicit-any": "error",
    "@typescript-eslint/no-floating-promises": "error",
    "@typescript-eslint/explicit-function-return-type": "warn",
    "@typescript-eslint/consistent-type-imports": "error",
    "no-console": "error",
    "no-return-await": "error",
    "prefer-const": "error"
  }
}
```

### 8.2 — Prettier

```json
{
  "singleQuote": true,
  "semi": true,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2
}
```

### 8.3 — Testing

| Tipo | Framework | Coverage minima |
|---|---|---|
| Unit (service, repository) | Vitest | 80% per modulo |
| Integration (endpoint) | Vitest + supertest | Ogni endpoint definito in `06_API.md` |
| E2E (flussi critici) | Playwright | Auth, send message, delete message |

**Regola**: nessun modulo viene dichiarato completo senza i test del proprio service layer.

**Test file convention:**
```
src/services/auth.service.ts          → test/unit/auth.service.test.ts
src/routes/v1/auth.routes.ts          → test/integration/auth.routes.test.ts
```

### 8.4 — Git Commits

Conventional Commits obbligatori:
```
feat(auth): implement register endpoint
fix(messages): handle missing ciphertext gracefully
test(auth): add register service unit tests
docs(api): update error codes table
refactor(users): extract phone hash to crypto util
```

---

## 9. Ordine di Implementazione — Roadmap Backend

L'implementazione segue questo ordine preciso. Nessun modulo inizia prima che il precedente sia testato.

### Fase 0 — Infrastruttura (PRIMA di tutto)
1. `GET /api/v1/health` — server up, dipendenze raggiungibili
2. `GET /api/v1/version` — versione app e build info
3. `GET /api/v1/status` — stato dettagliato di ogni dipendenza

### Fase 1 — Fondamenta
4. Config validation (Zod su process.env)
5. Logger (Pino con redaction)
6. MongoDB connection + graceful shutdown
7. Redis connection
8. Middleware stack (Helmet, CORS, request-id, body-parser, pino-http)
9. Error handler globale
10. AppError + error codes

### Fase 2 — Authentication
11. Models: User, Session
12. Repositories: userRepository, sessionRepository
13. Utils: crypto (Argon2, HMAC, JWT ES256)
14. Service: authService (register, login, refresh, logout)
15. Validator: RegisterSchema, LoginSchema
16. Controller: authController
17. Routes: `POST /api/v1/auth/register`, `POST /api/v1/auth/login`, `POST /api/v1/auth/refresh`, `POST /api/v1/auth/logout`
18. Middleware: requireAuth, requireAdmin

### Fase 3 — Users & Contacts
19. Model: Contact
20. Services: userService, contactService
21. Endpoints: Users + Contacts

### Fase 4 — Messaging Core
22. Models: Conversation, ConversationMember, Message
23. Services: chatService, messageService
24. Endpoints: Chats + Messages
25. WebSocket: ws.server.ts, typing handler, presence handler

### Fase 5 — Signal Protocol
26. Model: UserPrekey
27. Service: prekeyService
28. Endpoints: Devices/prekeys

### Fase 6 — Media
29. Lib: r2.ts
30. Model: Media
31. Service: mediaService + job: media-processing
32. Endpoints: Media

### Fase 7 — Features
33. Message Reactions
34. Delete Message (for_me / for_everyone)
35. Read Receipts
36. Groups
37. Channels

### Fase 8 — Calls & Notifications
38. Lib: daily.ts
39. Service: callService
40. Endpoints: Calls
41. Service: pushService
42. Endpoints: Notifications

### Fase 9 — Admin & Ops
43. Reports
44. Admin endpoints
45. Audit log

---

## 10. Endpoint di Sistema — Specifica

Questi endpoint sono fuori dal prefisso `/api/v1/` — sono infrastrutturali, non di prodotto.

### `GET /api/v1/health`

**Autenticazione:** Nessuna
**Rate Limit:** Nessuno (usato da load balancer e monitoring)
**Cache:** `Cache-Control: no-store`

**Response `200 OK` (tutto sano):**
```json
{
  "status": "ok",
  "timestamp": "2025-07-15T19:30:00.000Z",
  "uptime_seconds": 84729
}
```

**Response `503 Service Unavailable` (dipendenza KO):**
```json
{
  "status": "degraded",
  "timestamp": "2025-07-15T19:30:00.000Z",
  "uptime_seconds": 84729
}
```

> Health check è intenzionalmente minimal — risponde solo se il processo è vivo. Non espone dettagli dipendenze (sicurezza).

---

### `GET /api/v1/version`

**Autenticazione:** Nessuna

**Response `200 OK`:**
```json
{
  "app": "alpha-chat-api",
  "version": "1.0.0",
  "build": "20250715.1",
  "node": "22.4.0",
  "env": "production",
  "api_version": "v1"
}
```

---

### `GET /api/v1/status`

**Autenticazione:** Bearer token (admin)
**Nota:** endpoint protetto — non espone stato infrastruttura a utenti anonimi

**Response `200 OK`:**
```json
{
  "status": "ok",
  "timestamp": "2025-07-15T19:30:00.000Z",
  "uptime_seconds": 84729,
  "dependencies": {
    "mongodb": {
      "status": "ok",
      "latency_ms": 4,
      "connections": 12
    },
    "redis": {
      "status": "ok",
      "latency_ms": 2
    },
    "r2": {
      "status": "ok",
      "latency_ms": 18
    }
  },
  "memory": {
    "rss_mb": 142,
    "heap_used_mb": 87,
    "heap_total_mb": 128
  },
  "version": "1.0.0"
}
```

---

*Alpha Chat Backend Standards v1.0 — Luglio 2025*
*Questo documento è vincolante. Ogni deviazione richiede approvazione esplicita del CTO e aggiornamento di questo documento.*
