import type { Metadata } from "next";
import { SubmissionForm } from "@/components/submission-form";
import { copy } from "@/lib/copy";

export const metadata: Metadata = {
  title: copy.submission.title,
  description: copy.submission.intro,
  // A form page carries no ranking content worth indexing.
  robots: { index: false, follow: true },
};

export default function SubmitPage() {
  return (
    <main className="mx-auto flex w-full max-w-lg flex-col gap-6 px-4 py-10">
      <div>
        <h1 className="text-2xl font-black tracking-tight text-white">{copy.submission.title}</h1>
        <p className="mt-2 text-sm text-white/60">{copy.submission.intro}</p>
      </div>
      <SubmissionForm />
      <a href="/" className="text-sm font-semibold text-amber-300 underline">
        {copy.creatorPage.backToRanking}
      </a>
    </main>
  );
}
