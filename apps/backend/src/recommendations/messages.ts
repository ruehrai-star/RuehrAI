export const RECOMMENDATIONS_NOT_FOUND =
  "Es liegen noch keine Empfehlungen vor. Bitte zuerst Empfehlungen berechnen.";

export const RECOMMENDATIONS_NOT_STORED =
  "Die Empfehlungen konnten nicht gespeichert werden.";

const NO_SUBAREAS =
  "In der Zielregion liegt keine Teilfläche (Ortsteil, Bezirk, PLZ oder Gemeinde) vor.";

const TRUNCATED =
  "Die Flächenabfrage hat das Zeilenlimit erreicht. Die Rangliste kann unvollständig sein.";

export function recommendationReason(input: {
  candidateCount: number;
  truncated: boolean;
}): string | null {
  let reason: string | null = null;
  if (input.candidateCount === 0) {
    reason = NO_SUBAREAS;
  }
  if (!input.truncated) return reason;
  return reason ? `${reason} ${TRUNCATED}` : TRUNCATED;
}
