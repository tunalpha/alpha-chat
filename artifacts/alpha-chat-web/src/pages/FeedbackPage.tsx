import { useState, type FormEvent } from "react";
import {
  apiSubmitUserFeedback,
  type UserFeedbackCategory,
} from "../lib/api";

interface Props {
  onBack: () => void;
}

const categories: Array<{ value: UserFeedbackCategory; label: string; hint: string }> = [
  { value: "problem", label: "Segnala un problema", hint: "Raccontaci cosa non ha funzionato." },
  { value: "transaction", label: "Problema transazione", hint: "Aggiungi l'Exchange ID o l'hash per aiutarci a verificare." },
  { value: "suggestion", label: "Aiutaci a migliorare", hint: "Condividi un'idea o una miglioria per Alpha Chat." },
  { value: "general", label: "Informazioni generali", hint: "Fai una domanda o inviaci una nota generale." },
];

export default function FeedbackPage({ onBack }: Props) {
  const [category, setCategory] = useState<UserFeedbackCategory | "">("");
  const [transactionReference, setTransactionReference] = useState("");
  const [message, setMessage] = useState("");
  const [replyTo, setReplyTo] = useState("");
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const selected = categories.find((item) => item.value === category);
  const isTransaction = category === "transaction";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSent(false);

    if (!category) {
      setError("Seleziona il tipo di segnalazione.");
      return;
    }
    if (isTransaction && transactionReference.trim().length < 3) {
      setError("Inserisci l'Exchange ID o l'hash della transazione.");
      return;
    }
    if (message.trim().length < 10) {
      setError("Descrivi la segnalazione con almeno 10 caratteri.");
      return;
    }

    setIsSubmitting(true);
    try {
      await apiSubmitUserFeedback({
        category,
        message: message.trim(),
        ...(isTransaction ? { transactionReference: transactionReference.trim() } : {}),
        ...(replyTo.trim() ? { replyTo: replyTo.trim() } : {}),
      });
      setCategory("");
      setTransactionReference("");
      setMessage("");
      setReplyTo("");
      setSent(true);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Non è stato possibile inviare la segnalazione. Riprova.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="settings-root feedback-root">
      <header className="settings-header">
        <button className="settings-back-btn" onClick={onBack} aria-label="Indietro">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="20" height="20" aria-hidden="true">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <h1 className="settings-title">Segnala un problema</h1>
      </header>

      <main className="settings-body feedback-body">
        <section className="feedback-intro" aria-labelledby="feedback-title">
          <div className="feedback-intro-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="24" height="24">
              <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z" />
              <path d="M8 11h8M12 7v8" />
            </svg>
          </div>
          <div>
            <h2 id="feedback-title">Come possiamo aiutarti?</h2>
            <p>Invia una segnalazione al team Alpha Chat. Più dettagli ci lasci, più facilmente potremo intervenire.</p>
          </div>
        </section>

        <form className="feedback-form" onSubmit={handleSubmit} noValidate>
          <label className="feedback-field">
            <span>Motivo della segnalazione</span>
            <select
              value={category}
              onChange={(event) => {
                setCategory(event.target.value as UserFeedbackCategory | "");
                setError("");
              }}
              aria-describedby={selected ? "feedback-category-hint" : undefined}
              required
            >
              <option value="" disabled>Seleziona un'opzione</option>
              {categories.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
            {selected && <small id="feedback-category-hint">{selected.hint}</small>}
          </label>

          {isTransaction && (
            <label className="feedback-field">
              <span>Exchange ID o hash della transazione</span>
              <input
                value={transactionReference}
                onChange={(event) => setTransactionReference(event.target.value)}
                placeholder="Es. 0x… oppure ID ChangeNOW"
                maxLength={180}
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                required
              />
              <small>Usalo per farci trovare la transazione più rapidamente.</small>
            </label>
          )}

          <label className="feedback-field">
            <span>Descrivi la segnalazione</span>
            <textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="Spiega cosa è successo, cosa ti aspettavi e quando hai notato il problema."
              rows={6}
              maxLength={4000}
              required
            />
            <small>{message.length}/4000 · Minimo 10 caratteri</small>
          </label>

          <label className="feedback-field">
            <span>E-mail per essere ricontattato <em>(facoltativa)</em></span>
            <input
              type="email"
              value={replyTo}
              onChange={(event) => setReplyTo(event.target.value)}
              placeholder="nome@esempio.com"
              maxLength={254}
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
            />
            <small>La useremo solo per risponderti. Non è obbligatoria.</small>
          </label>

          {error && <div className="feedback-alert feedback-alert--error" role="alert">{error}</div>}
          {sent && <div className="feedback-alert feedback-alert--success" role="status">Segnalazione inviata. Grazie per averci aiutato a migliorare Alpha Chat.</div>}

          <button className="feedback-submit" type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Invio in corso…" : "Invia segnalazione"}
          </button>
        </form>
      </main>
    </div>
  );
}