type ZenithMarkProps = {
  className?: string;
  title?: string;
  /** `tile` = purple peak icon; `orb` = floating glass orb */
  variant?: "tile" | "orb";
};

/** Official Zenith mark. */
export function ZenithMark({
  className = "h-10 w-10",
  title = "Zenith",
  variant = "tile",
}: ZenithMarkProps) {
  const src = variant === "orb" ? "/zenith-orb-pro.svg" : "/zenith-icon.png";
  const shape =
    variant === "orb"
      ? "rounded-full object-contain bg-transparent"
      : "rounded-[22%] object-cover bg-transparent";

  return (
    <img
      src={src}
      alt={title}
      title={title}
      className={`${shape} ${className}`}
      draggable={false}
    />
  );
}
