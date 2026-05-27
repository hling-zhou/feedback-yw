/**
 * 方案 A：轻度紧凑 — 全局 Ant Design token，与 Tailwind 语义间距类配合使用。
 * @type {import('antd').ThemeConfig}
 */
export const appTheme = {
  token: {
    colorPrimary: '#4F46E5',
    borderRadius: 8,
    fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
    fontSize: 13,
    fontSizeHeading1: 28,
    fontSizeHeading2: 22,
    fontSizeHeading3: 18,
    fontSizeHeading4: 15,
    fontSizeHeading5: 13,
    lineHeight: 1.5,
    lineHeightHeading1: 1.3,
    lineHeightHeading2: 1.35,
    padding: 12,
    paddingSM: 8,
    paddingLG: 16,
    paddingXS: 6,
    margin: 12,
    marginSM: 8,
    marginLG: 16,
    marginXS: 4,
    controlHeight: 30,
    controlHeightSM: 24,
    controlHeightLG: 36,
  },
  components: {
    Table: {
      cellPaddingBlock: 8,
      cellPaddingInline: 12,
      headerBg: '#F9FAFB',
    },
    Card: {
      paddingLG: 16,
      headerFontSize: 15,
    },
    Form: {
      itemMarginBottom: 16,
      labelFontSize: 13,
    },
    Tabs: {
      horizontalItemPadding: '8px 12px',
      titleFontSize: 13,
    },
    Modal: {
      titleFontSize: 16,
    },
    Drawer: {
      paddingLG: 16,
    },
    Menu: {
      itemHeight: 36,
      iconSize: 14,
    },
    Alert: {
      paddingContentVerticalSM: 6,
      paddingContentHorizontalLG: 12,
    },
    Statistic: {
      titleFontSize: 12,
      contentFontSize: 22,
    },
  },
}
