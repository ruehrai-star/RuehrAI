import type { Metadata } from "next";
import { MusteranalysePage } from "@/components/musteranalyse-page";

export const metadata: Metadata = {
  title: "Musteranalyse · RuehrAI",
  description: "Aus Standorten und Umsätzen ein Kriterien-Muster ableiten.",
};

export default function Page() {
  return <MusteranalysePage />;
}
