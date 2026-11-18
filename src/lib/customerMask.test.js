// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { displayCustomerText, maskCustomerName, maskPhoneInText } from './customerMask.js'

describe('customerMask 共享脱敏（11-18 展示口径）', () => {
  describe('maskCustomerName：自然人姓名脱敏（LLM 输入侧与员工姓名共用形态）', () => {
    it('首字 + **** + 尾字；两字留首字；空值走 options.empty', () => {
      expect(maskCustomerName('彭红松')).toBe('彭****松')
      expect(maskCustomerName('王五')).toBe('王****')
      expect(maskCustomerName('')).toBe('')
      expect(maskCustomerName('', { empty: '—' })).toBe('—')
      expect(maskCustomerName(null, { empty: '—' })).toBe('—')
    })
  })

  describe('maskPhoneInText：正文手机号打码，长编码/工单号不误伤', () => {
    it('标准手机号前后无字母数字时打码', () => {
      expect(maskPhoneInText('联系电话 13812345678 谢谢')).toBe('联系电话 138****5678 谢谢')
      expect(maskPhoneInText('13500000000')).toBe('135****0000')
    })
    it('非 1[3-9] 开头或前后紧邻字母数字的 11 位串不动（工单号/账号编码）', () => {
      expect(maskPhoneInText('YDY_1383412_sz2349')).toBe('YDY_1383412_sz2349')
      expect(maskPhoneInText('工单 E3112025102462188766')).toBe('工单 E3112025102462188766')
      // 12 开头不是大陆手机号
      expect(maskPhoneInText('12345678901')).toBe('12345678901')
    })
    it('账号编码内嵌手机号段照打码（真库形态：编码由手机号构成，仍识别自然人）', () => {
      // 真库形态 YDY_13707372434_q7：下划线不构成字母数字边界，内嵌手机号段打码（口径：电话号码需要脱敏）
      expect(maskPhoneInText('YDY_13707372434_q7')).toBe('YDY_137****2434_q7')
    })
  })

  describe('displayCustomerText：客户名展示（企业明文 + 聚类人名脱敏 + 手机号打码）', () => {
    it('企业/机构/账号客户名原样明文', () => {
      expect(displayCustomerText('北京星麦云田科科技有限公司')).toBe('北京星麦云田科科技有限公司')
      expect(displayCustomerText('灵山县公安局')).toBe('灵山县公安局')
      expect(displayCustomerText('YDY_1383412_sz2349')).toBe('YDY_1383412_sz2349')
    })
    it('「（聚类客户）姓名」人名段脱敏，编码段保留（真库形态）', () => {
      expect(displayCustomerText('2000546349-（聚类客户）周英雯')).toBe('2000546349-（聚类客户）周****雯')
      expect(displayCustomerText('2000500267-(聚类客户)鄞行')).toBe('2000500267-(聚类客户)鄞****')
    })
    it('客户名中独立手机号打码', () => {
      expect(displayCustomerText('张三 13812345678')).toBe('张三 138****5678')
    })
    it('空值走 options.empty', () => {
      expect(displayCustomerText('', { empty: '—' })).toBe('—')
      expect(displayCustomerText(null)).toBe('')
    })
  })
})
