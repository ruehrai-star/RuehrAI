import type { Metadata } from "next";
import { VerlaufPage } from "@/components/verlauf-page";

export const metadata: Metadata = {
  title: "Verlauf · RuehrAI",
  description: "Veränderung der Kleinraumdaten und die daraus abgeleitete Weiterentwicklung.",
};

export default function Page() {
  return <VerlaufPage />;
}
