import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Con globals:false l'auto-cleanup di testing-library non si attiva:
// senza questo, il DOM del test precedente resta montato e le query
// trovano elementi duplicati.
afterEach(() => cleanup());
