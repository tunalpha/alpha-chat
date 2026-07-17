/**
 * email-i18n.ts — stringhe per email transazionali in 10 lingue.
 *
 * Lingue supportate: it, en, es, fr, de, pt, ar, ru, zh, ja
 * Fallback: it (default)
 */

export type SupportedLang = "it" | "en" | "es" | "fr" | "de" | "pt" | "ar" | "ru" | "zh" | "ja";

const SUPPORTED: SupportedLang[] = ["it","en","es","fr","de","pt","ar","ru","zh","ja"];

export function resolveLang(lang?: string | null): SupportedLang {
  if (lang && (SUPPORTED as string[]).includes(lang)) return lang as SupportedLang;
  return "it";
}

// RTL languages
const RTL_LANGS: SupportedLang[] = ["ar"];
export function isRTL(lang: SupportedLang): boolean { return RTL_LANGS.includes(lang); }

// ─── Traduzioni ───────────────────────────────────────────────────────────────

interface EmailStrings {
  tagline: string;
  // Phoenix
  phoenixSubject:   (action: string) => string;
  phoenixConfirm:   (action: string) => string;
  phoenixGreeting:  (username: string, action: string) => string;
  phoenixWarnTitle: string;
  phoenixWarnBody:  string;
  phoenixLockTitle: string;
  phoenixLockBody:  string;
  phoenixBtn:       (action: string) => string;
  phoenixExpiry:    (min: number) => string;
  phoenixIgnore:    string;
  // Recovery
  recoverySubject:  string;
  recoveryTitle:    string;
  recoveryGreeting: (username: string) => string;
  recoveryBody:     string;
  recoveryBtn:      string;
  recoveryExpiry:   (min: number) => string;
  recoveryIgnore:   string;
  // DMS Warning
  dmsWarnSubject:   string;
  dmsWarnTitle:     string;
  dmsWarnBody:      (days: number) => string;
  dmsWarnDeadline:  (date: string) => string;
  dmsWarnLogin:     string;
  dmsWarnDisable:   string;
  // DMS Execution
  dmsExecSubject:   string;
  dmsExecBody:      string;
  // Footer
  footer: string;
  autoMessage: string;
}

