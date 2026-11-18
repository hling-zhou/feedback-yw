import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * API 巡检溯源页真渲染冒烟测试（M6）。
 * renderToStaticMarkup 真渲染——挂载即炸直接红；useEffect 不执行（数据拉取不触发）。
 * 断言锚定页面独有文案（防与导航/Tab label 撞名恒绿——11-04 教训）。
 * 路由包裹用 react-router-dom 的 MemoryRouter——组件消费 useSearchParams（react-router-dom），
 * 包裹源必须同库（11-12 2e2ec12 起 StaticRouter/react-router 与 hook 不同源，真渲染全红 5 天未察觉）。
 */

vi.mock('../context/AuthContext.jsx', () => ({
  useAuth: () => ({ can: () => true }),
  AuthProvider: ({ children }) => children,
}))
vi.mock('../hooks/useAppMessage.js', () => ({
  useAppMessage: () => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }),
}))
// dayjs 在 SSR 静态渲染下可用（无 DOM 依赖）；apiFetch mock 返回空数据
vi.mock('../lib/apiClient.js', () => ({
  apiFetch: vi.fn(async () => ({ rows: [], group: null, diagnosis: null, requests: [] })),
}))

import ApiPatrolFailures from './ApiPatrolFailures.jsx'

const renderPage = (search = '') => renderToStaticMarkup(
  <MemoryRouter initialEntries={[`/api-patrol/failures${search}`]}>
    <ApiPatrolFailures />
  </MemoryRouter>,
)

