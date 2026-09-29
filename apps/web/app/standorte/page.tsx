import type { Metadata } from "next";
import { StandortePage } from "@/components/standorte-page";

export const metadata: Metadata = {
  title: "Standorte · RuehrAI",
  description: "Zielregion, Filialadressen und monatlicher Umsatz.",
};

export default function Page() {
  return <StandortePage />;
}
