type Option<T extends string> = {
  value: T
  label: string
  title?: string
}

type Props<T extends string> = {
  value: T
  options: Option<T>[]
  onChange: (value: T) => void
  ariaLabel: string
  size?: 'sm' | 'md'
}

/** Compact segmented control for mutually exclusive view modes. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  size = 'md',
}: Props<T>) {
  return (
    <div className={`segmented ${size}`} role="radiogroup" aria-label={ariaLabel}>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          role="radio"
          aria-checked={value === opt.value}
          className={`segmented-item ${value === opt.value ? 'active' : ''}`}
          title={opt.title || opt.label}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}
