/**
 * guestCurlProfile.ts
 *
 * Utilities for persisting a guest user's curl profile quiz results in
 * localStorage until they register or log in, at which point the data is
 * migrated to their database account.
 */

export const GUEST_PROFILE_KEY = "rizo_guest_profile";

/** Where the wallet signature-challenge bearer token is cached client-side. */
export const WALLET_TOKEN_STORAGE_KEY = "rizo_wallet_token";

export type GuestCurlProfile = {
  rol: string;
  tipoCabello: string;
  nombre: string;
  bio: string;
};

/** Save a guest profile to localStorage. */
export function saveGuestProfile(profile: GuestCurlProfile): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(GUEST_PROFILE_KEY, JSON.stringify(profile));
}

/** Read the guest profile from localStorage, or null if not present. */
export function getGuestProfile(): GuestCurlProfile | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(GUEST_PROFILE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as GuestCurlProfile;
  } catch {
    return null;
  }
}

/** Remove the guest profile from localStorage (called after migration). */
export function clearGuestProfile(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(GUEST_PROFILE_KEY);
}

function readWalletToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(WALLET_TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * Migrate the guest profile to the user's database account.
 *
 * The client no longer sends an identity: /api/user/update resolves it on the
 * server from the NextAuth session cookie, or from the `Authorization: Bearer`
 * token that wallet-only users receive from /api/auth/wallet/verify (stored
 * under WALLET_TOKEN_STORAGE_KEY).
 *
 * @returns true if migrated, false if there was nothing to migrate or it failed
 */
export async function migrateGuestProfile(): Promise<boolean> {
  const profile = getGuestProfile();
  if (!profile) return false;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const walletToken = readWalletToken();
  if (walletToken) headers.Authorization = `Bearer ${walletToken}`;

  try {
    const res = await fetch("/api/user/update", {
      method: "POST",
      headers,
      credentials: "include",
      body: JSON.stringify({
        nombre: profile.nombre,
        bio: profile.bio,
        rol: profile.rol,
        tipoCabello: profile.tipoCabello,
      }),
    });

    if (res.ok) {
      clearGuestProfile();
      return true;
    }
    return false;
  } catch {
    return false;
  }
}
