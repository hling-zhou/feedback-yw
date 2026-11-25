import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import {
  normalizeActionItemImportHeader,
  normalizeActionItemImportRow,
  parseActionItemImportRow,
  parseActionItemImportWorkbook,
  parseActionItemSourceCell,
  parseLinkedDataSourcesCell,
  parseLinkedTicketIdsCell,
  normalizeActionItemContentKey,
  buildActionItemUpsertIndex,
} from './actionItemImport.js'
import { normalizeActionScheduleInput } from '../domain/actionSchedule.js'
import { ACTION_ITEM_IMPORT_TEMPLATE_HEADERS } from './actionItemImportTemplate.js'

describe('normalizeActionScheduleInput 排期写法归一（11-25 拍板）', () => {
  it('常见分隔符与中文写法归一为 YYYY-MM-DD', () => {
    expect(normalizeActionScheduleInput('2026.9.30')).toBe('2026-09-30')
    expect(normalizeActionScheduleInput('2026/09/30')).toBe('2026-09-30')
    expect(normalizeActionScheduleInput('2026年9月30日')).toBe('2026-09-30')
    expect(normalizeActionScheduleInput('2026-9-3')).toBe('2026-09-03')
    expect(normalizeActionScheduleInput(' 2026.9.30 ')).toBe('2026-09-30')
  })

  it('越界/非法日期保持原样（不静默纠错）', () => {
    expect(normalizeActionScheduleInput('2026.13.40')).toBe('2026.13.40')
    expect(normalizeActionScheduleInput('2026-2-31')).toBe('2026-2-31')
    expect(normalizeActionScheduleInput('9.30')).toBe('9.30')
    expect(normalizeActionScheduleInput('下个迭代')).toBe('下个迭代')
    expect(normalizeActionScheduleInput('')).toBe('')
  })

  it('真日期对象走本地时区安全转换', () => {
    expect(normalizeActionScheduleInput(new Date(2026, 8, 30))).toBe('2026-09-30')
  })

  it('导入行解析走归一链路：点分排期入库已是标准格式', () => {
    const parsed = parseActionItemImportRow(
      { 举措: '点分排期', 排期时间: '2026.9.30', 产品名称: 'VPC' },
      { firstProposedAt: '2026-11-25' },
    )
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.item.scheduleAt).toBe('2026-09-30')
      expect(parsed.item.status).toBe('in_progress')
    }
  })
})

