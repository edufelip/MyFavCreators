import { copy } from "@/lib/copy";

export default function NotFound() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col items-start gap-4 px-4 py-16">
      <h1 className="text-2xl font-black text-white">Página não encontrada</h1>
      <a href="/" className="text-sm font-semibold text-amber-300 underline">
        Voltar para o {copy.brand.name}
      </a>
    </main>
  );
}
