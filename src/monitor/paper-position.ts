import type { InstrumentSnapshot } from "@/src/domain/stored-strategy";

export type PaperPositionLeg = "WAITING" | "LONG_PRIMARY" | "LONG_HEDGE";

export interface PaperAction {
  side: "BUY" | "SELL";
  instrument: InstrumentSnapshot;
}

export interface PaperTransitionPlan {
  nextLeg: PaperPositionLeg;
  actions: PaperAction[];
}

export function planPaperTransition(
  currentLeg: PaperPositionLeg,
  signal: "BUY" | "SELL",
  primary: InstrumentSnapshot,
  hedge?: InstrumentSnapshot,
  heldInstrument?: InstrumentSnapshot,
): PaperTransitionPlan {
  if (signal === "BUY") {
    if (
      currentLeg === "LONG_PRIMARY" &&
      (!heldInstrument || heldInstrument.instrumentId === primary.instrumentId)
    ) {
      return { nextLeg: currentLeg, actions: [] };
    }
    const held =
      heldInstrument ??
      (currentLeg === "LONG_HEDGE" ? hedge : currentLeg === "LONG_PRIMARY" ? primary : undefined);
    return {
      nextLeg: "LONG_PRIMARY",
      actions: [
        ...(held ? [{ side: "SELL" as const, instrument: held }] : []),
        { side: "BUY", instrument: primary },
      ],
    };
  }

  if (hedge) {
    const held =
      heldInstrument ??
      (currentLeg === "LONG_PRIMARY" ? primary : currentLeg === "LONG_HEDGE" ? hedge : undefined);
    if (currentLeg === "LONG_HEDGE" && held?.instrumentId === hedge.instrumentId) {
      return { nextLeg: currentLeg, actions: [] };
    }
    return {
      nextLeg: "LONG_HEDGE",
      actions: [
        ...(held ? [{ side: "SELL" as const, instrument: held }] : []),
        { side: "BUY", instrument: hedge },
      ],
    };
  }

  if (currentLeg === "WAITING") {
    return { nextLeg: "WAITING", actions: [{ side: "SELL", instrument: primary }] };
  }
  return {
    nextLeg: "WAITING",
    actions: [{ side: "SELL", instrument: heldInstrument ?? primary }],
  };
}
