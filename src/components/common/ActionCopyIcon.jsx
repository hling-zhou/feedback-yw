import { message } from 'antd'
import { copyTextToClipboard } from '../../lib/clipboard.js'

/**
 * 复制图标组件——内联 data/action-copy.svg，点击即复制 value。
 * value 为空时返回 null（不渲染）。
 *
 * @param {{ value?: string | null; className?: string }} props
 */
export default function ActionCopyIcon({ value, className = '' }) {
  if (!value?.trim()) return null

  const handleCopy = async (e) => {
    e.stopPropagation()
    const ok = await copyTextToClipboard(value)
    if (ok) message.success('已复制')
    else message.error('复制失败')
  }

  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      className={`inline-block shrink-0 cursor-pointer align-middle text-ink-400 transition-colors hover:text-brand-600 ${className}`}
      onClick={handleCopy}
      role="button"
      aria-label="复制"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M14.2 2.39C14.14 1.61 13.54 1 12.8 1H6.6c-.3.04-.6.32-.6.65 0 .36.27.65.6.65h6.2c.09.02.2.11.2.21v8.88c.04.32.3.65.6.65.33 0 .6-.29.6-.65V2.51L14.2 2.39ZM11.92 4.39c0-.48-.36-.86-.8-.86H2.3c-.44 0-.8.39-.8.86v9.49c0 .48.36.86.8.86h8.82c.44 0 .8-.39.8-.86V4.39ZM2.7 4.82h8.02v8.63H2.7V4.82Zm6.16 1.91c.33 0 .6.29.6.65 0 .33-.23.6-.52.64l-4.89.01c-.33 0-.6-.29-.6-.65 0-.33.23-.6.52-.64l4.89-.01Zm-1 3.24c0-.36.27-.65.6-.65H4.05c-.29.04-.6.32-.6.65 0 .36.27.65.6.65h3.21c.29-.04.6-.32.6-.65Z"
        fill="currentColor"
        fillRule="evenodd"
      />
    </svg>
  )
}
