import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/placeholder-page";

export const metadata: Metadata = {
  title: "Einstieg · RuehrAI",
};

export default function OnboardingPage() {
  return (
    <PlaceholderPage kicker="Platzhalter" title="Einstieg">
      <p>
        Nach der Anmeldung lädt die Karte die Lage <code>demo-gemeinden</code> vom Backend. Die
        Suche findet Adressen, PLZ und Gemeindeschlüssel über <code>GET /search</code>. Die
        fachliche Datenbasis bleibt in <code>docs/datenbasis</code>.
      </p>
    </PlaceholderPage>
  );
}
