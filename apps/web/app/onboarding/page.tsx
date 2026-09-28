import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/placeholder-page";

export const metadata: Metadata = {
  title: "Einstieg · RuehrAI",
};

export default function OnboardingPage() {
  return (
    <PlaceholderPage kicker="Platzhalter" title="Einstieg">
      <p>
        Die Karte zeigt ein synthetisches 100-m-Gitter. Die Suche findet Adressen, PLZ und
        Gemeindeschlüssel über den API-Mock. Die fachliche Datenbasis bleibt in{" "}
        <code>docs/datenbasis</code>.
      </p>
    </PlaceholderPage>
  );
}
