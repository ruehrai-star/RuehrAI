import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/placeholder-page";

export const metadata: Metadata = {
  title: "Übersicht · RuehrAI",
};

export default function DashboardPage() {
  return (
    <PlaceholderPage kicker="Platzhalter" title="Übersicht">
      <p>
        Kennzahlen und Business-Cases folgen, sobald das Backend Facts ausliefert. Diese Seite ist
        nur die Navigation für den nächsten Schnitt.
      </p>
    </PlaceholderPage>
  );
}
