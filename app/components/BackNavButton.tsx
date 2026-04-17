"use client";

import { useRouter } from "next/navigation";

type BackNavButtonProps = {
  fallbackHref?: string;
  className?: string;
  label?: string;
};

export default function BackNavButton({
  fallbackHref = "/",
  className,
  label = "Back",
}: BackNavButtonProps) {
  const router = useRouter();

  function handleBack() {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
      return;
    }
    router.push(fallbackHref);
  }

  return (
    <button
      type="button"
      className={className}
      onClick={handleBack}
      style={{ background: "transparent", border: 0, padding: 0, color: "inherit", cursor: "pointer" }}
    >
      {label}
    </button>
  );
}
