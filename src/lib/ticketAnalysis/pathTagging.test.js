import { describe, expect, it } from 'vitest'
import { resolvePathDimensionSegments } from './pathSegments.js'
import {
  matchJourneyFromPath,
  matchProblemTypeFromPath,
  matchRequestSceneFromPath,
} from './pathTagging.js'
import { getTaxonomy } from '../productTaxonomy.js'
import { REQUEST_SCENES_BUILTIN, PROBLEM_TYPES_BUILTIN } from '../sharedTagDefs.js'

describe('resolvePathDimensionSegments', () => {
  it('maps product--scene--problem triple', () => {
    expect(
      resolvePathDimensionSegments(['弹性公网IP', '产品使用问题', '公网IP绑定/解绑失败']),
    ).toEqual({
      sceneSeg: '产品使用问题',
      problemSeg: '公网IP绑定/解绑失败',
      journeyServiceSeg: '产品使用问题',
      journeyIssueSeg: '公网IP绑定/解绑失败',
    })
  })

  it('maps scene--problem pair without product prefix', () => {
    expect(resolvePathDimensionSegments(['故障报修', '可用性/连通性'])).toEqual({
      sceneSeg: '故障报修',
      problemSeg: '可用性/连通性',
      journeyServiceSeg: '故障报修',
      journeyIssueSeg: '可用性/连通性',
    })
  })
})

describe('matchRequestSceneFromPath', () => {
  it('example1 path segment 3 → 产品能力咨询', () => {
    const scenes = REQUEST_SCENES_BUILTIN
    const result = matchRequestSceneFromPath(
      ['弹性公网IP', '产品使用问题', '公网IP绑定/解绑失败'],
      'eip',
      scenes,
    )
    expect(result).toBe('产品信息咨询')
  })

  it('example2 path segment 3 → 报障与恢复', () => {
    const result = matchRequestSceneFromPath(
      ['云专线', '故障报修', '可用性/连通性'],
      'dc',
      REQUEST_SCENES_BUILTIN,
    )
    expect(result).toBe('报障与排错')
  })
})

describe('matchProblemTypeFromPath', () => {
  it('example2 path segment 4 → 可用性/连通性故障 via alias map', () => {
    const result = matchProblemTypeFromPath(
      ['云专线', '故障报修', '可用性/连通性'],
      'dc',
      PROBLEM_TYPES_BUILTIN,
    )
    expect(result).toBe('可用性/连通性故障')
  })

  it('example1 path segment 4 → 配置与操作 via eip alias', () => {
    const result = matchProblemTypeFromPath(
      ['弹性公网IP', '产品使用问题', '公网IP绑定/解绑失败'],
      'eip',
      PROBLEM_TYPES_BUILTIN,
    )
    expect(result).toBe('配置与操作')
  })

  it('maps 产品咨询 path segment to 产品功能咨询', () => {
    const result = matchProblemTypeFromPath(
      ['弹性公网IP', '产品使用问题', '产品咨询'],
      'eip',
      PROBLEM_TYPES_BUILTIN,
    )
    expect(result).toBe('产品功能咨询')
  })
})

describe('matchJourneyFromPath', () => {
  it('example1 maps bind-security journey from issue segment', () => {
    const tax = getTaxonomy('弹性公网IP', 'eip')
    const result = matchJourneyFromPath(
      '',
      tax.journeys,
      'eip',
      ['弹性公网IP', '产品使用问题', '公网IP绑定/解绑失败'],
    )
    expect(result?.journeyL2).toMatch(/访问控制|白名单/)
  })
})
