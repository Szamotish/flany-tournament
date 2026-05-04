export const RATING_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

export type RatingCooldownState = "ready" | "soon" | "cooldown";

export type RatingCooldownInfo = {
  canRate: boolean;
  state: RatingCooldownState;
  hoursLeft: number;
  message: string;
};

export function ratingCooldownFromUpdatedAt(updatedAt: string | null | undefined): RatingCooldownInfo {
  if (!updatedAt) {
    return {
      canRate: true,
      state: "ready",
      hoursLeft: 0,
      message: "Mozesz teraz wystawic ocene.",
    };
  }

  const last = new Date(updatedAt).getTime();
  if (!Number.isFinite(last)) {
    return {
      canRate: true,
      state: "ready",
      hoursLeft: 0,
      message: "Mozesz teraz wystawic ocene.",
    };
  }

  const age = Date.now() - last;
  if (age >= RATING_COOLDOWN_MS) {
    return {
      canRate: true,
      state: "ready",
      hoursLeft: 0,
      message: "Mozesz teraz wystawic ocene.",
    };
  }

  const hoursLeft = Math.ceil((RATING_COOLDOWN_MS - age) / (1000 * 60 * 60));
  return {
    canRate: false,
    state: hoursLeft <= 24 ? "soon" : "cooldown",
    hoursLeft,
    message: `Mozesz zmienic ocene za ~${hoursLeft}h`,
  };
}
