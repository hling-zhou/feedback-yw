import { describe, expect, it } from 'vitest'
import {
  classifyProblemType,
  isPeerSideExclusion,
  isPureEmotionOnly,
  matchProblemTypeByDecisionTree,
} from './problemTypeClassifier.js'

/** @param {Array<[string, string]>} cases */
function expectCases(cases) {
  for (const [text, expected] of cases) {
    expect(classifyProblemType(text), JSON.stringify(text)).toBe(expected)
  }
}

describe('classifyProblemType V2.0 §7.1 故障/性能', () => {
  it('可用性/连通性故障', () => {
    expectCases([
      ['云主机完全打不开，业务中断', '可用性/连通性故障'],
      ['PING不通，无法访问', '可用性/连通性故障'],
      ['IP被封堵，无法连接', '可用性/连通性故障'],
      ['网络时通时断，频繁掉线', '可用性/连通性故障'],
    ])
  })

  it('性能问题', () => {
    expectCases([
      ['网络很卡，延迟高，但还能用', '性能问题'],
      ['丢包严重，视频卡顿', '性能问题'],
      ['服务器响应超时，重试可成功', '性能问题'],
    ])
  })
})

describe('classifyProblemType V2.0 §7.2 对端排除', () => {
  it('对端排除 → 产品功能咨询', () => {
    expectCases([
      ['ping通目标，但连接被对端reset', '产品功能咨询'],
      ['ping正常，telnet正常，但业务报Connection refused', '产品功能咨询'],
    ])
    expect(isPeerSideExclusion('ping通目标，但连接被对端reset')).toBe(true)
  })
})

describe('classifyProblemType V2.0 §7.3 计费异常', () => {
  it('计费与账单', () => {
    expectCases([
      ['这个月多扣了50元，请核实', '计费与账单'],
      ['账单金额不对，显示200元但我只用了50元', '计费与账单'],
      ['欠费恢复后，带宽被限速到80%，不合理', '计费与账单'],
      ['为什么扣了我两次费用？', '计费与账单'],
    ])
  })
})

describe('classifyProblemType V2.0 §7.4 计费/账单正常咨询', () => {
  it('产品功能咨询', () => {
    expectCases([
      ['如何查看我的账单？', '产品功能咨询'],
      ['计费规则是什么？按量计费怎么算？', '产品功能咨询'],
      ['带宽超限怎么收费？', '产品功能咨询'],
      ['我想查一下这个月的费用明细', '产品功能咨询'],
    ])
  })
})

describe('classifyProblemType V2.0 §7.5 配额与权限申请', () => {
  it('配额与权限申请', () => {
    expectCases([
      ['申请提升公网IP全局配额至300个', '配额与权限申请'],
      ['华东-苏州申请轻载IP一个，邮件已审批', '配额与权限申请'],
      ['请解除IP售罄，需要订购1个IP', '配额与权限申请'],
      ['开通8:1灰度权限，取消CPU与IP比例限制', '配额与权限申请'],
      ['申请单资源池带宽配额提升至500M', '配额与权限申请'],
      ['需要订购5G带宽，请开通大带宽权限', '配额与权限申请'],
      ['申请增加IP数量至10个', '配额与权限申请'],
      ['创建IP时提示配额不足，请提升配额', '配额与权限申请'],
    ])
  })
})

describe('classifyProblemType V2.0 §7.6 资源开通与创建', () => {
  it('资源开通与创建', () => {
    expectCases([
      ['创建云主机失败，提示资源不足', '资源开通与创建'],
      ['订购IP时提示售罄，无法订购', '资源开通与创建'],
      ['开通CDN超时，一直卡在创建中', '资源开通与创建'],
      ['创建云主机失败，提示资源不足，我要退订', '资源开通与创建'],
    ])
  })
})

describe('classifyProblemType V2.0 §7.7 配置与操作', () => {
  it('配置与操作', () => {
    expectCases([
      ['绑定EIP到云主机失败，报错', '配置与操作'],
      ['绑定EIP到云主机失败', '配置与操作'],
      ['修改带宽报错，无法保存', '配置与操作'],
      ['安全组规则配置了但不生效', '配置与操作'],
      ['解绑EIP时提示错误', '配置与操作'],
    ])
  })
})

describe('classifyProblemType V2.0 §7.8 退订与释放', () => {
  it('退订与释放', () => {
    expectCases([
      ['无法退订共享带宽', '退订与释放'],
      ['无法退订共享带宽，提示内部错误', '退订与释放'],
      ['包年订单无法自助退订，请后台处理', '退订与释放'],
      ['退订时报错，提示资源有依赖', '退订与释放'],
      ['请帮我退订这个IP', '退订与释放'],
      ['释放VPC时提示删除失败', '退订与释放'],
      ['删不掉这个云硬盘，一直报错', '退订与释放'],
    ])
  })
})

describe('classifyProblemType V2.0 §7.9–7.13 其余类别', () => {
  it('界面与操作易用性', () => {
    expect(classifyProblemType('控制台上删除按钮太难找了')).toBe('界面与操作易用性')
  })

  it('产品功能需求', () => {
    expect(classifyProblemType('希望增加批量删除功能')).toBe('产品功能需求')
  })

  it('产品功能咨询（含操作/退订咨询）', () => {
    expectCases([
      ['请问如何创建快照？', '产品功能咨询'],
      ['云专线掩码是多少？', '产品功能咨询'],
      ['IP配额有效期什么时间到期？', '产品功能咨询'],
      ['如何申请公网IP配额？', '产品功能咨询'],
      ['如何绑定EIP？', '产品功能咨询'],
      ['怎样修改安全组规则？', '产品功能咨询'],
      ['退订云主机的流程是什么？', '产品功能咨询'],
      ['请问包年订单怎么退订？', '产品功能咨询'],
      ['请问如何重置密码？', '产品功能咨询'],
    ])
  })

  it('人工服务与流程', () => {
    expectCases([
      ['工单提交两天没人处理，客服态度差', '人工服务与流程'],
      ['请帮忙催办一下省公司审批', '人工服务与流程'],
      ['要求出具故障报告', '人工服务与流程'],
    ])
  })

  it('纯情绪 → 其他', () => {
    expect(classifyProblemType('我不认可上次结论，再不解决就投诉')).toBe('其他')
    expect(isPureEmotionOnly('我不认可上次结论，再不解决就投诉')).toBe(true)
  })
})

describe('classifyProblemType V2.0 §6 边界与复合', () => {
  it('复合问题按决策树取首个命中', () => {
    expectCases([
      ['专线不通，另外延迟也很高', '可用性/连通性故障'],
      ['创建失败，想退订', '资源开通与创建'],
      ['创建失败，想申请配额', '配额与权限申请'],
      ['申请提升配额，同时咨询如何操作', '配额与权限申请'],
    ])
  })

  it('matchProblemTypeByDecisionTree returns null when no hit', () => {
    expect(matchProblemTypeByDecisionTree('abc')).toBe(null)
  })

  it('empty text → 其他', () => {
    expect(classifyProblemType('')).toBe('其他')
  })
})
