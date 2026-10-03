import type { Metadata } from "next";
import { EmpfehlungenPage } from "@/components/empfehlungen-page";

export const metadata: Metadata = {
  title: "Empfehlungen · RuehrAI",
  description: "Empfehlungen.",
};

export default function Page() {
  return <EmpfehlungenPage />;
}
