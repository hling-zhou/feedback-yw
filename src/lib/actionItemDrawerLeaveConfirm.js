import { Modal } from 'antd'

let leaveConfirmOpen = false

/**
 * @param {() => void} onConfirm
 */
export function confirmDiscardActionItemDrawerEdits(onConfirm) {
  if (leaveConfirmOpen) return

  leaveConfirmOpen = true
  Modal.confirm({
    title: '未保存的修改将丢失',
    content: '当前举措详情有未保存的修改，确定要离开吗？',
    okText: '离开',
    cancelText: '继续编辑',
    okButtonProps: { danger: true },
    onOk: () => {
      leaveConfirmOpen = false
      onConfirm()
    },
    onCancel: () => {
      leaveConfirmOpen = false
    },
    afterClose: () => {
      leaveConfirmOpen = false
    },
  })
}

/** @visibleForTesting */
export function resetActionItemDrawerLeaveConfirmForTests() {
  leaveConfirmOpen = false
}
