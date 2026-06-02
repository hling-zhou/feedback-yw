import { Document, Page, Text, View, Image, StyleSheet } from '@react-pdf/renderer'
import { PDF_FONT_FAMILY } from './registerPdfFonts.js'

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 11, fontFamily: PDF_FONT_FAMILY },
  title: { fontSize: 18, marginBottom: 8, fontFamily: PDF_FONT_FAMILY, fontWeight: 700 },
  subtitle: {
    fontSize: 10,
    color: '#555',
    marginBottom: 20,
    fontFamily: PDF_FONT_FAMILY,
  },
  sectionTitle: {
    fontSize: 13,
    marginTop: 16,
    marginBottom: 8,
    fontFamily: PDF_FONT_FAMILY,
    fontWeight: 700,
  },
  row: { flexDirection: 'row', marginBottom: 4, fontFamily: PDF_FONT_FAMILY },
  label: { width: 140, color: '#333', fontFamily: PDF_FONT_FAMILY },
  value: { flex: 1, fontFamily: PDF_FONT_FAMILY, lineHeight: 1.45 },
  body: { marginTop: 4, lineHeight: 1.5, color: '#444', fontFamily: PDF_FONT_FAMILY },
  chartBlock: { marginTop: 8, marginBottom: 16 },
  chartImage: { width: '100%', maxHeight: 360, objectFit: 'contain' },
  footer: {
    position: 'absolute',
    bottom: 30,
    left: 40,
    right: 40,
    fontSize: 8,
    color: '#888',
    textAlign: 'center',
    fontFamily: PDF_FONT_FAMILY,
  },
  chartCaption: {
    fontSize: 9,
    color: '#666',
    marginTop: 4,
    fontFamily: PDF_FONT_FAMILY,
  },
})

/**
 * @param {{
 *   title: string;
 *   periodLabel: string;
 *   generatedAt: string;
 *   sections: import('./buildReportModel.js').ReportSection[];
 *   chartImages?: import('./captureChartImages.js').ChartImage[];
 * }} model
 */
export function InsightReportDocument({ model }) {
  const chartImages = model.chartImages || []

  return (
    <Document>
      <Page size="A4" style={styles.page} wrap>
        <Text style={styles.title}>{model.title}</Text>
        <Text style={styles.subtitle}>
          洞察周期：{model.periodLabel} · 生成于 {model.generatedAt.slice(0, 16).replace('T', ' ')}
        </Text>

        {model.sections.map((section, i) => (
          <View key={i}>
            <Text style={styles.sectionTitle}>{section.title}</Text>
            {section.body && <Text style={styles.body}>{section.body}</Text>}
            {section.rows?.map((row, j) => (
              <View key={j} style={styles.row}>
                <Text style={styles.label}>{row.label}</Text>
                <Text style={styles.value}>{row.value}</Text>
              </View>
            ))}
          </View>
        ))}

        <Text style={styles.footer}>内部资料，请勿外传 · Feedback Insights</Text>
      </Page>

      {chartImages.map((img, i) => (
        <Page key={`chart-${i}`} size="A4" style={styles.page}>
          <Text style={styles.sectionTitle}>图表 · {img.title}</Text>
          <Image src={img.src} style={styles.chartImage} />
          <Text style={styles.chartCaption}>导出时工作台视图截图</Text>
          <Text style={styles.footer}>内部资料，请勿外传 · Feedback Insights</Text>
        </Page>
      ))}
    </Document>
  )
}
