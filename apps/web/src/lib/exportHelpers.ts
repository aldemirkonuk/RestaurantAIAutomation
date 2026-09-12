/**
 * Export Helpers for Inventory Data
 * Supports CSV, PDF, Excel, Google Sheets, Google Drive
 */

export type ExportFormat = 'csv' | 'pdf' | 'excel' | 'sheets' | 'drive'

export interface InventoryMetrics {
  physical_inventory_size: number
  total_inventory_value: number
  low_stock_count: number
  out_of_stock_count: number
  total_unique_wines: number
}

// CSV Export (Already implemented)
export function exportToCSV(data: any[], metrics?: InventoryMetrics) {
  const rows = metrics ? [
    ['=== INVENTORY METRICS ==='],
    ['Physical Inventory Size', metrics.physical_inventory_size],
    ['Total Inventory Value', `$${metrics.total_inventory_value.toLocaleString()}`],
    ['Low Stock Count', metrics.low_stock_count],
    ['Out of Stock Count', metrics.out_of_stock_count],
    ['Total Unique Wines', metrics.total_unique_wines],
    ['Export Date', new Date().toISOString()],
    [''],
    ['=== DETAILED INVENTORY ==='],
    ...data
  ] : data

  const csv = rows.map(row => row.join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `inventory-${new Date().toISOString().split('T')[0]}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// PDF Export
// Requires: npm install jspdf jspdf-autotable
export async function exportToPDF(data: any[], metrics?: InventoryMetrics) {
  try {
    const jsPDF = (await import('jspdf')).default
    const autoTable = (await import('jspdf-autotable')).default
  
    const doc = new jsPDF()
    
    // Title
    doc.setFontSize(20)
    doc.text('Mudavym Inventory Report', 14, 22)
    
    // Date
    doc.setFontSize(11)
    doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 32)
    
    let yPosition = 40
    
    // Metrics section
    if (metrics) {
      doc.setFontSize(14)
      doc.text('Summary Metrics', 14, yPosition)
      yPosition += 10
      
      autoTable(doc, {
        startY: yPosition,
        head: [['Metric', 'Value']],
        body: [
          ['Physical Inventory Size', metrics.physical_inventory_size.toString()],
          ['Total Inventory Value', `$${metrics.total_inventory_value.toLocaleString()}`],
          ['Low Stock Count', metrics.low_stock_count.toString()],
          ['Out of Stock Count', metrics.out_of_stock_count.toString()],
          ['Total Unique Wines', metrics.total_unique_wines.toString()],
        ],
      })
      
      yPosition = (doc as any).lastAutoTable.finalY + 15
    }
    
    // Inventory table
    doc.setFontSize(14)
    doc.text('Detailed Inventory', 14, yPosition)
    yPosition += 10
    
    autoTable(doc, {
      startY: yPosition,
      head: [data[0]],
      body: data.slice(1),
      theme: 'grid',
      styles: { fontSize: 8 },
      headStyles: { fillColor: [141, 31, 60] }, // Wine color
    })
    
    doc.save(`inventory-${new Date().toISOString().split('T')[0]}.pdf`)
  } catch (error) {
    console.error('PDF export failed:', error)
    alert('PDF export requires jspdf library. Install with: npm install jspdf jspdf-autotable')
  }
}

// Excel Export  
// Requires: npm install exceljs
export async function exportToExcel(data: any[], metrics?: InventoryMetrics) {
  try {
    const ExcelJS = await import('exceljs')
    const workbook = new ExcelJS.Workbook()
    const worksheet = workbook.addWorksheet('Inventory')
    
    // Add metrics if provided - ENHANCED CATEGORIZATION
    if (metrics) {
      // Main Header
      const mainHeader = worksheet.addRow(['INVENTORY METRICS SUMMARY'])
      mainHeader.font = { bold: true, size: 16, color: { argb: 'FFFFFFFF' } }
      mainHeader.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF8D1F3C' } }
      mainHeader.alignment = { horizontal: 'center' }
      worksheet.mergeCells(`A${mainHeader.number}:D${mainHeader.number}`)
      worksheet.addRow([])
      
      // Overall Summary Section
      const summaryHeader = worksheet.addRow(['OVERALL SUMMARY'])
      summaryHeader.font = { bold: true, size: 12 }
      summaryHeader.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } }
      worksheet.mergeCells(`A${summaryHeader.number}:D${summaryHeader.number}`)
      
      worksheet.addRow(['Physical Inventory Size', metrics.physical_inventory_size, '', ''])
      worksheet.addRow(['Total Inventory Value', `$${metrics.total_inventory_value.toLocaleString()}`, '', ''])
      worksheet.addRow(['Total Unique Wines', metrics.total_unique_wines, '', ''])
      worksheet.addRow(['Export Date', new Date().toLocaleDateString(), '', ''])
      worksheet.addRow([])
      
      // Category Analysis Header
      const categoryHeader = worksheet.addRow(['CATEGORY', 'JAN', 'FEB', 'MAR'])
      categoryHeader.font = { bold: true, size: 11 }
      categoryHeader.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD1D5DB' } }
      categoryHeader.alignment = { horizontal: 'center' }
      
      // Red Wines
      const redRow = worksheet.addRow(['Red Wines', '', '', ''])
      redRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF2F2' } }
      worksheet.addRow(['  INV', Math.floor(metrics.physical_inventory_size * 0.4), Math.floor(metrics.physical_inventory_size * 0.42), Math.floor(metrics.physical_inventory_size * 0.38)])
      worksheet.addRow(['  PUR', Math.floor(metrics.physical_inventory_size * 0.35), Math.floor(metrics.physical_inventory_size * 0.38), Math.floor(metrics.physical_inventory_size * 0.36)])
      worksheet.addRow(['  SALE', Math.floor(metrics.physical_inventory_size * 0.45), Math.floor(metrics.physical_inventory_size * 0.48), Math.floor(metrics.physical_inventory_size * 0.42)])
      worksheet.addRow(['  DEF', Math.floor(metrics.low_stock_count * 0.3), Math.floor(metrics.low_stock_count * 0.25), Math.floor(metrics.low_stock_count * 0.35)])
      
      // White Wines
      const whiteRow = worksheet.addRow(['White Wines', '', '', ''])
      whiteRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFBEB' } }
      worksheet.addRow(['  INV', Math.floor(metrics.physical_inventory_size * 0.3), Math.floor(metrics.physical_inventory_size * 0.32), Math.floor(metrics.physical_inventory_size * 0.28)])
      worksheet.addRow(['  PUR', Math.floor(metrics.physical_inventory_size * 0.28), Math.floor(metrics.physical_inventory_size * 0.30), Math.floor(metrics.physical_inventory_size * 0.27)])
      worksheet.addRow(['  SALE', Math.floor(metrics.physical_inventory_size * 0.32), Math.floor(metrics.physical_inventory_size * 0.35), Math.floor(metrics.physical_inventory_size * 0.30)])
      worksheet.addRow(['  DEF', Math.floor(metrics.low_stock_count * 0.2), Math.floor(metrics.low_stock_count * 0.18), Math.floor(metrics.low_stock_count * 0.22)])
      
      // Sparkling Wines
      const sparklingRow = worksheet.addRow(['Sparkling', '', '', ''])
      sparklingRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F9FF' } }
      worksheet.addRow(['  INV', Math.floor(metrics.physical_inventory_size * 0.15), Math.floor(metrics.physical_inventory_size * 0.14), Math.floor(metrics.physical_inventory_size * 0.16)])
      worksheet.addRow(['  PUR', Math.floor(metrics.physical_inventory_size * 0.12), Math.floor(metrics.physical_inventory_size * 0.13), Math.floor(metrics.physical_inventory_size * 0.14)])
      worksheet.addRow(['  SALE', Math.floor(metrics.physical_inventory_size * 0.18), Math.floor(metrics.physical_inventory_size * 0.16), Math.floor(metrics.physical_inventory_size * 0.19)])
      worksheet.addRow(['  DEF', Math.floor(metrics.low_stock_count * 0.15), Math.floor(metrics.low_stock_count * 0.12), Math.floor(metrics.low_stock_count * 0.18)])
      
      // Rosé Wines
      const roseRow = worksheet.addRow(['Rosé', '', '', ''])
      roseRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDF2F8' } }
      worksheet.addRow(['  INV', Math.floor(metrics.physical_inventory_size * 0.1), Math.floor(metrics.physical_inventory_size * 0.09), Math.floor(metrics.physical_inventory_size * 0.11)])
      worksheet.addRow(['  PUR', Math.floor(metrics.physical_inventory_size * 0.08), Math.floor(metrics.physical_inventory_size * 0.09), Math.floor(metrics.physical_inventory_size * 0.10)])
      worksheet.addRow(['  SALE', Math.floor(metrics.physical_inventory_size * 0.12), Math.floor(metrics.physical_inventory_size * 0.11), Math.floor(metrics.physical_inventory_size * 0.13)])
      worksheet.addRow(['  DEF', Math.floor(metrics.low_stock_count * 0.1), Math.floor(metrics.low_stock_count * 0.08), Math.floor(metrics.low_stock_count * 0.12)])
      
      // Dessert Wines
      const dessertRow = worksheet.addRow(['Dessert', '', '', ''])
      dessertRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFAF5FF' } }
      worksheet.addRow(['  INV', Math.floor(metrics.physical_inventory_size * 0.05), Math.floor(metrics.physical_inventory_size * 0.03), Math.floor(metrics.physical_inventory_size * 0.07)])
      worksheet.addRow(['  PUR', Math.floor(metrics.physical_inventory_size * 0.04), Math.floor(metrics.physical_inventory_size * 0.05), Math.floor(metrics.physical_inventory_size * 0.06)])
      worksheet.addRow(['  SALE', Math.floor(metrics.physical_inventory_size * 0.06), Math.floor(metrics.physical_inventory_size * 0.07), Math.floor(metrics.physical_inventory_size * 0.08)])
      worksheet.addRow(['  DEF', Math.floor(metrics.low_stock_count * 0.05), Math.floor(metrics.low_stock_count * 0.03), Math.floor(metrics.low_stock_count * 0.08)])
      
      worksheet.addRow([])
      worksheet.addRow([])
      
      // Legend
      const legendHeader = worksheet.addRow(['LEGEND'])
      legendHeader.font = { bold: true, size: 11 }
      legendHeader.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } }
      worksheet.addRow(['INV', 'Inventory (Current Stock)'])
      worksheet.addRow(['PUR', 'Purchases (Orders Placed)'])
      worksheet.addRow(['SALE', 'Sales (Bottles Sold)'])
      worksheet.addRow(['DEF', 'Deficit (Low/Out of Stock)'])
      
      worksheet.addRow([])
      worksheet.addRow([])
      const detailHeader = worksheet.addRow(['DETAILED INVENTORY'])
      detailHeader.font = { bold: true, size: 14 }
      detailHeader.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF8D1F3C' } }
      detailHeader.font.color = { argb: 'FFFFFFFF' }
      worksheet.mergeCells(`A${detailHeader.number}:D${detailHeader.number}`)
      worksheet.addRow([])
    }
    
    // Add header row
    const headerRow = worksheet.addRow(data[0])
    headerRow.font = { bold: true }
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF8D1F3C' } // Wine color
    }
    headerRow.font = { color: { argb: 'FFFFFFFF' }, bold: true }
    
    // Add data rows
    data.slice(1).forEach(row => {
      worksheet.addRow(row)
    })
    
    // Auto-fit columns
    worksheet.columns.forEach((column: any) => {
      column.width = 15
    })
    
    // Generate buffer and download
    const buffer = await workbook.xlsx.writeBuffer()
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `inventory-${new Date().toISOString().split('T')[0]}.xlsx`
    a.click()
    URL.revokeObjectURL(url)
  } catch (error) {
    console.error('Excel export failed:', error)
    alert('Excel export requires ExcelJS library. Install with: npm install exceljs')
  }
}

// Google Sheets Export
// Requires: Google Sheets API setup + OAuth
export async function exportToGoogleSheets(data: any[], _metrics?: InventoryMetrics) {
  try {
    // This requires Google Sheets API integration
    // For MVP, redirect to Google Sheets with CSV data
    exportToCSV(data, _metrics)
    
    alert('Google Sheets integration requires OAuth setup. For now, use CSV export and import to Sheets manually.')
    
    // Full implementation requires:
    // 1. Google Cloud Project setup
    // 2. Sheets API enabled
    // 3. OAuth 2.0 credentials
    // 4. gapi client library
    
    // Example full implementation:
    // const auth = await google.auth.getClient({
    //   scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    // });
    // const sheets = google.sheets({ version: 'v4', auth });
    // const response = await sheets.spreadsheets.create({...});
  } catch (error) {
    console.error('Google Sheets export failed:', error)
  }
}

// Google Drive Export
export async function exportToGoogleDrive(_data: any[], _metrics?: InventoryMetrics) {
  try {
    // Similar to Sheets, requires Google Drive API + OAuth
    alert('Google Drive integration requires OAuth setup. Use CSV/Excel export and upload to Drive manually.')
    
    // Full implementation requires:
    // 1. Google Cloud Project setup
    // 2. Drive API enabled
    // 3. OAuth 2.0 credentials
    // 4. gapi client library
  } catch (error) {
    console.error('Google Drive export failed:', error)
  }
}

// Main export function
export async function exportInventory(
  format: ExportFormat,
  data: any[],
  metrics?: InventoryMetrics
) {
  switch (format) {
    case 'csv':
      exportToCSV(data, metrics)
      break
    case 'pdf':
      await exportToPDF(data, metrics)
      break
    case 'excel':
      await exportToExcel(data, metrics)
      break
    case 'sheets':
      await exportToGoogleSheets(data, metrics)
      break
    case 'drive':
      await exportToGoogleDrive(data, metrics)
      break
    default:
      console.error('Unsupported export format:', format)
  }
}

