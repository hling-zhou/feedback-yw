import { Alert, Button, Card, Collapse, Tag, Typography } from 'antd'
import { listJourneyTemplates } from '../lib/taxonomyLoader.js'

const CONFIG_PATH = 'public/config/taxonomy/'
const EXCEL_FILE = '打标配置.xlsx'

/**
 * @param {{
 *   taxonomyMeta: { loadedAt: string | null; source: string; configFile?: string; productKeys: string[] } | null;
 *   onReload: () => Promise<void>;
 *   reloading?: boolean;
 *   onReprocessThemes?: () => void;
 *   reprocessing?: boolean;
 * }} props
 */
export default function TaxonomyConfigPanel({
  taxonomyMeta,
  onReload,
  reloading,
  onReprocessThemes,
  reprocessing,
}) {
  const templates = listJourneyTemplates()

  return (
    <Card title="打标配置（Excel）">
      <Alert
        type="info"
        showIcon
        className="!mb-4"
        title="服务端 Excel 与本机标签管理"
        description={
          <span>
            编辑 <code className="text-xs">{CONFIG_PATH}{EXCEL_FILE}</code>
            后点击「重新加载配置」。日常增删改与按 Key 合并导入请在「标签管理」各标签 Tab（请求场景、问题类型、用户旅程）中操作。
          </span>
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button loading={reloading} onClick={onReload}>
          重新加载配置
        </Button>
        {onReprocessThemes && (
          <Button loading={reprocessing} onClick={onReprocessThemes}>
            按新配置重新打标
          </Button>
        )}
        {taxonomyMeta && (
          <>
            <Tag color={taxonomyMeta.source === 'excel' ? 'success' : taxonomyMeta.source === 'json' ? 'blue' : 'default'}>
              {taxonomyMeta.source === 'excel'
                ? '已加载 Excel'
                : taxonomyMeta.source === 'json'
                  ? '已加载 JSON'
                  : '内置默认'}
            </Tag>
            {taxonomyMeta.configFile && (
              <Typography.Text type="secondary" className="text-xs">
                {taxonomyMeta.configFile}
              </Typography.Text>
            )}
            {taxonomyMeta.loadedAt && (
              <Typography.Text type="secondary" className="text-xs">
                {taxonomyMeta.loadedAt}
              </Typography.Text>
            )}
          </>
        )}
      </div>

      <Collapse
        size="small"
        items={templates.map((t) => ({
          key: t.key,
          label: (
            <span>
              <strong>{t.name}</strong>
              <Typography.Text type="secondary" className="ml-2 text-xs">
                {t.key} · {t.l1Count} 个一级 · {t.l2Count} 个二级环节
              </Typography.Text>
            </span>
          ),
          children: (
            <Typography.Text type="secondary" className="text-xs">
              在 Excel 各表中筛选 <strong>产品Key = {t.key}</strong> 的行维护；用途见工作簿「填写说明」。
            </Typography.Text>
          ),
        }))}
      />
    </Card>
  )
}
