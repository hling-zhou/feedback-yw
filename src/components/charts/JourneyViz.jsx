/**
 * @param {{ tree: { l1: string; count: number; children: { l2: string; count: number; ids: string[] }[] }[]; selected: { l1?: string; l2?: string }; onSelect: (l1: string, l2?: string) => void }}
 */
export default function JourneyViz({ tree, selected, onSelect }) {
  if (!tree?.length) {
    return <p className="py-8 text-center text-sm text-ink-400">暂无旅程数据</p>
  }

  const max = Math.max(...tree.flatMap((n) => [n.count, ...n.children.map((c) => c.count)]), 1)

  return (
    <div className="space-y-3">
      {tree.map((node) => (
        <div key={node.l1} className="rounded-lg border border-ink-100 overflow-hidden">
          <button
            type="button"
            className={`flex w-full items-center gap-3 px-3 py-2 text-left transition ${
              selected?.l1 === node.l1 && !selected?.l2 ? 'bg-brand-50' : 'hover:bg-ink-50'
            }`}
            onClick={() => onSelect(node.l1)}
          >
            <span className="min-w-[100px] text-sm font-medium text-ink-800">{node.l1}</span>
            <div className="flex-1 h-2 rounded-full bg-ink-100 overflow-hidden">
              <div
                className="h-full rounded-full bg-brand-500"
                style={{ width: `${(node.count / max) * 100}%` }}
              />
            </div>
            <span className="text-xs font-semibold text-ink-600">{node.count}</span>
          </button>
          {node.children.length > 0 && (
            <div className="border-t border-ink-50 bg-ink-50/40 px-2 py-2 space-y-1">
              {node.children.map((child) => (
                <button
                  key={child.l2}
                  type="button"
                  className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition ${
                    selected?.l1 === node.l1 && selected?.l2 === child.l2
                      ? 'bg-brand-100 text-brand-800'
                      : 'text-ink-600 hover:bg-white'
                  }`}
                  onClick={() => onSelect(node.l1, child.l2)}
                >
                  <span className="flex-1">{child.l2}</span>
                  <div className="w-20 h-1.5 rounded-full bg-ink-200 overflow-hidden">
                    <div
                      className="h-full bg-brand-400 rounded-full"
                      style={{ width: `${(child.count / max) * 100}%` }}
                    />
                  </div>
                  <span className="w-6 text-right font-medium">{child.count}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
