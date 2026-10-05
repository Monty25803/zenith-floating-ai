type ZenithMarkProps = {
  className?: string;
  title?: string;
};

/** Official Zenith mark: purple tile with stacked peak chevrons. */
export function ZenithMark({ className = "h-10 w-10", title = "Zenith" }: ZenithMarkProps) {
  return (
    <img
      src="/zenith-icon.png"
      alt={title}
      title={title}
      className={`rounded-[22%] object-cover bg-transparent ${className}`}
      draggable={false}
    />
  );
}
