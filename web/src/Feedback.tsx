// Feedback: a local stub. No email is sent unless SMTP is explicitly
// configured server-side (see docs/BUILD.md); the stub returns a clear
// Croatian message and nothing is stored or sent.

import { useState } from "react";
import { useI18n } from "./i18n";

export function FeedbackForm({
  initialMessage = "",
  title,
}: {
  initialMessage?: string;
  title?: string;
}) {
  const { t } = useI18n();
  const heading = title ?? t.feedbackTitle;
  const [message, setMessage] = useState(initialMessage);
  const [status, setStatus] = useState<"idle" | "sending" | "error" | "ok">("idle");
  const [serverError, setServerError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setStatus("sending");
    setServerError(null);
    try {
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "feedback", message }),
      });
      const data: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const errorText =
          data && typeof data === "object" && "error" in data
            ? String((data as { error: unknown }).error)
            : `HTTP ${response.status}`;
        setServerError(errorText);
        setStatus("error");
        return;
      }
      setStatus("ok");
    } catch {
      setStatus("error");
      setServerError(t.networkError);
    }
  };

  return (
    <form className="feedback-form" onSubmit={submit}>
      <h4>{heading}</h4>
      <p className="feedback-note">{t.feedbackNote}</p>
      <textarea
        value={message}
        onChange={(event) => setMessage(event.target.value)}
        rows={4}
        placeholder={t.feedbackPlaceholder}
        disabled
      />
      <button type="submit" className="feedback-submit" disabled={status === "sending"}>
        {t.send}
      </button>
      {status === "error" && <p className="feedback-error">{serverError}</p>}
      {status === "ok" && <p className="feedback-ok">{t.thanks}</p>}
    </form>
  );
}
