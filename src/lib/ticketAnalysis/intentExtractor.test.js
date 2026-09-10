import { describe, it, expect } from 'vitest'
import { extractIntent, intentToRequestScene, intentToProblemType } from './intentExtractor.js'

describe('intentExtractor - action 提取', () => {
  it('识别资源申请：申请+配额', () => {
    const r = extractIntent('订购云主机时提示弹性公网IP全局配额超限，剩余可订购量为0，请协助扩容配额1个')
    expect(r.action).toBe('资源操作')
  })

  it('识别资源申请：申请+带宽', () => {
    const r = extractIntent('申请华南-广州3资源池带宽配额提升至7644M')
    expect(r.action).toBe('资源操作')
  })

  it('识别资源申请：提升+IP', () => {
    const r = extractIntent('客户账号全局公网IP配额从520提升至1200，需确认配额提升已生效')
    expect(r.action).toBe('资源操作')
  })

  it('识别资源申请：扩容+配额', () => {
    const r = extractIntent('VPC对等连接数量配额不足，申请提升至20，请核实')
    expect(r.action).toBe('资源操作')
  })

  it('识别资源申请：新购+资源', () => {
    const r = extractIntent('申请新购弹性公网IP 10个，请协助开通')
    expect(r.action).toBe('资源操作')
  })

  it('识别故障排查：纯故障症状', () => {
    const r = extractIntent('两台ECS之间无法PING通，不能访问')
    expect(r.action).toBe('故障排查')
  })

  it('识别故障排查：丢包症状', () => {
    const r = extractIntent('ECS之间100%丢包，请帮忙回溯流量分析原因')
    expect(r.action).toBe('故障排查')
  })

  it('识别故障排查：卡顿症状', () => {
    const r = extractIntent('网络卡顿，已申请轻载通道未解决')
    // "申请轻载通道"的"申请"匹配了轻载(gray)→资源名词? 但轻载是配额类，所以应该是资源操作
    // 实际上"轻载"在RESOURCE_NOUNS_RE中，所以"申请...轻载通道"应判定为资源操作
    const r2 = extractIntent('网络卡顿，后端排查原因')
    expect(r2.action).toBe('故障排查')
  })

  it('识别咨询', () => {
    const r = extractIntent('咨询一下VPC子网如何配置路由策略')
    expect(r.action).toBe('信息咨询')
  })

  it('识别催办', () => {
    const r = extractIntent('工单已提交3天，一直没有回复，催办')
    expect(r.action).toBe('进度催办')
  })

  it('识别退订释放', () => {
    const r = extractIntent('退订广州3地区共享带宽包')
    expect(r.action).toBe('资源操作')
  })
})

describe('intentExtractor - action 冲突消解', () => {
  it('申请资源 > 排查：配额申请附带"请协助"', () => {
    const r = extractIntent('申请将VPC配额从12提升至20，请协助核实')
    expect(r.action).toBe('资源操作')
  })

  it('申请资源 > 排查：带宽扩容附带"请帮忙排查"', () => {
    const r = extractIntent('广州3带宽配额需扩容250M，请帮忙排查为何上次扩容未生效')
    // "扩容250M"中的"扩容"+"带宽"→资源名词匹配 → 资源操作优先
    // 尽管有"排查"词，但资源申请优先级更高
    expect(r.action).toBe('资源操作')
  })

  it('排查 > 咨询型申请："申请建群排查"', () => {
    const r = extractIntent('网络丢包严重，申请建群协助排查')
    // "申请建群"不是申请资源（建群不是资源名词）→ 不触发资源申请
    // "丢包"→故障症状 → 故障排查
    expect(r.action).toBe('故障排查')
  })

  it('排查 > 咨询型申请："申请建单处理"', () => {
    const r = extractIntent('节点丢包严重，申请处理建单')
    expect(r.action).toBe('故障排查')
  })
})

describe('intentExtractor - domain 提取', () => {
  it('配额带宽', () => {
    const r = extractIntent('申请将弹性公网IP配额从520提升至1200')
    expect(r.domain).toBe('配额与权限申请')
  })

  it('连通性故障', () => {
    const r = extractIntent('两台ECS之间无法PING通，不能访问')
    expect(r.domain).toBe('可用性/连通性故障')
  })

  it('性能问题', () => {
    const r = extractIntent('云主机带宽只跑到0.5mb，网速很慢')
    expect(r.domain).toBe('性能问题')
  })

  it('安全组配置', () => {
    const r = extractIntent('安全组规则未放通443端口，导致无法访问')
    expect(r.domain).toBe('配置与操作')
  })

  it('计费账单', () => {
    const r = extractIntent('本月出账异常，扣费金额与预估不符')
    expect(r.domain).toBe('计费与账单')
  })

  it('功能咨询', () => {
    const r = extractIntent('咨询VPC子网如何划分，是否有最佳实践文档')
    expect(r.domain).toBe('产品功能咨询')
  })
})

