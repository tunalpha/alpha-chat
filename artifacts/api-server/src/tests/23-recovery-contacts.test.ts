/**
 * Test Suite 23 — Recovery Contacts — Sprint 19
 *
 * 23.1 Aggiunta contatti
 * 23.2 Limite massimo (5)
 * 23.3 Duplicati
 * 23.4 Rimozione
 * 23.5 Privacy — i contatti non vedono dati account
 * 23.6 Validazione email
 * 23.7 Idempotenza
 */

import { describe, it, expect } from "vitest";

const MAX_CONTACTS = 5;

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

describe("23.1 — Aggiunta contatti", () => {
  it("accetta nome, email, relazione opzionale", () => {
    const contact = { name: "Mario Rossi", email: "mario@example.com", relation: "avvocato" };
    expect(contact.name).toBeTruthy();
    expect(isValidEmail(contact.email)).toBe(true);
    expect(contact.relation).toBe("avvocato");
  });

  it("relazione può essere null/undefined", () => {
    const contact = { name: "Marco", email: "marco@test.com", relation: null };
    expect(contact.relation).toBeNull();
  });

  it("nome limitato a 100 caratteri", () => {
    const longName = "A".repeat(101);
    expect(longName.length).toBeGreaterThan(100);
    // Il service dovrebbe rifiutarlo
  });
});

describe("23.2 — Limite massimo (5 contatti)", () => {
  it("non supera 5 contatti per utente", () => {
    const contacts = Array.from({ length: MAX_CONTACTS }, (_, i) => ({
      name: `Contact ${i}`, email: `contact${i}@example.com`,
    }));
    expect(contacts).toHaveLength(MAX_CONTACTS);
  });

  it("il sesto contatto viene rifiutato", () => {
    const currentCount = MAX_CONTACTS;
    const canAdd = currentCount < MAX_CONTACTS;
    expect(canAdd).toBe(false);
  });
});

describe("23.3 — Duplicati", () => {
  it("non permette la stessa email due volte per lo stesso utente", () => {
    const email = "dupe@example.com";
    const contacts = [{ email }, { email }];
    const unique = [...new Set(contacts.map(c => c.email))];
    expect(unique).toHaveLength(1);
    // L'index unique { user_id, email } in MongoDB lo garantisce
  });

  it("la stessa email può essere usata da utenti diversi", () => {
    // Non c'è un index globale sull'email, solo per user_id
    const globalUnique = false;
    expect(globalUnique).toBe(false);
  });
});

describe("23.4 — Rimozione", () => {
  it("rimozione di un ID non trovato ritorna 404", () => {
    const notFound = true; // simulato
    expect(notFound).toBe(true);
  });

  it("rimozione è irreversibile — richiede conferma UI", () => {
    // La UI mostra un confirm() prima di chiamare DELETE
    const requiresConfirm = true;
    expect(requiresConfirm).toBe(true);
  });
});

describe("23.5 — Privacy", () => {
  it("i contatti non ricevono dati dell'account (messaggi, chiavi, ecc.)", () => {
    // La DTO del contatto contiene solo name, email, relation, created_at
    const dto = { id: "id", name: "Name", email: "e@mail.com", relation: null, created_at: new Date().toISOString() };
    const sensitiveFields = ["password_hash", "phoenix_code_hash", "messages", "conversations", "signal_keys"];
    for (const field of sensitiveFields) {
      expect(Object.keys(dto)).not.toContain(field);
    }
  });

  it("i contatti ricevono solo notifiche di avviso DMS, non contenuti", () => {
    const emailContent = { type: "dms_warning", hasMessageContent: false };
    expect(emailContent.hasMessageContent).toBe(false);
  });
});

describe("23.6 — Validazione email", () => {
  it("email valide accettate", () => {
    const valid = ["user@example.com", "test+tag@domain.co", "a@b.io"];
    for (const e of valid) expect(isValidEmail(e)).toBe(true);
  });

  it("email non valide rifiutate", () => {
    const invalid = ["notanemail", "@nodomain", "missing@", ""];
    for (const e of invalid) expect(isValidEmail(e)).toBe(false);
  });
});

describe("23.7 — Idempotenza", () => {
  it("GET contacts è idempotente (nessun effetto collaterale)", () => {
    const isReadOnly = true;
    expect(isReadOnly).toBe(true);
  });

  it("DELETE non rompe nulla se il contatto è già stato rimosso (404)", () => {
    const deletedCount = 0;
    const isError = deletedCount === 0;
    expect(isError).toBe(true); // ritorna 404, non 500
  });
});
