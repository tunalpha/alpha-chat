/**
 * UserService — logica di business per profili e discovery utenti.
 *
 * Sprint 5A: User Discovery
 *   - getUserProfile()  → profilo pubblico privacy-aware
 *   - searchUsers()     → ricerca per prefisso username
 *
 * Regole privacy (08_Authentication_Flow.md + user.model.ts):
 *   - show_online_status: "everyone"  → mostra presenza
 *   - show_online_status: "contacts"  → nasconde a non-contatti (tutti per ora)
 *   - show_online_status: "nobody"    → sempre nascosta
 *   - show_last_seen: segue la stessa logica
 *
 * Nota: in Sprint 5A non abbiamo ancora la collection `contacts`.
 * Quindi "contacts" = nessuno (worst-case privacy-safe).
 * In Sprint 5B, dopo contacts, si aggiorna la logica is_contact().
 */

import { AppError } from "../errors/AppError";
import { UserRepository } from "../repositories/user.repository";
import { PresenceModel, type PresenceStatus } from "../models/presence.model";
import { logger } from "../lib/logger";
import type { IUserDocument } from "../models/user.model";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PublicUserProfile {
  id: string;
  username: string;
  display_name: string;
  bio: string | null;
  /** URL avatar — null finché il media service non è implementato (Sprint 7+) */
  avatar_url: string | null;
  is_verified: boolean;
  joined_at: string;
  // Presenza (null = nascosta per privacy)
  online_status: PresenceStatus | null;
  last_seen_at: string | null;
}

export interface SearchUsersResult {
  users: PublicUserProfile[];
  has_more: boolean;
  next_cursor: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const userRepo = new UserRepository();

/**
 * Determina se il viewer può vedere la presenza dell'utente target.
 * Sprint 5A: nessun contatto ancora → solo "everyone" è visibile.
 */
function canViewPresence(
  target: IUserDocument,
  _viewerUserId: string,
): boolean {
  // TODO Sprint 5B: aggiornare con logica is_contact(viewerUserId, target._id)
  return target.privacy.show_online_status === "everyone";
}

function canViewLastSeen(
  target: IUserDocument,
  _viewerUserId: string,
): boolean {
  return target.privacy.show_last_seen === "everyone";
}

/**
 * Formatta il profilo pubblico di un utente (privacy-aware).
 */
async function formatPublicProfile(
  user: IUserDocument,
  viewerUserId: string,
): Promise<PublicUserProfile> {
  // Fetch presenza solo se il viewer può vederla
  let onlineStatus: PresenceStatus | null = null;
  let lastSeenAt: string | null = null;

  if (canViewPresence(user, viewerUserId) || canViewLastSeen(user, viewerUserId)) {
    const presence = await PresenceModel.findOne({ user_id: user._id });

    if (presence) {
      if (canViewPresence(user, viewerUserId)) {
        onlineStatus = presence.status;
      }
      if (canViewLastSeen(user, viewerUserId)) {
        lastSeenAt = presence.last_seen_at.toISOString();
      }
    }
  }

  return {
    id: user._id.toString(),
    username: user.username,
    display_name: user.display_name,
    bio: user.bio,
    avatar_url: null, // TODO Sprint 7: generare URL da avatar_media_id via media service
    is_verified: user.is_verified,
    joined_at: user.createdAt.toISOString(),
    online_status: onlineStatus,
    last_seen_at: lastSeenAt,
  };
}

// ---------------------------------------------------------------------------
// Funzioni pubbliche
// ---------------------------------------------------------------------------

/**
 * Restituisce il profilo pubblico di un utente dato lo username.
 * Rispetta le impostazioni privacy dell'utente target.
 *
 * @throws AppError NOT_FOUND se l'utente non esiste o non è attivo
 */
export async function getUserProfile(
  username: string,
  viewerUserId: string,
): Promise<PublicUserProfile> {
  const user = await userRepo.findByUsername(username);

  if (!user || user.status !== "active") {
    // Non rivelare se l'utente esiste ma è sospeso (privacy)
    throw new AppError("USER_NOT_FOUND", 404);
  }

  logger.debug({ username, viewerUserId }, "User profile fetched");
  return formatPublicProfile(user, viewerUserId);
}

/**
 * Ricerca utenti per prefisso username.
 * Esclude l'utente che fa la ricerca, sospesi e cancellati.
 * Cursor-based pagination (username come cursor).
 */
export async function searchUsers(
  query: string,
  viewerUserId: string,
  options: { limit?: number; cursor?: string } = {},
): Promise<SearchUsersResult> {
  const { limit = 20, cursor } = options;

  // Fetch limit+1 per sapere se c'è una pagina successiva
  const users = await userRepo.searchByUsername(query.toLowerCase().trim(), {
    excludeUserId: viewerUserId,
    limit: limit + 1,
    cursor,
  });

  const hasMore = users.length > limit;
  const slice = hasMore ? users.slice(0, limit) : users;
  const nextCursor = hasMore ? (slice[slice.length - 1]?.username ?? null) : null;

  // Formato pubblico — presenza non inclusa in search (troppo costoso N+1)
  const profiles: PublicUserProfile[] = slice.map((u) => ({
    id: u._id.toString(),
    username: u.username,
    display_name: u.display_name,
    bio: u.bio,
    avatar_url: null,
    is_verified: u.is_verified,
    joined_at: u.createdAt.toISOString(),
    online_status: null, // non recuperato in bulk — solo nel profilo individuale
    last_seen_at: null,
  }));

  logger.debug({ query, resultCount: profiles.length, hasMore }, "User search completed");

  return { users: profiles, has_more: hasMore, next_cursor: nextCursor };
}
