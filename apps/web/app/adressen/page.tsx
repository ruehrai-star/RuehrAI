import type { Metadata } from "next";
import { AdressenPage } from "@/components/adressen-page";

export const metadata: Metadata = {
  title: "Adressen · RuehrAI",
  description: "Zwei Adressen auswerten.",
};

export default function Page() {
  return <AdressenPage />;
}
