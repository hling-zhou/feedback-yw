import { describe, expect, it } from 'vitest'

/**
 * API 巡检推送领域逻辑测试（M2，docs/DESIGN-API巡检.md §3.2/§5/种子常量）。
 * 纯函数测试；端点集成测试在 patrolPush.*.test.js（路由层注入测试，M2 后续补）。
 */
import {
  isValidPatrolDate,
  normalizeElbRow,
  normalizeEipVpcRow,
  parsePercent,
  resolvePatrolProductKey,
  resolveRequestProductKey,
} from './patrolDomain.js'
import { API_PATROL_API_REGISTRY_SEED } from './patrolSeeds.js'

describe('resolvePatrolProductKey 两级映射（name→key→null）', () => {
  // 产品目录形态对拍《产品规格配置》导出（name 一字不差，含 key fallback）
  const catalog = [
    { key: 'eip', name: '弹性公网IP' },
    { key: 'vpc', name: '虚拟私有云' },
    { key: 'slb', name: '弹性负载均衡' },
    { key: 'elb', name: '负载均衡' },
  ]

  it('4.1 中文名精确命中（样例统计表文件夹名）', () => {
    expect(resolvePatrolProductKey('弹性公网IP', catalog)).toBe('eip')
    expect(resolvePatrolProductKey('虚拟私有云', catalog)).toBe('vpc')
    expect(resolvePatrolProductKey('弹性负载均衡', catalog)).toBe('slb')
  })

  it('4.2 key fallback（防运营改产品名断链）', () => {
    expect(resolvePatrolProductKey('eip', catalog)).toBe('eip')
    expect(resolvePatrolProductKey('slb', catalog)).toBe('slb')
  })

  it('4.5 未知名 → null（路由层转 400 显式错误）；尾空格 trim 容忍（有意行为：外部尾空格不致命）', () => {
    expect(resolvePatrolProductKey('不存在的产品', catalog)).toBe(null)
    expect(resolvePatrolProductKey('', catalog)).toBe(null)
    // trim 容忍：'弹性公网IP ' → 命中 eip（设计 §3.2 隐含友好性，规格决策记录于此）
    expect(resolvePatrolProductKey('弹性公网IP ', catalog)).toBe('eip')
  })
})

describe('resolveRequestProductKey EIP/VPC 混装包归属', () => {
  it('5.1 注册表精确判定（样例实测组合：bind→eip、port→vpc、havip/bind→vpc）', () => {
    expect(resolveRequestProductKey('/acl/v3/floatingip/bind', API_PATROL_API_REGISTRY_SEED))
      .toEqual({ productKey: 'eip', heuristic: false })
    expect(resolveRequestProductKey('/customer/v3/port', API_PATROL_API_REGISTRY_SEED))
      .toEqual({ productKey: 'vpc', heuristic: false })
    expect(resolveRequestProductKey('/acl/v3/havip/bind', API_PATROL_API_REGISTRY_SEED))
      .toEqual({ productKey: 'vpc', heuristic: false })
  })

  it('5.3 未登记接口 → 启发式（/customer/v3/network 前缀判 vpc、其余判 eip）', () => {
    expect(resolveRequestProductKey('/customer/v3/network/preDelete/xxx', API_PATROL_API_REGISTRY_SEED))
      .toEqual({ productKey: 'vpc', heuristic: true })
    expect(resolveRequestProductKey('/customer/v3/unknownNewApi', API_PATROL_API_REGISTRY_SEED))
      .toEqual({ productKey: 'eip', heuristic: true })
  })

  it('5.8 空接口名 → null（product_key 入库 NULL，不参与统计）', () => {
    expect(resolveRequestProductKey('', API_PATROL_API_REGISTRY_SEED))
      .toEqual({ productKey: null, heuristic: false })
  })
})

