import Image from "next/image";

export default function TrophyIcon({ className }: { className?: string }) {
  return (
    <Image
      src="/puchar.png"
      alt=""
      width={128}
      height={128}
      sizes="74px"
      className={className ?? "trophy-image"}
    />
  );
}
