/**
 * ConfirmModal — modale di conferma nativa all'app (sostituisce window.confirm).
 * Supporta variante "danger" con pulsante rosso e icona ⚠️.
 */

interface Props {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmModal({
  title, message, confirmLabel = "Conferma", cancelLabel = "Annulla",
  danger = false, loading = false, onConfirm, onCancel,
}: Props) {
  return (
    <div className="confirm-modal-backdrop" onClick={onCancel}>
      <div className="confirm-modal-card" onClick={(e) => e.stopPropagation()}>
        {danger && <div className="confirm-modal-icon">⚠️</div>}
        <h3 className="confirm-modal-title">{title}</h3>
        <p className="confirm-modal-message">{message}</p>
        <div className="confirm-modal-actions">
          <button
            className="confirm-modal-btn confirm-modal-cancel"
            onClick={onCancel}
            disabled={loading}
          >
            {cancelLabel}
          </button>
          <button
            className={`confirm-modal-btn${danger ? " confirm-modal-danger" : " confirm-modal-ok"}`}
            onClick={onConfirm}
            disabled={loading}
          >
            {loading
              ? <span className="confirm-modal-spinner" />
              : confirmLabel
            }
          </button>
        </div>
      </div>
    </div>
  );
}
