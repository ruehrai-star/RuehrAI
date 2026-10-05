import type { Metadata } from "next";
import { MapPage } from "@/components/map-page";

export const metadata: Metadata = {
  title: "Karte · RuehrAI",
  description: "Karte und Suche für die Standortberatung.",
};

export default function KartePage() {
  return <MapPage />;
}
