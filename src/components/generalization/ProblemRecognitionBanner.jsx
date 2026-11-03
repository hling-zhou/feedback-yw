import { useEffect, useState } from 'react'
import { Alert, Button } from 'antd'
import { Link } from 'react-router-dom'
import {
  getGeneralizationPendingCount,
} from '../../lib/generalizationClient.js'
import { getObservationPendingCount } from '../../lib/observationClient.js'

/**
 * 「问题识别结果」合并横幅（设计 §4.3 / TASKS G2-5）。
 *
 * 一条横幅替代三条独立横幅（留观 + 举一反三建议 + 举一反三匹配）：
 *   · N 条建议纳入举一反三（AI 建议，待人工确认）→ 跳反馈库抽屉
 *   · M 条疑似命中已有举一反三问题（待复核）→ 跳举一反三队列
 *   · K 条疑似命中留观问题（待复核）→ 跳留观队列
 *
 * G-pass 降级时无 hints 行（只显后两行）；三行全零时整条横幅不渲染。
 *
 * @param {Object} props
 * @param {() => void} [props.onRefresh] 识别结果变动后的刷新回调（可选）
 */
export default function ProblemRecognitionBanner({ onRefresh }) {
  /** @type {[Record<string, number> | null, Function]} */
  const [gen, setGen] = useState(null)
  /** @type {[Record<string, number> | null, Function]} */
  const [obs, setObs] = useState(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    Promise.all([getGeneralizationPendingCount(), getObservationPendingCount()])
      .then((counts) => {
        if (cancelled) return
        const [genCount, obsCount] = /** @type {[Record<string, number>, Record<string, number>]} */ (counts)
        setGen(genCount || null)
        setObs(obsCount || null)
      })
      .catch(() => {
        // 拉取失败不展示横幅（不打扰主流程——对齐原留观横幅行为）
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (failed) return null

  const genHints = Number(gen?.hints || 0)
  const genMatches = Number(gen?.total || 0)
  const obsMatches = Number(obs?.total || 0)
  const total = genHints + genMatches + obsMatches
  if (total <= 0) return null

  /** @type {Array<{ key: string, text: string, to: string }>} */
  const lines = []
  if (genHints > 0) {
    const parts = [`有 ${genHints} 条工单建议纳入举一反三（AI 建议，待人工确认）`]
    if (Number(gen?.hintsHigh || 0) > 0 || Number(gen?.hintsMedium || 0) > 0) {
      parts.push(
        `（高把握 ${Number(gen?.hintsHigh || 0)} 条、中把握 ${Number(gen?.hintsMedium || 0)} 条）`,
      )
    }
    lines.push({
      key: 'gen-hints',
      text: parts.join(''),
      to: '/feedbacks',
    })
  }
  if (genMatches > 0) {
    const parts = [`有 ${genMatches} 条工单疑似命中已有举一反三问题（待复核）`]
    if (Number(gen?.high || 0) > 0 || Number(gen?.medium || 0) > 0) {
      parts.push(
        `（高置信 ${Number(gen?.high || 0)} 条、中置信 ${Number(gen?.medium || 0)} 条）`,
      )
    }
    lines.push({
      key: 'gen-matches',
      text: parts.join(''),
      to: '/actions?tab=generalization',
    })
  }
  if (obsMatches > 0) {
    const parts = [`有 ${obsMatches} 条反馈疑似命中留观问题（待复核）`]
    if (Number(obs?.high || 0) > 0 || Number(obs?.medium || 0) > 0) {
      parts.push(
        `（高置信 ${Number(obs?.high || 0)} 条、中置信 ${Number(obs?.medium || 0)} 条）`,
      )
    }
    lines.push({
      key: 'obs-matches',
      text: parts.join(''),
      to: '/actions?tab=observation',
    })
  }

  return (
    <Alert
      className="page-section-sm"
      type="warning"
      showIcon
      title={`问题识别结果：${total} 条待处理`}
      description={
        <>
          <ul className="mb-0 list-disc pl-5">
            {lines.map((line) => (
              <li key={line.key} className="flex items-center gap-2">
                <span>{line.text}</span>
                <Link to={line.to}>
                  <Button type="link" size="small" className="!px-0">
                    去处理
                  </Button>
                </Link>
              </li>
            ))}
          </ul>
          {onRefresh ? (
            <Button type="link" size="small" className="!px-0" onClick={() => { onRefresh() }}>
              刷新计数
            </Button>
          ) : null}
        </>
      }
    />
  )
}
