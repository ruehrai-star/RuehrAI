export const RECOMMENDATIONS_NOT_FOUND =
  "Es liegen noch keine Empfehlungen vor. Bitte zuerst Empfehlungen berechnen.";

export const RECOMMENDATIONS_NOT_STORED =
  "Die Empfehlungen konnten nicht gespeichert werden.";

const NO_DIRECTION =
  "Das gespeicherte Muster enthält keine zeitliche Richtung. Ohne belegte Richtung lässt sich keine positive Entwicklung in den letzten sechs Monaten ausweisen.";

const NO_FACTS =
  "In der Zielregion wurden für die letzten sechs Monate keine Brain-Fakten gefunden.";

const NO_POSITIVE =
  "Keine passenden Standorte in der Zielregion. Das Muster hat sich dort in den letzten sechs Monaten nicht positiv entwickelt.";

const TRUNCATED =
  "Die Brain-Abfrage hat das Zeilenlimit erreicht. Die Rangliste kann unvollständig sein.";

export function recommendationReason(input: {
  hasDirection: boolean;
  factCount: number;
  positiveCount: number;
  truncated: boolean;
}): string | null {
  let reason: string | null = null;
  if (!input.hasDirection) {
    reason = NO_DIRECTION;
  } else if (input.factCount === 0) {
    reason = NO_FACTS;
  } else if (input.positiveCount === 0) {
    reason = NO_POSITIVE;
  } else if (input.positiveCount < 3) {
    const noun = input.positiveCount === 1 ? "Standort" : "Standorte";
    const verb = input.positiveCount === 1 ? "liegt" : "liegen";
    reason = `In der Zielregion ${verb} nur ${input.positiveCount} ${noun} mit positiver Musterentwicklung in den letzten sechs Monaten vor.`;
  }
  if (!input.truncated) return reason;
  return reason ? `${reason} ${TRUNCATED}` : TRUNCATED;
}
