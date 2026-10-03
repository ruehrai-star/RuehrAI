import type { Metadata } from "next";
import { StandortePage } from "@/components/standorte-page";

export const metadata: Metadata = {
  title: "Standorte · RuehrAI",
  description: "Zielregionen, Filialadressen und monatlicher Umsatz.",
};

export default function Page() {
  return <StandortePage />;
}