describe('parsePercent / isValidPatrolDate', () => {
  it('4.1 成功率 "88.89%" → 88.89；"-" → null；"abc" → NaN（ignored）', () => {
    expect(parsePercent('88.89%')).toBe(88.89)
    expect(parsePercent('-')).toBe(null)
    expect(parsePercent('')).toBe(null)
    expect(Number.isNaN(/** @type {number} */ (parsePercent('abc')))).toBe(true)
  })

  it('4.2 日期校验', () => {
    expect(isValidPatrolDate('2026-08-10')).toBe(true)
    expect(isValidPatrolDate('2026-8-10')).toBe(false)
    expect(isValidPatrolDate('')).toBe(false)
  })
})

describe('明细行归一（两种 CSV 形态）', () => {
  // 样例真值：8月10日 华南-广州3 EIP 失败行（reqId-45020bf3... 那批的真实形态）
  const eipRow = {
    id: '123811889',
    appId: '',
    requestId: 'reqId-45020bf390c36027da9782356b68010e',
    requestMapping: '/acl/v3/floatingip/unbind/{ipId}',
    userId: 'CIDC-U-752030e34dbf455eb4969c35722e3a58',
    userName: 'YDY15292250571',
    bizCategory: '解绑',
    bizTarget: 'IP',
    bizNo: '685d8e3e-',
    result: '0',
    executionTimeMillis: '10',
    createTime: '2026-08-10 19:51:30',
    diagnoseResult: '{"final_conclusion":"..."}',
  }

  it('5.7 EIP/VPC 行归一：字段全映射（含四保留字段）', () => {
    const n = normalizeEipVpcRow(eipRow)
    expect(n).toMatchObject({
      externalRowId: 123811889,
      requestId: 'reqId-45020bf390c36027da9782356b68010e',
      apiPath: '/acl/v3/floatingip/unbind/{ipId}',
      userId: 'CIDC-U-752030e34dbf455eb4969c35722e3a58',
      userName: 'YDY15292250571',
      isSuccess: 0,
      durationMs: 10,
      requestTime: '2026-08-10 19:51:30',
      endTime: null,
      bizCategory: '解绑',
      bizTarget: 'IP',
      errorMessage: null,
      appId: '',            // 样例恒空仍保留（空串原样）
      pushedDiagnose: '{"final_conclusion":"..."}',
    })
  })

  it('5.6 ELB 行归一：api_path=resourceType/resourceOperation、isSuccess/resultStatus、endTime 保留', () => {
    const elbRow = {
      id: '11474802',
      requestId: 'reqId-cfbf76d0065865feebdcb4e2acdbd8cb',
      userId: 'CIDC-U-58f78673eec0437f902f44b3071938c6',
      resourceType: 'L7POLICY',
      resourceOperation: 'CREATE',
      startTime: '2026-08-10 23:52:13',
      endTime: '2026-08-10 23:52:14',
      resultStatus: 'FAILED',
      errorMessage: '七层转发策略PolicyDomainName与hostNameCompareType要么都为空，要么都不为空',
      dailyReport: '',
      realtimeReport: '',
      userName: 'cmic_sim',
      executionTimeMillis: '1000',
      diagnoseResult: '{"final_conclusion":"null"}',
    }
    const n = normalizeElbRow(elbRow)
    expect(n).toMatchObject({
      externalRowId: 11474802,
      apiPath: 'L7POLICY/CREATE',
      isSuccess: 0,
      requestTime: '2026-08-10 23:52:13',
      endTime: '2026-08-10 23:52:14',
      durationMs: 1000,
      errorMessage: '七层转发策略PolicyDomainName与hostNameCompareType要么都为空，要么都不为空',
      userName: 'cmic_sim',
      bizCategory: null,
      appId: null,
    })
  })

  it('5.8 坏行返回 null：缺 requestId / 非法 result', () => {
    expect(normalizeEipVpcRow({ ...eipRow, requestId: '' })).toBe(null)
    expect(normalizeEipVpcRow({ ...eipRow, result: '2' })).toBe(null)
    expect(normalizeElbRow({ resultStatus: 'UNKNOWN' })).toBe(null)
  })
})