describe('ApiPatrolFailures 真渲染冒烟', () => {
  it('默认展示异常接口 Tab，两个 Tab 共用时间范围', () => {
    const html = renderPage()
    expect(html).toContain('异常接口列表')
    expect(html).toContain('失败请求列表')
    // 11-17 晚拍板：跨日/单日说明行已移除（工具条只留产品筛选+刷新）
    expect(html).not.toContain('跨日视图：成功率/次数按明细')
    expect(html).toContain('全部产品')          // 产品筛选 placeholder（两 tab）
    expect(html).not.toContain('组 = 同客户同接口 1 小时内失败链')
    expect(html).toContain('近7天')
    expect(html).toContain('近30天')
  })

  it('根因分布跳转展示失败请求 Tab 和快捷筛选', () => {
    const html = renderPage('?rootCauseL1=业务冲突')
    // 11-17 傍晚拍板④：旧说明文案「组 = 同客户同接口…」已删除，锚点改用需产品侧处理按钮 + RequestID 筛选
    expect(html).toContain('需产品侧处理')
    expect(html).toContain('RequestID')
    expect(html).toContain('处理状态')
    expect(html).toContain('业务冲突')   // URL 预填的 L1 筛选值
  })

  it('两个 Tab 分别渲染对应的表格列', () => {
    const interfaces = renderPage()
    expect(interfaces).toContain('成功率')
    expect(interfaces).toContain('总次数')
    expect(interfaces).toContain('失败次数')
    expect(interfaces).toContain('数据日期')   // 11-17 两表新增
    const groups = renderPage('?rootCauseL1=业务冲突')
    expect(groups).toContain('压缩前失败次数')
    expect(groups).not.toContain('压缩前次数')
    expect(groups).toContain('产品侧处理状态')
    expect(groups).toContain('资源池')
    expect(groups).toContain('产品')           // 11-17 失败请求列表新增
  })

  it('数据日期/产品列契约（源码正则，11-17）', () => {
    const contentPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'components', 'apiPatrol', 'ApiPatrolFailuresContent.jsx')
    const src = fs.readFileSync(contentPath, 'utf-8')
    // 异常接口列表：数据日期列（statDates 跨日合并展示）
    expect(src).toMatch(/title: '数据日期', dataIndex: 'statDates'/)
    // 失败请求列表：数据日期列 + 产品列（productName 映射 productKey 兜底）
    expect(src).toMatch(/title: '数据日期', dataIndex: 'groupDate'/)
    expect(src).toMatch(/title: '产品', dataIndex: 'productName'/)
  })

  it('失败请求列表交互契约（源码正则，11-17 傍晚拍板 5 项）', () => {
    const contentPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'components', 'apiPatrol', 'ApiPatrolFailuresContent.jsx')
    const src = fs.readFileSync(contentPath, 'utf-8')
    // ① 筛选下拉带数量统计（根因 L1 + 处理状态 options 挂 count——withCount 共享构造）
    expect(src).toMatch(/const withCount = \(options, counts\)/)
    expect(src).toMatch(/withCount\(ROOT_CAUSE_L1_OPTIONS, l1Counts\)/)
    expect(src).toMatch(/withCount\(STATUS_OPTIONS, statusCounts\)/)
    // ② 整行点击进详情（onRow 箭头函数 → openDrawer + 指针样式）
    expect(src).toMatch(/onRow=\{\(record\) => \(\{/)
    expect(src).toMatch(/onClick: \(\) => openDrawer\(record\.id\)/)
    // ③ 抽屉按钮：评估完成 + 底部固定栏居右（footer + justify-end）
    expect(src).toMatch(/footer=\{/)
    expect(src).toMatch(/评估完成/)
    expect(src).not.toMatch(/提交（已处理）/)
    // ④ 说明文案退场
    expect(src).not.toContain('组 = 同客户同接口 1 小时内失败链')
    // ⑤ 压缩前失败次数 hover 提示（Tooltip + 压缩规则文案）
    expect(src).toMatch(/压缩规则/)
  })

  it('失败请求列表增强契约（11-17 晚；11-18 复合搜索改版锚点迁移）', () => {
    const contentPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'components', 'apiPatrol', 'ApiPatrolFailuresContent.jsx')
    const src = fs.readFileSync(contentPath, 'utf-8')
    // ① 经办人筛选（11-18 迁移：下拉并入复合筛选 chips，选项仍 = DISTINCT 端点 + 计数形态）
    expect(src).toMatch(/failures\/assignees/)
    expect(src).toMatch(/\$\{a\.assignee\}（\$\{a\.count\}）/)
    expect(src).toMatch(/value: a\.assignee/)
    // ② 失败请求列表刷新按钮（复合搜索行内 loadGroups 按钮）
    expect(src).toMatch(/onClick=\{\(\) => \{ loadGroups\(\); \}\}/)
    // ③ 表头吸顶（11-18 下午修订）：tab 不吸、表头吸——两表 sticky={{ offsetHeader: 0 }} 直挂视口顶
    //    chrome 测量机制全退场（useMeasureHeight/chromeRef 无消费方后删除）
    expect((src.match(/sticky=\{\{ offsetHeader: 0 \}\}$/gm) || []).length).toBe(2)
    expect(src).not.toMatch(/useMeasureHeight/)
    expect(src).not.toMatch(/chromeRef/)
    // ④ 经办人筛选参与后端查询（filters 对象含 assignee 键 → qs 序列化透传）
    expect(src).toMatch(/assignee: '',/)
  })

  it('两 tab 产品筛选契约（11-17 晚；11-18 groups 端改复合筛选形态）', () => {
    const contentPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'components', 'apiPatrol', 'ApiPatrolFailuresContent.jsx')
    const src = fs.readFileSync(contentPath, 'utf-8')
    // ① 共用计数端点（一次拉取双口径）
    expect(src).toMatch(/failures\/product-counts/)
    // ② 异常接口 tab：interfaceProduct 状态 + 接口行口径计数 + 透传 loadInterfaces
    expect(src).toMatch(/interfaceProduct/)
    expect(src).toMatch(/p\.interfaceCount/)
    expect(src).toMatch(/qs\.set\('product', interfaceProduct\)/)
    // ③ 失败请求 tab（11-18 迁移：产品入复合筛选 enumOptions，组数口径计数不变）
    expect(src).toMatch(/p\.groupCount/)
    expect(src).toMatch(/product: productCounts\.map/)
    // ④ 说明行退场（两形态都不在）
    expect(src).not.toContain('单日视图：展示推送原值')
    expect(src).not.toContain('跨日视图：成功率/次数按明细')
  })

  it('失败请求列表 sticky chrome + 复合搜索 + 勾选形态（11-18 拍板）', () => {
    const contentPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'components', 'apiPatrol', 'ApiPatrolFailuresContent.jsx')
    const src = fs.readFileSync(contentPath, 'utf-8')
    // ①（11-18 下午拍板修正）：tab 不吸顶、表头吸顶——renderTabBar/sticky chrome 全退场；
    //    Tabs 裸挂对齐反馈库 feedback-lane-tabs 样式（14px/加粗/mb-2）
    expect(src).not.toMatch(/renderTabBar/)
    expect(src).not.toMatch(/page-sticky-chrome/)
    expect(src).toMatch(/feedback-lane-tabs|patrol-lane-tabs/)
    // 表头吸顶：两表 sticky offsetHeader 直挂（贴视口顶——Tabs 滚走后表头吸住；行尾 JSX 形态防注释误计）
    expect((src.match(/sticky=\{\{ offsetHeader: 0 \}\}$/gm) || []).length).toBe(2)
    // ② 复合搜索（11-18 晚拍板修订）：复合筛选组件独占搜索入口——独立 q 搜索框退场（文本字段在组件内）
    expect(src).toMatch(/PatrolCompositeFilter/)
    expect(src).not.toMatch(/placeholder="搜索 RequestID/)
    // 异常接口 tab 产品筛选宽 200（原名看不全）
    expect(src).toMatch(/!w-\[200px\]/)
    // ③ 需产品侧处理改勾选形式（Checkbox），与复合搜索、刷新同排一行
    expect(src).toMatch(/Checkbox/)
    expect(src).not.toMatch(/需产品侧处理'\s*\}\s*<\/Button>/)
    // ④ 工具条与表格间距：sticky chrome pb 分隔
    expect(src).toMatch(/pb-3/)
    // ⑤ 抽屉确立举措（11-18 拍板）：EstablishedActionFields 复用 + source=api_patrol + 备注改名
    expect(src).toMatch(/EstablishedActionFields/)
    expect(src).toMatch(/source="api_patrol"/)
    expect(src).toMatch(/备注/)
    expect(src).not.toMatch(/举措及排期说明/)
    // ⑥ 根因分类 L2 口径（11-18 下午拍板；晚收敛进 displayRootCause 单一谓词）：
    // 缺口类不显 L2；来源标注旧值（LLM语义判定/结构化诊断/未诊断/无诊断结论）过滤退场
    expect(src).toMatch(/if \(l1 === '诊断能力缺口'\) l2 = ''/)
    expect(src).toMatch(/LLM\(语义判定\|结构化诊断\|未诊断\)/)
    // ⑦ 人工修正根因（11-18 傍晚拍板）：manual 优先（·人工标识）+ 抽屉修正表单 + AI 原判对照
    expect(src).toMatch(/rootCauseL1Manual/)
    expect(src).toMatch(/修正根因大类/)
    expect(src).toMatch(/AI 判定/)
    // ⑧ 客户类型加「其他」（11-18 傍晚拍板：除仿真/测试账号外都是其他=真实客户，哨兵 __others__ 后端转空值过滤）
    expect(src).toMatch(/customerType: \[/)
    expect(src).toMatch(/label: '其他', value: '__others__'/)
    // ⑨ 根因展示同源派生（11-18 晚拍板：列表与抽屉同一谓词——抽屉 AI 判定行不得显示来源标注旧值/缺口类 L2）
    expect(src).toMatch(/displayRootCause/)
    expect((src.match(/displayRootCause\(/g) || []).length).toBeGreaterThanOrEqual(2)  // 列 + 抽屉两消费方
  })

  it('11-18 中午四项：证据收起 + 压缩规则提示 icon + MCP 来源提示 + 列宽拖拽', () => {
    const contentPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'components', 'apiPatrol', 'ApiPatrolFailuresContent.jsx')
    const src = fs.readFileSync(contentPath, 'utf-8')
    // ① 关键证据默认收起可展开（Collapse 包证据段）
    expect(src).toMatch(/关键证据[\s\S]{0,120}Collapse/)
    // ② 压缩前失败次数：表头列 title JSX 挂 info icon hover 压缩规则（antd Tooltip + InfoCircle）
    expect(src).toMatch(/InfoCircleOutlined/)
    expect(src).toMatch(/压缩前失败次数 <Tooltip/)
    // 值渲染不再包 Tooltip（值区去 hover）
    expect(src).not.toMatch(/render: \(v\) => \(\s*<Tooltip title="压缩规则/)
    // ③ 诊断结果标题右侧 MCP 来源提示
    expect(src).toMatch(/来自云网工作台MCP Server日志查询工具/)
    // ④ 列宽拖拽：useColumnResize + decorateColumns + scroll.x 求和（复用系统机制）
    expect(src).toMatch(/useColumnResize/)
    expect(src).toMatch(/decorateColumns/)
    expect(src).toMatch(/sumColumnsWidth/)
  })

  it('真渲染：经办人筛选与刷新按钮在 DOM 中出现（11-17 晚）', () => {
    // 默认 tab（异常接口列表）：刷新按钮在（antd 两字中文自动加空格 → 「刷 新」）
    const interfacesHtml = renderPage()
    expect(interfacesHtml).toMatch(/刷\s+新/)
    // groups tab 激活（rootCauseL1 参数）：经办人筛选 + 该 tab 刷新按钮
    const groupsHtml = renderPage('?rootCauseL1=业务冲突')
    expect(groupsHtml).toContain('经办人')
    expect(groupsHtml).toMatch(/刷\s+新/)
    // 两 tab 合计刷新按钮 = 2
    const total = ((interfacesHtml.match(/刷\s+新/g) || []).length) + ((groupsHtml.match(/刷\s+新/g) || []).length)
    expect(total).toBe(2)
  })

  it('诊断结果五段契约（源码正则，11-17 晚拍板）', () => {
    const contentPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'components', 'apiPatrol', 'ApiPatrolFailuresContent.jsx')
    const src = fs.readFileSync(contentPath, 'utf-8')
    // 标题改名 + 旧标题退场
    expect(src).toMatch(/诊断结果/)
    expect(src).not.toMatch(/AI 诊断原文/)
    // 五段标签全在
    expect(src).toMatch(/诊断结论/)
    expect(src).toMatch(/失败组信息/)
    expect(src).toMatch(/直接原因/)
    expect(src).toMatch(/关键证据/)
    expect(src).toMatch(/处理建议/)
    // 结论浅红 + 建议浅蓝高亮（tailwind bg 类）
    expect(src).toMatch(/bg-red-50/)
    expect(src).toMatch(/bg-blue-50/)
    // 日志原文双层展开：核心行默认 + 查看完整日志
    expect(src).toMatch(/查看完整日志/)
    // 数据源：diagnosisReport 服务端切分单源（前端不做行清洗——cleanLogLine 不得出现在前端）
    expect(src).toMatch(/diagnosisReport/)
    expect(src).not.toMatch(/cleanLogLine/)
  })

  it('详情抽屉压缩前全部记录模块契约（源码正则，11-17）：默认收起 Collapse + 三列分页 10', () => {
    const contentPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'components', 'apiPatrol', 'ApiPatrolFailuresContent.jsx')
    const src = fs.readFileSync(contentPath, 'utf-8')
    // 模块标题（Collapse header 独有文案——抽屉外无此词，防撞名）
    expect(src).toMatch(/压缩前全部记录/)
    // 默认收起（Collapse activeKey 受控初值空数组）
    expect(src).toMatch(/allRecordsOpen[\s\S]{0,80}useState\(\[\]\)/)
    // 三列：RequestID / 开始时间 / 结束时间
    expect(src).toMatch(/title: '开始时间', dataIndex: 'requestTime'/)
    expect(src).toMatch(/title: '结束时间', dataIndex: 'endTime'/)
    // RequestID 列完整显示（11-17 晚拍板）：加宽 330、无 ellipsis、break-all 兜底超长
    expect(src).toMatch(/dataIndex: 'requestId', key: 'requestId', width: 330/)
    expect(src).toMatch(/break-all/)
    expect(src).not.toMatch(/dataIndex: 'requestId', key: 'requestId', width: 260, ellipsis/)
    // 分页每页 10 条 + 小尺寸
    expect(src).toMatch(/pageSize: 10/)
  })

  it('详情抽屉样式对齐反馈库 D1-D5 规范（11-17 晚拍板：方案 B + bordered 保留）', () => {
    const contentPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'components', 'apiPatrol', 'ApiPatrolFailuresContent.jsx')
    const src = fs.readFileSync(contentPath, 'utf-8')
    // ① 两行式标题（主标题 16px + meta 行 secondary，reqId 不再挤主标题）
    expect(src).toMatch(/text-base font-semibold leading-none/)
    expect(src).not.toMatch(/失败组详情 · \$\{/)   // 旧单行拼接标题退场
    // ② 分区骨架：drawer-space-y + section-title + page-card-bordered（反馈库同款）
    expect(src).toMatch(/drawer-space-y/)
    expect((src.match(/section-title/g) || []).length).toBeGreaterThanOrEqual(4)  // 4 分区
    expect(src).toMatch(/page-card-bordered/)
    // ③ 正文 D4 13px（高亮块/日志行）；旧 text-sm 正文退场
    expect(src).toMatch(/bg-red-50 text-\[13px\]/)
    expect(src).toMatch(/bg-blue-50 text-\[13px\]/)
    expect(src).toMatch(/font-mono text-\[13px\]/)
    expect(src).not.toMatch(/bg-red-50 text-sm/)
    // ④ 左竖条 3px（规范正文竖条规格）：抽屉双高亮块 2 处（红/蓝）+ 概况综述左边条 1 处；旧 4px 退场
    expect((src.match(/border-l-\[3px\]/g) || []).length).toBe(3)
    expect(src).toMatch(/border-red-300 bg-red-50/)
    expect(src).toMatch(/border-blue-300 bg-blue-50/)
    expect(src).not.toMatch(/border-l-4/)
    // ⑤ 五段字段标签统一 sub-section-label（12px/600）；旧散装 secondary 标签退场
    expect((src.match(/sub-section-label/g) || []).length).toBeGreaterThanOrEqual(5)
    // ⑥ 方案 B：独立分区「关联请求明细」（数据明细不是反馈）
    expect(src).toMatch(/关联请求明细/)
    // ⑦ Descriptions bordered 保留（短字段横排例外拍板）
    expect(src).toMatch(/column=\{2\} bordered/)
  })

  it('失败请求列表列契约（源码正则）：资源池列在前两列固定+压缩前失败次数（11-11 拍板）', () => {
    const contentPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'components', 'apiPatrol', 'ApiPatrolFailuresContent.jsx')
    const src = fs.readFileSync(contentPath, 'utf-8')
    // 失败请求列表资源池列定义（title+dataIndex 组合形态；抽屉 Descriptions 的 pool 是 label/children 形态不会误匹配）
    expect(src).toMatch(/title: '资源池', dataIndex: 'poolName'/)
    // 旧列名退场（列表 title + 抽屉 label 都不再出现）
    expect(src).not.toMatch(/'压缩前次数'/)
    // 前两列固定（RequestID + 指标名称）
    const fixedCount = (src.match(/fixed: 'left'/g) || []).length
    expect(fixedCount).toBeGreaterThanOrEqual(2)
    // 失败请求列表 Table 启用横向滚动（antd 固定列前提；11-18 起改为 sumColumnsWidth 动态求和）
    expect(src).toMatch(/scroll=\{\{ x: sumColumnsWidth\(decoratedGroupColumns\) \}\}/)
    // 异常接口列表分页总数（11-11：对齐 ec3b5e3 全局形态；条件分页旧形态退场）
    expect(src).not.toMatch(/interfaces\.length > 20 \? \{ pageSize: 20 \} : false/)
    const showTotalCount = (src.match(/showTotal: paginationShowTotal/g) || []).length
    expect(showTotalCount).toBeGreaterThanOrEqual(2)   // 异常接口列表 + 失败请求列表两表都有
  })

  it('巡检概况卡渲染（2026-11-07 拍板：页面顶部检测结果总结；空数据占位不误显 LLM 状态）', () => {
    const html = renderPage()
    expect(html).toContain('巡检概况')
    expect(html).toContain('检测结果总结，随时间范围刷新') // 卡片独有说明文案（防撞名）
    expect(html).toContain('暂无概况') // useEffect 不跑 → 空态占位
    expect(html).not.toContain('LLM 润色') // 无数据时不误显 LLM 状态 Tag
    expect(html).not.toContain('LLM 未启用') // 三态：无数据不显
  })

  it('巡检概况信息层次契约（11-17 晚拍板：结论/指标卡/诊断细节三段式）', () => {
    const contentPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'components', 'apiPatrol', 'ApiPatrolFailuresContent.jsx')
    const src = fs.readFileSync(contentPath, 'utf-8')
    // ① 结论区：LLM 综述带浅色左边条（与抽屉原文卡同构）+ 13px 正文
    expect(src).toMatch(/border-brand-300 pl-3 text-\[13px\]/)
    // ② 指标数字行：metric-card 灰底卡 ×4 + 大数字 20px（xl）+ 环比箭头
    expect((src.match(/metric-card/g) || []).length).toBeGreaterThanOrEqual(4)
    expect((src.match(/text-xl font-semibold/g) || []).length).toBe(4)
    expect(src).toMatch(/delta\.failDelta/)
    // 旧裸数字行（Space 平铺 strong）退场
    expect(src).not.toMatch(/异常接口 <Typography/)
    // ③ 诊断细节三栏：worstTop3 / causeTop3（占比条）/ 闭环 5 态 + 未诊断/仿真计数
    expect(src).toMatch(/worstTop3/)
    expect(src).toMatch(/causeTop3/)
    expect(src).toMatch(/未诊断.*组/)      // closure.undiagnosed 灰字补充
    expect(src).toMatch(/simGroups/)
    expect(src).toMatch(/sub-section-label/)  // 细节栏标题统一
  })
})
