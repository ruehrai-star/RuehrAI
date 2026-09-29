import type { Metadata } from "next";
import { LoginForm } from "@/components/login-form";

export const metadata: Metadata = {
  title: "Anmelden · RuehrAI",
};

export default function LoginPage() {
  return (
    <main className="stub" id="inhalt">
      <LoginForm />
    </main>
  );
}
