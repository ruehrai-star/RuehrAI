import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/placeholder-page";

export const metadata: Metadata = {
  title: "Einstieg · RuehrAI",
};

export default function OnboardingPage() {
  return (
    <PlaceholderPage kicker="Platzhalter" title="Einstieg">
      <p>
        Nach den Standorten öffnet die App den Verlauf. Die kleinere Karte daneben ist nur der
        Beleg mit der gespeicherten Zielregion-Fläche. Der Layer <code>demo-gemeinden</code> gilt
        nur für die Kartenseite, nicht für den Verlauf. Die Suche findet Adressen, PLZ und
        Gemeindeschlüssel über <code>GET /search</code>. Die fachliche Datenbasis bleibt in{" "}
        <code>docs/datenbasis</code>.
      </p>
    </PlaceholderPage>
  );
}
