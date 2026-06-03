export function PageHeader({ title, desc, hint, action }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <h1 className="text-xl font-bold tracking-tight text-ink-900">{title}</h1>
        {desc ? <p className="mt-0.5 text-sm leading-snug text-ink-500">{desc}</p> : null}
        {hint ? <p className="mt-1.5 text-xs leading-relaxed text-ink-400">{hint}</p> : null}
      </div>
      {action}
    </div>
  )
}