describe('actionItemImport', () => {
  it('parseLinkedTicketIdsCell splits by newline and comma', () => {
    expect(parseLinkedTicketIdsCell('T-1\nT-2,T-3')).toEqual(['T-1', 'T-2', 'T-3'])
  })

  describe('parseLinkedTicketIdsCell 剥导出月份前缀（P2-A，2026-11-25 导出→导入往返断裂修复）', () => {
    it('剥"未知月份: "前缀——真库 133 条断裂同款形态', () => {
      expect(parseLinkedTicketIdsCell('未知月份: 20260811180838X918103377'))
        .toEqual(['20260811180838X918103377'])
    })
    it('剥"YYYY-MM: "正常月份前缀（导出分组格式）', () => {
      expect(parseLinkedTicketIdsCell('2026-05: T-1'))
        .toEqual(['T-1'])
    })
    it('多个月份分组、组内分号分隔：全剥前缀', () => {
      expect(parseLinkedTicketIdsCell('2026-05: T-1; T-2\n2026-06: T-3; 未知月份: T-4'))
        .toEqual(['T-1', 'T-2', 'T-3', 'T-4'])
    })
    it('裸号不受影响；全角冒号同样剥', () => {
      expect(parseLinkedTicketIdsCell('T-1\n未知月份： T-2\n2026-05： T-3'))
        .toEqual(['T-1', 'T-2', 'T-3'])
    })
    it('去重：剥前缀后重复的裸号只留一个', () => {
      expect(parseLinkedTicketIdsCell('2026-05: T-1\n未知月份: T-1'))
        .toEqual(['T-1'])
    })
    it('前缀后为空（"未知月份: "）整段丢弃', () => {
      expect(parseLinkedTicketIdsCell('未知月份: ')).toEqual([])
    })
  })

  it('parseLinkedDataSourcesCell maps labels', () => {
    expect(parseLinkedDataSourcesCell('投诉工单、咨询工单')).toEqual([
      'complaint_ticket',
      'consultation_ticket',
    ])
  })

  describe('parseActionItemSourceCell（来源列 → 档位，2026-11-24 拍板）', () => {
    it('档名解析为对应 source', () => {
      expect(parseActionItemSourceCell('投诉/咨询')).toBe('ticket')
      expect(parseActionItemSourceCell('用后即评')).toBe('post_use')
      expect(parseActionItemSourceCell('API巡检')).toBe('api_patrol')
      expect(parseActionItemSourceCell('留观问题')).toBe('observation')
    })

    it('旧枚举标签映射到 投诉/咨询 档（用户拍板）', () => {
      expect(parseActionItemSourceCell('投诉工单')).toBe('ticket')
      expect(parseActionItemSourceCell('咨询工单')).toBe('ticket')
    })

    it('其他数据源标签与未知文本落默认 投诉/咨询 档', () => {
      expect(parseActionItemSourceCell('用户调研')).toBe('ticket')
      expect(parseActionItemSourceCell('其他')).toBe('ticket')
      expect(parseActionItemSourceCell('')).toBe('ticket')
      expect(parseActionItemSourceCell('随便写的')).toBe('ticket')
    })

    it('parseActionItemImportRow 将来源列写入 source（linkedDataSources 语义保留）', () => {
      const parsed = parseActionItemImportRow(
        { 举措: '巡检优化', 来源: 'API巡检', 产品名称: 'VPC' },
        { firstProposedAt: '2026-11-24' },
      )
      expect(parsed.ok).toBe(true)
      if (parsed.ok) {
        expect(parsed.item.source).toBe('api_patrol')
      }

      const legacy = parseActionItemImportRow(
        { 举措: '旧口径行', 来源: '投诉工单、咨询工单', 产品名称: 'VPC' },
        { firstProposedAt: '2026-11-24' },
      )
      expect(legacy.ok).toBe(true)
      if (legacy.ok) {
        expect(legacy.item.source).toBe('ticket')
        // linkedDataSources 原数据源语义不变（工单关联自动补齐/筛选依赖）
        expect(legacy.item.linkedDataSources).toEqual(['complaint_ticket', 'consultation_ticket'])
      }
    })
  })

  it('parseActionItemImportRow allows empty optional fields', () => {
    const parsed = parseActionItemImportRow(
      { 举措: '补充文档', 产品名称: 'VPC' },
      { firstProposedAt: '2026-05-10' },
    )
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.item.content).toBe('补充文档')
      expect(parsed.item.problemTypeSnapshot).toBe('')
      expect(parsed.item.linkedRequirementTicketIds).toEqual([])
      expect(parsed.item.linkedTicketIds).toEqual([])
      expect(parsed.item.linkedDataSources).toEqual([])
      expect(parsed.item.firstProposedAt).toBe('2026-05-10')
    }
  })

  it('parseActionItemImportWorkbook reads 举措清单 sheet', () => {
    const wb = XLSX.utils.book_new()
    const sheet = XLSX.utils.json_to_sheet([
      {
        产品名称: 'VPC',
        举措: '优化控制台',
        问题类型: '',
        来源: '',
        '关联反馈(本周期)': '',
      },
    ])
    XLSX.utils.book_append_sheet(wb, sheet, '举措清单')
    const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
    const result = parseActionItemImportWorkbook(buffer, { firstProposedAt: '2026-05-11' })
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].content).toBe('优化控制台')
    expect(result.rows[0].firstProposedAt).toBe('2026-05-11')
  })

  it('parseActionItemImportWorkbook 每行携带 _excelRow 元数据（批量失败映射回 Excel 行号，11-25）', () => {
    const wb = XLSX.utils.book_new()
    const sheet = XLSX.utils.json_to_sheet([
      { 举措: '第一行数据', 产品名称: 'VPC' },
      { 举措: '第二行数据', 产品名称: 'VPC' },
    ])
    XLSX.utils.book_append_sheet(wb, sheet, '举措清单')
    const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
    const result = parseActionItemImportWorkbook(buffer, { firstProposedAt: '2026-11-25' })
    expect(result.rows.map((r) => r._excelRow)).toEqual([2, 3])
  })

  it('normalizeActionItemImportHeader strips template suffixes', () => {
    expect(normalizeActionItemImportHeader('举措*（必填）')).toBe('举措')
    expect(normalizeActionItemImportHeader('问题（可选）')).toBe('问题')
  })

  it('parseActionItemImportRow accepts template headers and empty 问题', () => {
    const row = normalizeActionItemImportRow(
      Object.fromEntries(ACTION_ITEM_IMPORT_TEMPLATE_HEADERS.map((h) => [h, ''])),
    )
    row['举措'] = '补充文档说明'
    const parsed = parseActionItemImportRow(row, { firstProposedAt: '2026-06-01' })
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.item.content).toBe('补充文档说明')
      expect(parsed.item.painPointSnapshot).toBe('')
    }
  })

  it('parseActionItemImportRow reads detail and requirement tickets', () => {
    const parsed = parseActionItemImportRow({
      举措: '补充文档',
      举措详情: '分阶段说明',
      需求工单: 'REQ-1, REQ-2',
    })
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.item.detail).toBe('分阶段说明')
      expect(parsed.item.linkedRequirementTicketIds).toEqual(['REQ-1', 'REQ-2'])
      expect(parsed.item.status).toBe('pending_evaluation')
      expect(parsed.item.scheduleAt).toBe('')
    }
  })

  it('parseActionItemImportRow ignores schedule and status when requirement tickets are present', () => {
    const parsed = parseActionItemImportRow({
      举措: '关联需求',
      需求工单: 'REQ-9',
      排期时间: '2026-08-01',
      状态: '进行中',
    })
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.item.status).toBe('pending_evaluation')
    expect(parsed.item.scheduleAt).toBe('')
    expect(parsed.warnings).toEqual([
      '已填需求工单，排期时间列已忽略',
      '已填需求工单，状态列已忽略',
    ])
  })

  it('parseActionItemImportWorkbook collects requirement-link warnings', () => {
    const wb = XLSX.utils.book_new()
    const sheet = XLSX.utils.json_to_sheet([
      {
        举措: '优化项',
        需求工单: 'REQ-1',
        排期时间: '2026-09-01',
        状态: '进行中',
      },
    ])
    XLSX.utils.book_append_sheet(wb, sheet, '举措清单')
    const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
    const result = parseActionItemImportWorkbook(buffer, { firstProposedAt: '2026-06-01' })
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].linkedRequirementTicketIds).toEqual(['REQ-1'])
    expect(result.warnings).toHaveLength(2)
    expect(result.warnings[0].row).toBe(2)
  })
})

