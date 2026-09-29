import type { Metadata } from "next";
import { EmpfehlungenPage } from "@/components/empfehlungen-page";

export const metadata: Metadata = {
  title: "Empfehlungen · RuehrAI",
  description: "Top 3 in Ihrer Zielregion.",
};

export default function Page() {
  return <EmpfehlungenPage />;
}
