import type { ClientPlatform } from './brand.js';
import type { PermissionKey, RoleKey } from './roles.js';

/** Sunucudan dönen hata kodları. İstemci, kullanıcı mesajını sunucudan gelen message alanından gösterir. */
export const ERROR_CODES = [
  'VALIDATION_ERROR',
  'WEAK_PASSWORD',
  'USERNAME_TAKEN',
  'INVALID_CREDENTIALS',
  'ACCOUNT_SUSPENDED',
  'ACCOUNT_BANNED',
  'ACCOUNT_LOCKED',
  'EMAIL_NOT_VERIFIED',
  'INVALID_TOKEN',
  'TOKEN_EXPIRED',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'CSRF_FAILED',
  'ORIGIN_NOT_ALLOWED',
  'RATE_LIMITED',
  'NOT_FOUND',
  'REGISTRATION_CLOSED',
  'UNSUPPORTED_MEDIA_TYPE',
  'PILOT_EXISTS',
  'PILOT_NOT_FOUND',
  'SERVER_CLOSED',
  'SAME_COMPANY',
  'COMPANY_CHANGE_COOLDOWN',
  'INSUFFICIENT_FUNDS',
  'ITEM_NOT_FOUND',
  'SHIP_NOT_FOUND',
  'SLOT_INCOMPATIBLE',
  'SLOT_UNAVAILABLE',
  'LEVEL_TOO_LOW',
  'SHIP_OWNED',
  'ITEM_IN_USE',
  'ITEM_ON_OTHER_SHIP',
  'NOT_SELLABLE',
  'MAX_UPGRADE',
  'NOT_UPGRADABLE',
  'SHIP_NOT_DAMAGED',
  'OFFER_UNAVAILABLE',
  'PURCHASE_LIMIT',
  'INVENTORY_FULL',
  'PET_REQUIRED',
  'PORTAL_NOT_FOUND',
  'TOO_FAR_FROM_PORTAL',
  'MAP_LOCKED',
  'MAP_CLOSED',
  'GAME_UNAVAILABLE',
  'NOT_IN_STATION',
  'QUEST_NOT_FOUND',
  'QUEST_UNAVAILABLE',
  'QUEST_LIMIT',
  'QUEST_NOT_ACTIVE',
  'QUEST_NOT_COMPLETED',
  'REROLL_LIMIT',
  'RECIPE_NOT_FOUND',
  'INSUFFICIENT_RESOURCES',
  'CRAFT_SLOTS_FULL',
  'CRAFT_NOT_READY',
  'AUCTION_NOT_FOUND',
  'AUCTION_CLOSED',
  'BID_TOO_LOW',
  'CLAN_NOT_FOUND',
  'CLAN_EXISTS',
  'ALREADY_IN_CLAN',
  'NOT_IN_CLAN',
  'CLAN_FULL',
  'CLAN_PERMISSION',
  'CLAN_NOT_RECRUITING',
  'APPLICATION_EXISTS',
  'INVITATION_NOT_FOUND',
  'DIPLOMACY_EXISTS',
  'DIPLOMACY_NOT_FOUND',
  'FRIEND_EXISTS',
  'FRIEND_LIMIT',
  'BLOCKED',
  'NOT_ALLOWED',
  'REPORT_EXISTS',
  'INTERNAL_ERROR',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    /** Alan bazlı doğrulama hataları (form alanlarının altında gösterilir). */
    fields?: Record<string, string[]>;
    /** RATE_LIMITED için kaç saniye sonra tekrar denenebileceği. */
    retryAfterSeconds?: number;
  };
}

export interface PublicUser {
  id: string;
  /** Oyuncuya gösterilen sayısal Oyuncu ID. */
  playerId: number;
  username: string;
  email: string;
  emailVerified: boolean;
  status: 'active' | 'suspended' | 'banned' | 'deleted';
  roles: RoleKey[];
  createdAt: string;
}

export interface MeResponse {
  user: PublicUser;
  /** Sunucuda hesaplanan etkin yetkiler (yalnızca arayüz gösterimi için; asıl kontrol sunucudadır). */
  permissions: PermissionKey[];
  /** Çerez tabanlı oturumlarda durum değiştiren isteklerde X-CSRF-Token başlığına konur. */
  csrfToken: string | null;
  session: { id: string; platform: ClientPlatform; expiresAt: string };
}

export interface LoginResponse extends MeResponse {
  /** Sadece transport=token seçildiğinde döner (mobil/masaüstü uygulamalar). */
  sessionToken?: string;
  suspicious: boolean;
}

export interface SessionInfo {
  id: string;
  platform: ClientPlatform;
  deviceName: string | null;
  browser: string | null;
  os: string | null;
  ipMasked: string | null;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  current: boolean;
}

export interface LoginHistoryEntry {
  id: string;
  success: boolean;
  failureReason: string | null;
  platform: ClientPlatform;
  browser: string | null;
  os: string | null;
  ipMasked: string | null;
  suspicious: boolean;
  suspiciousReasons: string[];
  createdAt: string;
}