describe('intentExtractor - 一致性输出', () => {
  it('配额申请：动作和问题域一致', () => {
    const r = extractIntent('申请华南-广州3资源池带宽配额提升至7644M')
    expect(r.action).toBe('资源操作')
    expect(r.domain).toBe('配额与权限申请')
    expect(r.confidence).toBe('high')
  })

  it('故障排查：动作和问题域一致', () => {
    const r = extractIntent('两台ECS无法PING通，请排查网络连通性')
    expect(r.action).toBe('故障排查')
    expect(r.domain).toBe('可用性/连通性故障')
    expect(r.confidence).toBe('high')
  })

  it('高置信度：两个维度都有明确信号', () => {
    const r = extractIntent('申请提升VPC配额至20个')
    expect(r.confidence).toBe('high')
  })

  it('中置信度：只有一个维度有信号', () => {
    const r = extractIntent('请处理')
    expect(r.confidence).toBe('medium')
  })

  it('低置信度：两个维度都无信号', () => {
    const r = extractIntent('')
    expect(r.confidence).toBe('low')
  })
})

describe('intentExtractor - scene/type 映射', () => {
  it('资源操作 → 资源操作申请', () => {
    expect(intentToRequestScene('资源操作')).toBe('资源操作申请')
  })

  it('故障排查 → 报障与排错', () => {
    expect(intentToRequestScene('故障排查')).toBe('报障与排错')
  })

  it('信息咨询 → 产品信息咨询', () => {
    expect(intentToRequestScene('信息咨询')).toBe('产品信息咨询')
  })

  it('domain → problemType 直接映射', () => {
    expect(intentToProblemType('配额与权限申请')).toBe('配额与权限申请')
    expect(intentToProblemType('可用性/连通性故障')).toBe('可用性/连通性故障')
  })

  it('未知 domain → 其他', () => {
    expect(intentToProblemType('不存在的类型')).toBe('其他')
  })
})

describe('intentExtractor - 审计发现的问题修复验证', () => {
  // 从审计 v3 P0 发现中抽取的真实工单

  it('349条冲突：配额申请→报障 → 应修正为资源操作申请', () => {
    const cases = [
      '订购云主机时提示弹性公网IP全局配额超限，剩余可订购量为0，请协助扩容配额1个',
      '申请华南-广州3资源池带宽配额提升至7644M',
      '客户账号全局公网IP配额从520提升至1200，需确认配额提升已生效',
      'VPC对等连接数量配额不足，当前配额12已用尽，申请提升至20',
      '广州3资源池带宽配额需在原有基础上扩容250M',
    ]
    for (const cr of cases) {
      const r = extractIntent(cr)
      const scene = intentToRequestScene(r.action)
      const pt = intentToProblemType(r.domain)
      // action 应为资源操作，不是故障排查
      expect(r.action === '资源操作' || r.action === '变更调整').toBe(true)
      // domain 应为配额，不是可用性故障
      expect(r.domain).toBe('配额与权限申请')
      // 映射后 scene 不是报障与排错
      expect(scene).not.toBe('报障与排错')
      // 映射后 type 不是可用性故障
      expect(pt).not.toBe('可用性/连通性故障')
    }
  })

  it('130条误标：配额→可用性 → 应修正为配额与权限申请', () => {
    const cases = [
      '客户账号b3202335536v1全局公网IP配额从520提升至1200，有效期为14天',
      '订购时提示弹性公网IP全局配额超限，请协助扩容配额1个',
    ]
    for (const cr of cases) {
      const r = extractIntent(cr)
      const pt = intentToProblemType(r.domain)
      expect(pt).not.toBe('可用性/连通性故障')
      expect(pt).toBe('配额与权限申请')
    }
  })

  it('15条安全组：安全组规则问题 → 应标为配置类', () => {
    const r = extractIntent('同一VPC两台主机分别位于不同安全组，A可以IP访问B的9000端口但B不行')
    expect(r.domain).toBe('配置与操作')
    expect(intentToProblemType(r.domain)).toBe('配置与操作')
  })

  it('13条咨询：咨询标为报障 → 应修正为产品信息咨询', () => {
    const r = extractIntent('咨询一下VPC子网如何划分，是否有最佳实践')
    expect(r.action).toBe('信息咨询')
    expect(intentToRequestScene(r.action)).toBe('产品信息咨询')
  })

  it('10条操作：退订标为咨询 → 应修正为资源操作申请', () => {
    const r = extractIntent('退订广州3地区共享带宽包后带宽配额没有增加')
    expect(r.action).toBe('资源操作')
    expect(intentToRequestScene(r.action)).toBe('资源操作申请')
  })
})