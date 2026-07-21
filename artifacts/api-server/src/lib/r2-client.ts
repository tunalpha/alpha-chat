/**
 * R2 Client — S3Client configurato per Cloudflare R2.
 * Le credenziali vengono lette esclusivamente da variabili d'ambiente.
 * Nessuna credenziale nel codice.
 */

import { S3Client } from "@aws-sdk/client-s3";
import { config } from "../config";
import { logger } from "./logger";

function buildR2Client(): S3Client {
  if (!config.r2.endpoint || !config.r2.accessKeyId || !config.r2.secretAccessKey) {
    logger.warn(
      "R2 non configurato (R2_ENDPOINT / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY mancanti) — " +
      "le operazioni su storage falliranno finché le ENV non sono impostate.",
    );
    // Stub: il client esiste ma ogni operazione solleverà un errore di rete.
    return new S3Client({
      region: "auto",
      endpoint: "https://stub.r2.cloudflarestorage.com",
      credentials: { accessKeyId: "stub", secretAccessKey: "stub" },
    });
  }

  return new S3Client({
    region: "auto",
    endpoint: config.r2.endpoint,
    credentials: {
      accessKeyId:     config.r2.accessKeyId,
      secretAccessKey: config.r2.secretAccessKey,
    },
  });
}

export const r2 = buildR2Client();
