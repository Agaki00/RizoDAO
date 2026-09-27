"use client";
import { useState } from "react";

type FollowButtonProps = {
  /** Email of the currently logged-in user (the one doing the following). */
  viewerEmail: string;
  /** ID of the profile being viewed (the one being followed). */
  targetUserId: string;
  /** Whether the viewer already follows this user, from the initial page load. */
  initialFollowing: boolean;
  /** Called after a successful toggle, so the parent can update counters. */
  onChange?: (following: boolean) => void;
};

/**
 * FollowButton
 *
 * Persists the follow relationship through the real API
 * (`POST` / `DELETE /api/usuarios/[id]/seguir`) instead of localStorage.
 * The UI updates optimistically and rolls back if the request fails.
 */
export default function FollowButton({
  viewerEmail,
  targetUserId,
  initialFollowing,
  onChange,
}: FollowButtonProps) {
  const [following, setFollowing] = useState(initialFollowing);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    if (pending) return;

    // Optimistic update: flip the UI immediately, before the API responds.
    const optimisticNext = !following;
    setFollowing(optimisticNext);
    setPending(true);
    setError(null);

    try {
      const res = await fetch(
        `/api/usuarios/${encodeURIComponent(targetUserId)}/seguir`,
        {
          method: optimisticNext ? "POST" : "DELETE",
          headers: {
            "Content-Type": "application/json",
            "x-user-email": viewerEmail,
          },
          credentials: "same-origin",
        }
      );

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data?.error || "No se pudo actualizar el seguimiento");
      }

      const next =
        typeof data?.isFollowing === "boolean" ? data.isFollowing : optimisticNext;
      setFollowing(next);
      onChange?.(next);
    } catch (err) {
      // Roll back to the previous state if the request fails.
      setFollowing(!optimisticNext);
      setError(err instanceof Error ? err.message : "Error de red");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={handleClick}
        disabled={pending}
        aria-pressed={following}
        aria-busy={pending}
        className="px-5 py-2 rounded-full text-xs font-medium transition-colors disabled:opacity-60"
        style={
          following
            ? {
                backgroundColor: "white",
                color: "#8D6E63",
                border: "1px solid #D7CCC8",
              }
            : {
                backgroundColor: "#8D6E63",
                color: "white",
                border: "1px solid #8D6E63",
              }
        }
      >
        {pending ? "..." : following ? "Siguiendo" : "Seguir"}
      </button>
      {error && (
        <span role="alert" className="text-[10px] text-red-600">
          {error}
        </span>
      )}
    </div>
  );
}
