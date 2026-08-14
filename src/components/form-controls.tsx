"use client";

import { useFormStatus } from "react-dom";
import clsx from "clsx";
import { LoaderCircle } from "lucide-react";

export function SubmitButton({
  children,
  className,
  pendingLabel = "Vent lidt...",
}: {
  children: React.ReactNode;
  className?: string;
  pendingLabel?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button className={clsx("button", className)} type="submit" disabled={pending}>
      {pending && <LoaderCircle className="spin" aria-hidden="true" />}
      {pending ? pendingLabel : children}
    </button>
  );
}

export function FormMessage({ error, success }: { error?: string; success?: string }) {
  if (!error && !success) return null;
  return (
    <p className={clsx("form-message", error ? "form-message--error" : "form-message--success")} role="status">
      {error ?? success}
    </p>
  );
}