describe('导入 upsert 判定键（11-25 拍板：NFKC 全半角 + 小写折叠 + 空白折叠）', () => {
  it('normalizeActionItemContentKey：全半角/大小写/空白差异折叠为同键', () => {
    expect(normalizeActionItemContentKey('带宽超限')).toBe(normalizeActionItemContentKey('带宽超限'))
    // 全角冒号→半角、全角逗号→半角（三写法同键）
    expect(normalizeActionItemContentKey('优化ＡＰＩ：接口，提升性能')).toBe(normalizeActionItemContentKey('优化ＡＰＩ:接口,提升性能'))
    expect(normalizeActionItemContentKey('优化ＡＰＩ:接口,提升性能')).toBe(normalizeActionItemContentKey('优化ＡＰＩ：接口，提升性能'))
    // NFKC 全角ＡＰＩ折成 ASCII 后小写：全角输入与半角小写同键
    expect(normalizeActionItemContentKey('优化ＡＰＩ：接口')).toBe(normalizeActionItemContentKey('优化api:接口'))
    // 连续空白折叠 + 首尾 trim
    expect(normalizeActionItemContentKey('  帮助中心   增加  说明 \n')).toBe('帮助中心 增加 说明')
    // 圆圈数字 NFKC ①→1
    expect(normalizeActionItemContentKey('①期上线')).toBe(normalizeActionItemContentKey('1期上线'))
    // 全角空格 U+3000 折叠
    expect(normalizeActionItemContentKey('冻结\u3000提示')).toBe('冻结 提示')
  })

  it('normalizeActionItemContentKey：不同内容不得误合并（防误伤边界）', () => {
    expect(normalizeActionItemContentKey('带宽超限')).not.toBe(normalizeActionItemContentKey('带宽超限处理'))
    expect(normalizeActionItemContentKey('删除子网校验')).not.toBe(normalizeActionItemContentKey('删除子網校验')) // 繁简不折叠
  })

  it('buildActionItemUpsertIndex：键=内容+产品，多条命中取最新，duplicates 计数', () => {
    const { index, keyOf } = buildActionItemUpsertIndex([
      { id: 'a1', content: '确认轻载申请与绑定流程是否存在不合理', productKey: 'eip', updatedAt: '2026-11-01T00:00:00Z' },
      { id: 'a2', content: '确认轻载申请与绑定流程是否存在不合理', productKey: 'eip', updatedAt: '2026-11-10T00:00:00Z' },
      { id: 'a3', content: '确认轻载申请与绑定流程是否存在不合理', productKey: 'eip', updatedAt: '2026-11-05T00:00:00Z' },
      { id: 'b1', content: '带宽超限', productKey: 'eip', updatedAt: '2026-10-01T00:00:00Z' },
      { id: 'b2', content: '带宽超限', productKey: 'vpc', updatedAt: '2026-10-02T00:00:00Z' },
    ])
    // 同键 3 条 → 最新 a2 为落点，duplicates=2
    const hit = index.get(keyOf({ content: '确认轻载申请与绑定流程是否存在不合理', productKey: 'eip' }))
    expect(hit?.id).toBe('a2')
    expect(hit?.duplicates).toBe(2)
    // 同内容不同产品 → 不同键（各自命中）
    expect(index.get(keyOf({ content: '带宽超限', productKey: 'eip' }))?.id).toBe('b1')
    expect(index.get(keyOf({ content: '带宽超限', productKey: 'vpc' }))?.id).toBe('b2')
    // productKey 空时回退 productName
    const idx2 = buildActionItemUpsertIndex([
      { id: 'c1', content: '无键举措', productName: '弹性IP', updatedAt: '2026-01-01T00:00:00Z' },
    ])
    const hit2 = idx2.index.get(idx2.keyOf({ content: '无键举措', productKey: '', productName: '弹性IP' }))
    expect(hit2?.id).toBe('c1')
  })

  it('buildActionItemUpsertIndex：全半角差异的既有举措可被命中（往返场景红证）', () => {
    // 场景：库里是全角「：」，Excel 重敲成半角「:」——旧规则判不同，NFKC 后判相同
    const { index, keyOf } = buildActionItemUpsertIndex([
      { id: 'f1', content: '自研网关：在IPv6带宽恢复接口中增加放大规则判定', productKey: 'eip', updatedAt: '2026-10-01T00:00:00Z' },
    ])
    const hit = index.get(keyOf({ content: '自研网关:在IPv6带宽恢复接口中增加放大规则判定', productKey: 'eip' }))
    expect(hit?.id).toBe('f1')
  })
})
