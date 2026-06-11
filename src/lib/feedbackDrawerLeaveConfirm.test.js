import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  confirmDiscardFeedbackDrawerEdits,
  resetFeedbackDrawerLeaveConfirmForTests,
} from './feedbackDrawerLeaveConfirm.js'

const modalConfirm = vi.fn()

vi.mock('antd', () => ({
  Modal: {
    confirm: (...args) => modalConfirm(...args),
  },
}))

describe('feedbackDrawerLeaveConfirm', () => {
  beforeEach(() => {
    modalConfirm.mockReset()
    resetFeedbackDrawerLeaveConfirmForTests()
  })

  it('opens a single confirm dialog and runs onConfirm on ok', () => {
    const onConfirm = vi.fn()
    confirmDiscardFeedbackDrawerEdits(onConfirm)

    expect(modalConfirm).toHaveBeenCalledTimes(1)
    const config = modalConfirm.mock.calls[0][0]
    config.onOk()
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('does not open a second dialog while the first is still open', () => {
    confirmDiscardFeedbackDrawerEdits(vi.fn())
    confirmDiscardFeedbackDrawerEdits(vi.fn())

    expect(modalConfirm).toHaveBeenCalledTimes(1)
  })
})
