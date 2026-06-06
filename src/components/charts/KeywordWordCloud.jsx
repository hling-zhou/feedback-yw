import { useMemo } from 'react'
import { Empty } from 'antd'

/** @typedef {{ word: string; count: number }} KeywordItem */

const FONT_MIN = 14
const FONT_MAX = 44
const WORD_COLORS = [
  '#4F46E5',
  '#4338CA',
  '#6366F1',
  '#0D9488',
  '#D97706',
  '#374151',
  '#6B7280',
]

/**
 * @param {number} count
 * @param {number} minC
 * @param {number} maxC
 */
function fontSizeForCount(count, minC, maxC) {
  if (maxC <= minC) return (FONT_MIN + FONT_MAX) / 2
  const t = (count - minC) / (maxC - minC)
  return FONT_MIN + Math.sqrt(t) * (FONT_MAX - FONT_MIN)
}

/**
 * 文本词云（字号按词频缩放，无需额外图表库）
 * @param {{ words: KeywordItem[]; className?: string; ariaLabel?: string; emptyDescription?: string }} props
 */
export default function KeywordWordCloud({
  words,
  className = '',
  ariaLabel = '词云',
  emptyDescription = '暂无足够文本',
}) {
  const items = useMemo(() => {
    const list = [...(words || [])].filter((w) => w.word?.trim()).sort((a, b) => b.count - a.count)
    if (!list.length) return []
    const counts = list.map((w) => w.count)
    const minC = Math.min(...counts)
    const maxC = Math.max(...counts)
    return list.map((w, i) => ({
      ...w,
      fontSize: fontSizeForCount(w.count, minC, maxC),
      color: WORD_COLORS[i % WORD_COLORS.length],
    }))
  }, [words])

  if (!items.length) {
    return (
      <div className={`flex min-h-[280px] items-center justify-center ${className}`}>
        <Empty description={emptyDescription} />
      </div>
    )
  }

  return (
    <div
      className={`flex min-h-[300px] flex-wrap content-center items-center justify-center gap-x-5 gap-y-4 px-4 py-6 ${className}`}
      role="img"
      aria-label={ariaLabel}
    >
      {items.map((item) => (
        <span
          key={item.word}
          className="inline-block max-w-full cursor-default font-semibold leading-tight transition-opacity hover:opacity-80"
          style={{
            fontSize: item.fontSize,
            color: item.color,
          }}
          title={`${item.word}：出现 ${item.count} 次`}
        >
          {item.word}
        </span>
      ))}
    </div>
  )
}
