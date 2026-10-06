import type { Metadata } from "next";
import { LoginForm } from "@/components/login-form";

export const metadata: Metadata = {
  title: "Anmelden · RuehrAI",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams?: Promise<{ abgelaufen?: string | string[] }>;
}) {
  const params = searchParams ? await searchParams : {};
  const flag = params.abgelaufen;
  const expired = flag === "1" || (Array.isArray(flag) && flag.includes("1"));
  return (
    <main className="stub" id="inhalt">
      <LoginForm expired={expired} />
    </main>
  );
}
