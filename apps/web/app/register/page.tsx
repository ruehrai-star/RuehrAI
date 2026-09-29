import type { Metadata } from "next";
import { RegisterForm } from "@/components/register-form";

export const metadata: Metadata = {
  title: "Registrieren · RuehrAI",
};

export default function RegisterPage() {
  return (
    <main className="stub" id="inhalt">
      <RegisterForm />
    </main>
  );
}