const T: Record<SupportedLang, EmailStrings> = {
  it: {
    tagline: "Il tuo bunker digitale",
    phoenixSubject:   (a) => `Alpha Chat — Conferma ${a}`,
    phoenixConfirm:   (a) => `Conferma ${a}`,
    phoenixGreeting:  (u,a) => `Ciao <strong>@${u}</strong>, hai avviato la procedura <strong>${a}</strong>.`,
    phoenixWarnTitle: "⚠ Azione irreversibile",
    phoenixWarnBody:  "Il Phoenix Protocol distruggerà permanentemente account, messaggi, media e chiavi crittografiche. Non è possibile annullare dopo la conferma.",
    phoenixLockTitle: "🔒 Emergency Lock",
    phoenixLockBody:  "Tutte le sessioni verranno revocate. L'account rimane intatto e recuperabile.",
    phoenixBtn:       (a) => `Conferma ${a}`,
    phoenixExpiry:    (m) => `Il link scade tra ${m} minuti. Se non hai richiesto questa azione, ignora questa email.`,
    phoenixIgnore:    "Se non hai richiesto questa azione, ignora questa email.",
    recoverySubject:  "Alpha Chat — Recupero account",
    recoveryTitle:    "Recupero account",
    recoveryGreeting: (u) => `Ciao <strong>@${u}</strong>,`,
    recoveryBody:     "Hai richiesto il recupero del tuo account Alpha Chat. Clicca il pulsante qui sotto per accedere con una password temporanea.",
    recoveryBtn:      "Recupera il mio account",
    recoveryExpiry:   (m) => `Il link scade tra ${m} minuti.`,
    recoveryIgnore:   "Se non hai richiesto il recupero, ignora questa email. Il tuo account è al sicuro.",
    dmsWarnSubject:   "⚠️ Alpha Chat — Avviso di inattività",
    dmsWarnTitle:     "⚠️ Dead Man Switch — Avviso di inattività",
    dmsWarnBody:      (d) => `Non rileviamo accessi al tuo account Alpha Chat da più di <strong>${d} giorni</strong>.`,
    dmsWarnDeadline:  (d) => `Hai tempo fino al <strong>${d}</strong> per effettuare l'accesso e annullare l'avviso.`,
    dmsWarnLogin:     "Accedi ad Alpha Chat",
    dmsWarnDisable:   "Se non vuoi ricevere questi avvisi, disattiva il Dead Man Switch nelle impostazioni.",
    dmsExecSubject:   "🔔 Alpha Chat — Dead Man Switch: periodo scaduto",
    dmsExecBody:      "Il periodo del Dead Man Switch è scaduto. Accedi al tuo account Alpha Chat per ripristinare lo stato.",
    footer:           "Alpha Chat · alphachat.sbs",
    autoMessage:      "Questo messaggio è stato generato automaticamente.",
  },

  en: {
    tagline: "Your digital bunker",
    phoenixSubject:   (a) => `Alpha Chat — Confirm ${a}`,
    phoenixConfirm:   (a) => `Confirm ${a}`,
    phoenixGreeting:  (u,a) => `Hi <strong>@${u}</strong>, you started the <strong>${a}</strong> procedure.`,
    phoenixWarnTitle: "⚠ Irreversible action",
    phoenixWarnBody:  "The Phoenix Protocol will permanently destroy your account, messages, media and cryptographic keys. This cannot be undone after confirmation.",
    phoenixLockTitle: "🔒 Emergency Lock",
    phoenixLockBody:  "All sessions will be revoked. Your account remains intact and recoverable.",
    phoenixBtn:       (a) => `Confirm ${a}`,
    phoenixExpiry:    (m) => `This link expires in ${m} minutes. If you did not request this action, ignore this email.`,
    phoenixIgnore:    "If you did not request this action, ignore this email.",
    recoverySubject:  "Alpha Chat — Account recovery",
    recoveryTitle:    "Account recovery",
    recoveryGreeting: (u) => `Hi <strong>@${u}</strong>,`,
    recoveryBody:     "You requested recovery of your Alpha Chat account. Click the button below to sign in with a temporary password.",
    recoveryBtn:      "Recover my account",
    recoveryExpiry:   (m) => `This link expires in ${m} minutes.`,
    recoveryIgnore:   "If you did not request recovery, ignore this email. Your account is safe.",
    dmsWarnSubject:   "⚠️ Alpha Chat — Inactivity warning",
    dmsWarnTitle:     "⚠️ Dead Man Switch — Inactivity warning",
    dmsWarnBody:      (d) => `We have not detected any sign-in to your Alpha Chat account for more than <strong>${d} days</strong>.`,
    dmsWarnDeadline:  (d) => `You have until <strong>${d}</strong> to sign in and cancel the warning.`,
    dmsWarnLogin:     "Sign in to Alpha Chat",
    dmsWarnDisable:   "If you don't want to receive these alerts, disable Dead Man Switch in settings.",
    dmsExecSubject:   "🔔 Alpha Chat — Dead Man Switch: period expired",
    dmsExecBody:      "Your Dead Man Switch period has expired. Sign in to your Alpha Chat account to restore its status.",
    footer:           "Alpha Chat · alphachat.sbs",
    autoMessage:      "This message was generated automatically.",
  },

  es: {
    tagline: "Tu búnker digital",
    phoenixSubject:   (a) => `Alpha Chat — Confirmar ${a}`,
    phoenixConfirm:   (a) => `Confirmar ${a}`,
    phoenixGreeting:  (u,a) => `Hola <strong>@${u}</strong>, iniciaste el procedimiento <strong>${a}</strong>.`,
    phoenixWarnTitle: "⚠ Acción irreversible",
    phoenixWarnBody:  "El Phoenix Protocol destruirá permanentemente tu cuenta, mensajes, archivos y claves criptográficas. No se puede deshacer tras la confirmación.",
    phoenixLockTitle: "🔒 Bloqueo de emergencia",
    phoenixLockBody:  "Todas las sesiones serán revocadas. La cuenta permanece intacta y recuperable.",
    phoenixBtn:       (a) => `Confirmar ${a}`,
    phoenixExpiry:    (m) => `El enlace expira en ${m} minutos. Si no solicitaste esta acción, ignora este correo.`,
    phoenixIgnore:    "Si no solicitaste esta acción, ignora este correo.",
    recoverySubject:  "Alpha Chat — Recuperación de cuenta",
    recoveryTitle:    "Recuperación de cuenta",
    recoveryGreeting: (u) => `Hola <strong>@${u}</strong>,`,
    recoveryBody:     "Solicitaste la recuperación de tu cuenta Alpha Chat. Haz clic en el botón de abajo para iniciar sesión con una contraseña temporal.",
    recoveryBtn:      "Recuperar mi cuenta",
    recoveryExpiry:   (m) => `El enlace expira en ${m} minutos.`,
    recoveryIgnore:   "Si no solicitaste la recuperación, ignora este correo. Tu cuenta está segura.",
    dmsWarnSubject:   "⚠️ Alpha Chat — Aviso de inactividad",
    dmsWarnTitle:     "⚠️ Dead Man Switch — Aviso de inactividad",
    dmsWarnBody:      (d) => `No detectamos accesos a tu cuenta Alpha Chat desde hace más de <strong>${d} días</strong>.`,
    dmsWarnDeadline:  (d) => `Tienes hasta el <strong>${d}</strong> para iniciar sesión y cancelar el aviso.`,
    dmsWarnLogin:     "Acceder a Alpha Chat",
    dmsWarnDisable:   "Si no quieres recibir estos avisos, desactiva el Dead Man Switch en los ajustes.",
    dmsExecSubject:   "🔔 Alpha Chat — Dead Man Switch: período vencido",
    dmsExecBody:      "Tu período del Dead Man Switch ha vencido. Inicia sesión en Alpha Chat para restaurar el estado.",
    footer:           "Alpha Chat · alphachat.sbs",
    autoMessage:      "Este mensaje fue generado automáticamente.",
  },

  fr: {
    tagline: "Votre bunker numérique",
    phoenixSubject:   (a) => `Alpha Chat — Confirmer ${a}`,
    phoenixConfirm:   (a) => `Confirmer ${a}`,
    phoenixGreeting:  (u,a) => `Bonjour <strong>@${u}</strong>, vous avez lancé la procédure <strong>${a}</strong>.`,
    phoenixWarnTitle: "⚠ Action irréversible",
    phoenixWarnBody:  "Le Phoenix Protocol détruira définitivement votre compte, messages, médias et clés cryptographiques. Impossible d'annuler après confirmation.",
    phoenixLockTitle: "🔒 Verrouillage d'urgence",
    phoenixLockBody:  "Toutes les sessions seront révoquées. Le compte reste intact et récupérable.",
    phoenixBtn:       (a) => `Confirmer ${a}`,
    phoenixExpiry:    (m) => `Ce lien expire dans ${m} minutes. Si vous n'avez pas demandé cette action, ignorez cet e-mail.`,
    phoenixIgnore:    "Si vous n'avez pas demandé cette action, ignorez cet e-mail.",
    recoverySubject:  "Alpha Chat — Récupération de compte",
    recoveryTitle:    "Récupération de compte",
    recoveryGreeting: (u) => `Bonjour <strong>@${u}</strong>,`,
    recoveryBody:     "Vous avez demandé la récupération de votre compte Alpha Chat. Cliquez sur le bouton ci-dessous pour vous connecter avec un mot de passe temporaire.",
    recoveryBtn:      "Récupérer mon compte",
    recoveryExpiry:   (m) => `Ce lien expire dans ${m} minutes.`,
    recoveryIgnore:   "Si vous n'avez pas demandé la récupération, ignorez cet e-mail. Votre compte est en sécurité.",
    dmsWarnSubject:   "⚠️ Alpha Chat — Avertissement d'inactivité",
    dmsWarnTitle:     "⚠️ Dead Man Switch — Avertissement d'inactivité",
    dmsWarnBody:      (d) => `Nous n'avons détecté aucune connexion à votre compte Alpha Chat depuis plus de <strong>${d} jours</strong>.`,
    dmsWarnDeadline:  (d) => `Vous avez jusqu'au <strong>${d}</strong> pour vous connecter et annuler l'avertissement.`,
    dmsWarnLogin:     "Se connecter à Alpha Chat",
    dmsWarnDisable:   "Si vous ne voulez pas recevoir ces alertes, désactivez le Dead Man Switch dans les paramètres.",
    dmsExecSubject:   "🔔 Alpha Chat — Dead Man Switch : période expirée",
    dmsExecBody:      "Votre période Dead Man Switch a expiré. Connectez-vous à Alpha Chat pour restaurer l'état du compte.",
    footer:           "Alpha Chat · alphachat.sbs",
    autoMessage:      "Ce message a été généré automatiquement.",
  },

  de: {
    tagline: "Ihr digitaler Bunker",
    phoenixSubject:   (a) => `Alpha Chat — ${a} bestätigen`,
    phoenixConfirm:   (a) => `${a} bestätigen`,
    phoenixGreeting:  (u,a) => `Hallo <strong>@${u}</strong>, Sie haben das Verfahren <strong>${a}</strong> gestartet.`,
    phoenixWarnTitle: "⚠ Unwiderrufliche Aktion",
    phoenixWarnBody:  "Das Phoenix Protocol löscht dauerhaft Ihr Konto, Nachrichten, Medien und kryptografische Schlüssel. Dies kann nach der Bestätigung nicht rückgängig gemacht werden.",
    phoenixLockTitle: "🔒 Notfallsperre",
    phoenixLockBody:  "Alle Sitzungen werden widerrufen. Das Konto bleibt intakt und wiederherstellbar.",
    phoenixBtn:       (a) => `${a} bestätigen`,
    phoenixExpiry:    (m) => `Dieser Link läuft in ${m} Minuten ab. Wenn Sie diese Aktion nicht angefordert haben, ignorieren Sie diese E-Mail.`,
    phoenixIgnore:    "Wenn Sie diese Aktion nicht angefordert haben, ignorieren Sie diese E-Mail.",
    recoverySubject:  "Alpha Chat — Kontowiederherstellung",
    recoveryTitle:    "Kontowiederherstellung",
    recoveryGreeting: (u) => `Hallo <strong>@${u}</strong>,`,
    recoveryBody:     "Sie haben die Wiederherstellung Ihres Alpha Chat-Kontos angefordert. Klicken Sie auf die Schaltfläche unten, um sich mit einem temporären Passwort anzumelden.",
    recoveryBtn:      "Mein Konto wiederherstellen",
    recoveryExpiry:   (m) => `Dieser Link läuft in ${m} Minuten ab.`,
    recoveryIgnore:   "Wenn Sie keine Wiederherstellung angefordert haben, ignorieren Sie diese E-Mail. Ihr Konto ist sicher.",
    dmsWarnSubject:   "⚠️ Alpha Chat — Inaktivitätswarnung",
    dmsWarnTitle:     "⚠️ Dead Man Switch — Inaktivitätswarnung",
    dmsWarnBody:      (d) => `Wir haben seit mehr als <strong>${d} Tagen</strong> keine Anmeldung bei Ihrem Alpha Chat-Konto festgestellt.`,
    dmsWarnDeadline:  (d) => `Sie haben bis zum <strong>${d}</strong> Zeit, sich anzumelden und die Warnung aufzuheben.`,
    dmsWarnLogin:     "Bei Alpha Chat anmelden",
    dmsWarnDisable:   "Wenn Sie keine weiteren Warnungen erhalten möchten, deaktivieren Sie den Dead Man Switch in den Einstellungen.",
    dmsExecSubject:   "🔔 Alpha Chat — Dead Man Switch: Zeitraum abgelaufen",
    dmsExecBody:      "Ihr Dead Man Switch-Zeitraum ist abgelaufen. Melden Sie sich bei Alpha Chat an, um den Kontostatus wiederherzustellen.",
    footer:           "Alpha Chat · alphachat.sbs",
    autoMessage:      "Diese Nachricht wurde automatisch generiert.",
  },

  pt: {
    tagline: "O seu bunker digital",
    phoenixSubject:   (a) => `Alpha Chat — Confirmar ${a}`,
    phoenixConfirm:   (a) => `Confirmar ${a}`,
    phoenixGreeting:  (u,a) => `Olá <strong>@${u}</strong>, iniciou o procedimento <strong>${a}</strong>.`,
    phoenixWarnTitle: "⚠ Ação irreversível",
    phoenixWarnBody:  "O Phoenix Protocol destruirá permanentemente a sua conta, mensagens, mídia e chaves criptográficas. Não é possível desfazer após a confirmação.",
    phoenixLockTitle: "🔒 Bloqueio de emergência",
    phoenixLockBody:  "Todas as sessões serão revogadas. A conta permanece intacta e recuperável.",
    phoenixBtn:       (a) => `Confirmar ${a}`,
    phoenixExpiry:    (m) => `Este link expira em ${m} minutos. Se não solicitou esta ação, ignore este e-mail.`,
    phoenixIgnore:    "Se não solicitou esta ação, ignore este e-mail.",
    recoverySubject:  "Alpha Chat — Recuperação de conta",
    recoveryTitle:    "Recuperação de conta",
    recoveryGreeting: (u) => `Olá <strong>@${u}</strong>,`,
    recoveryBody:     "Solicitou a recuperação da sua conta Alpha Chat. Clique no botão abaixo para iniciar sessão com uma palavra-passe temporária.",
    recoveryBtn:      "Recuperar a minha conta",
    recoveryExpiry:   (m) => `Este link expira em ${m} minutos.`,
    recoveryIgnore:   "Se não solicitou a recuperação, ignore este e-mail. A sua conta está segura.",
    dmsWarnSubject:   "⚠️ Alpha Chat — Aviso de inatividade",
    dmsWarnTitle:     "⚠️ Dead Man Switch — Aviso de inatividade",
    dmsWarnBody:      (d) => `Não detetámos acessos à sua conta Alpha Chat há mais de <strong>${d} dias</strong>.`,
    dmsWarnDeadline:  (d) => `Tem até <strong>${d}</strong> para iniciar sessão e cancelar o aviso.`,
    dmsWarnLogin:     "Aceder ao Alpha Chat",
    dmsWarnDisable:   "Se não quiser receber estes avisos, desative o Dead Man Switch nas definições.",
    dmsExecSubject:   "🔔 Alpha Chat — Dead Man Switch: período expirado",
    dmsExecBody:      "O período do seu Dead Man Switch expirou. Inicie sessão no Alpha Chat para restaurar o estado da conta.",
    footer:           "Alpha Chat · alphachat.sbs",
    autoMessage:      "Esta mensagem foi gerada automaticamente.",
  },

  ar: {
    tagline: "ملجأك الرقمي",
    phoenixSubject:   (a) => `Alpha Chat — تأكيد ${a}`,
    phoenixConfirm:   (a) => `تأكيد ${a}`,
    phoenixGreeting:  (u,a) => `مرحباً <strong>@${u}</strong>، لقد بدأت إجراء <strong>${a}</strong>.`,
    phoenixWarnTitle: "⚠ إجراء لا يمكن التراجع عنه",
    phoenixWarnBody:  "سيؤدي بروتوكول Phoenix إلى حذف حسابك ورسائلك ووسائطك ومفاتيحك التشفيرية بشكل دائم. لا يمكن التراجع بعد التأكيد.",
    phoenixLockTitle: "🔒 القفل الطارئ",
    phoenixLockBody:  "ستُلغى جميع الجلسات. يبقى الحساب سليماً وقابلاً للاسترداد.",
    phoenixBtn:       (a) => `تأكيد ${a}`,
    phoenixExpiry:    (m) => `تنتهي صلاحية الرابط خلال ${m} دقيقة. إذا لم تطلب هذا الإجراء، تجاهل هذا البريد الإلكتروني.`,
    phoenixIgnore:    "إذا لم تطلب هذا الإجراء، تجاهل هذا البريد الإلكتروني.",
    recoverySubject:  "Alpha Chat — استرداد الحساب",
    recoveryTitle:    "استرداد الحساب",
    recoveryGreeting: (u) => `مرحباً <strong>@${u}</strong>،`,
    recoveryBody:     "لقد طلبت استرداد حساب Alpha Chat الخاص بك. انقر على الزر أدناه لتسجيل الدخول بكلمة مرور مؤقتة.",
    recoveryBtn:      "استرداد حسابي",
    recoveryExpiry:   (m) => `تنتهي صلاحية الرابط خلال ${m} دقيقة.`,
    recoveryIgnore:   "إذا لم تطلب الاسترداد، تجاهل هذا البريد الإلكتروني. حسابك بأمان.",
    dmsWarnSubject:   "⚠️ Alpha Chat — تحذير من عدم النشاط",
    dmsWarnTitle:     "⚠️ Dead Man Switch — تحذير من عدم النشاط",
    dmsWarnBody:      (d) => `لم نرصد أي تسجيل دخول إلى حسابك في Alpha Chat منذ أكثر من <strong>${d} أيام</strong>.`,
    dmsWarnDeadline:  (d) => `لديك حتى <strong>${d}</strong> لتسجيل الدخول وإلغاء التحذير.`,
    dmsWarnLogin:     "تسجيل الدخول إلى Alpha Chat",
    dmsWarnDisable:   "إذا لم تكن تريد تلقي هذه التنبيهات، قم بتعطيل Dead Man Switch في الإعدادات.",
    dmsExecSubject:   "🔔 Alpha Chat — Dead Man Switch: انتهت المدة",
    dmsExecBody:      "انتهت مدة Dead Man Switch الخاصة بك. سجّل الدخول إلى Alpha Chat لاستعادة حالة الحساب.",
    footer:           "Alpha Chat · alphachat.sbs",
    autoMessage:      "تم إنشاء هذه الرسالة تلقائياً.",
  },

  ru: {
    tagline: "Ваш цифровой бункер",
    phoenixSubject:   (a) => `Alpha Chat — Подтвердить ${a}`,
    phoenixConfirm:   (a) => `Подтвердить ${a}`,
    phoenixGreeting:  (u,a) => `Здравствуйте, <strong>@${u}</strong>! Вы запустили процедуру <strong>${a}</strong>.`,
    phoenixWarnTitle: "⚠ Необратимое действие",
    phoenixWarnBody:  "Phoenix Protocol навсегда удалит ваш аккаунт, сообщения, медиафайлы и криптографические ключи. После подтверждения это действие нельзя отменить.",
    phoenixLockTitle: "🔒 Аварийная блокировка",
    phoenixLockBody:  "Все сессии будут отозваны. Аккаунт останется нетронутым и доступным для восстановления.",
    phoenixBtn:       (a) => `Подтвердить ${a}`,
    phoenixExpiry:    (m) => `Срок действия ссылки истечёт через ${m} минут. Если вы не запрашивали это действие, проигнорируйте письмо.`,
    phoenixIgnore:    "Если вы не запрашивали это действие, проигнорируйте письмо.",
    recoverySubject:  "Alpha Chat — Восстановление аккаунта",
    recoveryTitle:    "Восстановление аккаунта",
    recoveryGreeting: (u) => `Здравствуйте, <strong>@${u}</strong>!`,
    recoveryBody:     "Вы запросили восстановление аккаунта Alpha Chat. Нажмите кнопку ниже, чтобы войти с временным паролем.",
    recoveryBtn:      "Восстановить мой аккаунт",
    recoveryExpiry:   (m) => `Срок действия ссылки истечёт через ${m} минут.`,
    recoveryIgnore:   "Если вы не запрашивали восстановление, проигнорируйте это письмо. Ваш аккаунт в безопасности.",
    dmsWarnSubject:   "⚠️ Alpha Chat — Предупреждение о неактивности",
    dmsWarnTitle:     "⚠️ Dead Man Switch — Предупреждение о неактивности",
    dmsWarnBody:      (d) => `Мы не фиксировали входов в ваш аккаунт Alpha Chat более <strong>${d} дней</strong>.`,
    dmsWarnDeadline:  (d) => `У вас есть время до <strong>${d}</strong>, чтобы войти и отменить предупреждение.`,
    dmsWarnLogin:     "Войти в Alpha Chat",
    dmsWarnDisable:   "Если вы не хотите получать такие предупреждения, отключите Dead Man Switch в настройках.",
    dmsExecSubject:   "🔔 Alpha Chat — Dead Man Switch: период истёк",
    dmsExecBody:      "Период Dead Man Switch истёк. Войдите в Alpha Chat, чтобы восстановить статус аккаунта.",
    footer:           "Alpha Chat · alphachat.sbs",
    autoMessage:      "Это сообщение сгенерировано автоматически.",
  },

  zh: {
    tagline: "您的数字避难所",
    phoenixSubject:   (a) => `Alpha Chat — 确认${a}`,
    phoenixConfirm:   (a) => `确认${a}`,
    phoenixGreeting:  (u,a) => `您好 <strong>@${u}</strong>，您已启动 <strong>${a}</strong> 流程。`,
    phoenixWarnTitle: "⚠ 不可撤销的操作",
    phoenixWarnBody:  "Phoenix Protocol 将永久删除您的账户、消息、媒体文件和加密密钥。确认后无法撤销。",
    phoenixLockTitle: "🔒 紧急锁定",
    phoenixLockBody:  "所有会话将被吊销。账户保持完整，可以恢复。",
    phoenixBtn:       (a) => `确认${a}`,
    phoenixExpiry:    (m) => `此链接将在 ${m} 分钟后失效。如果您未请求此操作，请忽略此邮件。`,
    phoenixIgnore:    "如果您未请求此操作，请忽略此邮件。",
    recoverySubject:  "Alpha Chat — 账户恢复",
    recoveryTitle:    "账户恢复",
    recoveryGreeting: (u) => `您好 <strong>@${u}</strong>，`,
    recoveryBody:     "您已请求恢复 Alpha Chat 账户。点击下方按钮使用临时密码登录。",
    recoveryBtn:      "恢复我的账户",
    recoveryExpiry:   (m) => `此链接将在 ${m} 分钟后失效。`,
    recoveryIgnore:   "如果您未请求恢复，请忽略此邮件。您的账户是安全的。",
    dmsWarnSubject:   "⚠️ Alpha Chat — 不活跃警告",
    dmsWarnTitle:     "⚠️ Dead Man Switch — 不活跃警告",
    dmsWarnBody:      (d) => `我们超过 <strong>${d} 天</strong>未检测到您的 Alpha Chat 账户有任何登录记录。`,
    dmsWarnDeadline:  (d) => `您需在 <strong>${d}</strong> 之前登录以取消警告。`,
    dmsWarnLogin:     "登录 Alpha Chat",
    dmsWarnDisable:   "如果您不想收到这些提醒，请在设置中关闭 Dead Man Switch。",
    dmsExecSubject:   "🔔 Alpha Chat — Dead Man Switch：期限已到",
    dmsExecBody:      "您的 Dead Man Switch 期限已到。请登录 Alpha Chat 以恢复账户状态。",
    footer:           "Alpha Chat · alphachat.sbs",
    autoMessage:      "此消息由系统自动生成。",
  },

  ja: {
    tagline: "あなたのデジタルバンカー",
    phoenixSubject:   (a) => `Alpha Chat — ${a}の確認`,
    phoenixConfirm:   (a) => `${a}を確認する`,
    phoenixGreeting:  (u,a) => `<strong>@${u}</strong>さん、<strong>${a}</strong>の手順を開始しました。`,
    phoenixWarnTitle: "⚠ 取り消せない操作",
    phoenixWarnBody:  "Phoenix Protocol を実行すると、アカウント、メッセージ、メディア、暗号鍵が完全に削除されます。確認後は元に戻せません。",
    phoenixLockTitle: "🔒 緊急ロック",
    phoenixLockBody:  "すべてのセッションが取り消されます。アカウントは無傷のまま復元可能です。",
    phoenixBtn:       (a) => `${a}を確認する`,
    phoenixExpiry:    (m) => `このリンクは ${m} 分後に失効します。この操作をリクエストしていない場合は、このメールを無視してください。`,
    phoenixIgnore:    "この操作をリクエストしていない場合は、このメールを無視してください。",
    recoverySubject:  "Alpha Chat — アカウントの回復",
    recoveryTitle:    "アカウントの回復",
    recoveryGreeting: (u) => `<strong>@${u}</strong>さん、`,
    recoveryBody:     "Alpha Chat アカウントの回復をリクエストしました。下のボタンをクリックして、一時パスワードでサインインしてください。",
    recoveryBtn:      "アカウントを回復する",
    recoveryExpiry:   (m) => `このリンクは ${m} 分後に失効します。`,
    recoveryIgnore:   "回復をリクエストしていない場合は、このメールを無視してください。アカウントは安全です。",
    dmsWarnSubject:   "⚠️ Alpha Chat — 非アクティブの警告",
    dmsWarnTitle:     "⚠️ Dead Man Switch — 非アクティブの警告",
    dmsWarnBody:      (d) => `<strong>${d}日</strong>以上、Alpha Chat アカウントへのサインインが検出されていません。`,
    dmsWarnDeadline:  (d) => `<strong>${d}</strong>までにサインインして警告をキャンセルしてください。`,
    dmsWarnLogin:     "Alpha Chat にサインイン",
    dmsWarnDisable:   "このような警告を受け取りたくない場合は、設定で Dead Man Switch を無効にしてください。",
    dmsExecSubject:   "🔔 Alpha Chat — Dead Man Switch：期限切れ",
    dmsExecBody:      "Dead Man Switch の期限が切れました。Alpha Chat にサインインしてアカウントの状態を復元してください。",
    footer:           "Alpha Chat · alphachat.sbs",
    autoMessage:      "このメッセージは自動的に生成されました。",
  },
};

