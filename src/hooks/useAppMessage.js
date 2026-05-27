import { App } from 'antd'

/** 使用 Ant Design App 上下文中的 message，避免静态 message.* 弃用警告 */
export function useAppMessage() {
  const { message } = App.useApp()
  return message
}
