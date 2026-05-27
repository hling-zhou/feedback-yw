export function PageHeader({ title, desc, action }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-ink-900">{title}</h1>
        {desc && <p className="mt-0.5 text-sm leading-snug text-ink-500">{desc}</p>}
      </div>
      {action}
    </div>
  )
}