export function getEmailStrings(lang?: string | null): EmailStrings {
  return T[resolveLang(lang)];
}

// ─── Wrapper HTML condiviso ────────────────────────────────────────────────────

export function wrapEmailHtml(opts: {
  lang: SupportedLang;
  title: string;
  body: string;
}): string {
  const dir = isRTL(opts.lang) ? "rtl" : "ltr";
  return `<!DOCTYPE html>
<html lang="${opts.lang}" dir="${dir}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${opts.title}</title>
</head>
<body style="background:#0F0A1E;color:#F1F0F5;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;margin:0;padding:32px;direction:${dir};">
  <div style="max-width:480px;margin:0 auto;">
    <div style="text-align:center;margin-bottom:32px;">
      <div style="font-size:32px;font-weight:700;color:#a855f7;">α Alpha Chat</div>
      <div style="font-size:13px;color:#888;letter-spacing:2px;text-transform:uppercase;margin-top:4px;">
        ${getEmailStrings(opts.lang).tagline}
      </div>
    </div>
    ${opts.body}
    <p style="color:#444;font-size:11px;text-align:center;margin:24px 0 0;">
      ${getEmailStrings(opts.lang).footer} · ${getEmailStrings(opts.lang).autoMessage}
    </p>
  </div>
</body>
</html>`;
}
