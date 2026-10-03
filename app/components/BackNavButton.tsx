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
    // history.length includes forward entries, so it can be > 1 even when
    // there is nowhere to go back after opening a tournament directly.
    const navigation = (window as Window & { navigation?: { canGoBack: boolean } }).navigation;
    const canGoBack = navigation?.canGoBack ?? window.history.length > 1;
    if (canGoBack) {
      router.back();
      return;
    }
    router.replace(fallbackHref);
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
