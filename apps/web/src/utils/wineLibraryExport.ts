/**
 * Wine Library Export Utility
 * 
 * Exports wine library data to Excel format with comprehensive wine information
 */

import { Wine } from '../data/wineData'
import ExcelJS from 'exceljs'

/**
 * Export Wine Library to Excel (XLSX format)
 * Uses the ExcelJS library for Excel generation with styling
 */
export async function exportWineLibraryToExcel(
  wines: Wine[],
  filename: string = 'wine-library-export.xlsx'
): Promise<void> {
  try {
    // Create workbook and worksheet
    const workbook = new ExcelJS.Workbook()
    const worksheet = workbook.addWorksheet('Wine Library', {
      views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }] // Freeze header row
    })

    // Define columns with headers
    worksheet.columns = [
      { header: 'No.', key: 'no', width: 6 },
      { header: 'Wine ID', key: 'wineId', width: 12 },
      { header: 'SKU', key: 'sku', width: 15 },
      { header: 'Wine Name', key: 'name', width: 35 },
      { header: 'Producer', key: 'producer', width: 25 },
      { header: 'Vintage', key: 'vintage', width: 10 },
      { header: 'Type', key: 'type', width: 12 },
      { header: 'Grape Variety', key: 'grape', width: 20 },
      { header: 'Country', key: 'country', width: 15 },
      { header: 'Region', key: 'region', width: 20 },
      { header: 'Appellation', key: 'appellation', width: 20 },
      { header: 'Body', key: 'body', width: 12 },
      { header: 'Sweetness', key: 'sweetness', width: 12 },
      { header: 'Acidity', key: 'acidity', width: 12 },
      { header: 'Alcohol %', key: 'alcohol', width: 10 },
      { header: 'Aromas', key: 'aromas', width: 40 },
      { header: 'Flavors', key: 'flavors', width: 40 },
      { header: 'Current Stock', key: 'stock', width: 12 },
      { header: 'Threshold', key: 'threshold', width: 10 },
      { header: 'Stock Status', key: 'status', width: 15 },
      { header: 'Active', key: 'active', width: 8 },
      { header: 'Price ($)', key: 'price', width: 10 },
      { header: 'Provider Name', key: 'providerName', width: 25 },
      { header: 'Provider Contact', key: 'providerContact', width: 20 },
      { header: 'Provider Phone', key: 'providerPhone', width: 15 },
      { header: 'Provider Email', key: 'providerEmail', width: 25 },
      { header: 'Provider Address', key: 'providerAddress', width: 30 },
    ]

    // Style header row
    worksheet.getRow(1).font = { bold: true, size: 11 }
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF4F46E5' } // Wine purple
    }
    worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
    worksheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' }
    worksheet.getRow(1).height = 25

    // Add data rows
    wines.forEach((wine, index) => {
      const row = worksheet.addRow({
        no: index + 1,
        wineId: wine.id,
        sku: wine.sku || 'N/A',
        name: wine.name,
        producer: wine.producer,
        vintage: wine.vintage || 'NV',
        type: wine.type.charAt(0).toUpperCase() + wine.type.slice(1),
        grape: wine.grape,
        country: wine.country,
        region: wine.region,
        appellation: wine.appellation,
        body: wine.body,
        sweetness: wine.sweetness,
        acidity: wine.acidity,
        alcohol: wine.alcohol,
        aromas: wine.aromas.join(', '),
        flavors: wine.flavors.join(', '),
        stock: wine.liveStock || 0,
        threshold: wine.threshold,
        status: getStockStatus(wine),
        active: wine.isActive !== false ? 'Yes' : 'No',
        price: wine.price,
        providerName: wine.provider.name,
        providerContact: wine.provider.contact,
        providerPhone: wine.provider.phone,
        providerEmail: wine.provider.email || 'N/A',
        providerAddress: wine.provider.address || 'N/A',
      })

      // Color code stock status
      const stockStatus = getStockStatus(wine)
      const stockCell = row.getCell('status')
      
      if (stockStatus === 'Out of Stock' || stockStatus === 'Critical') {
        stockCell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFFECACA' } // Light red
        }
        stockCell.font = { color: { argb: 'FF991B1B' } } // Dark red
      } else if (stockStatus === 'Low Stock') {
        stockCell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFFEF3C7' } // Light amber
        }
        stockCell.font = { color: { argb: 'FF92400E' } } // Dark amber
      } else if (stockStatus === 'In Stock') {
        stockCell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFD1FAE5' } // Light green
        }
        stockCell.font = { color: { argb: 'FF065F46' } } // Dark green
      }

      // Format price as currency
      row.getCell('price').numFmt = '$#,##0.00'
    })

    // Add borders to all cells
    worksheet.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell((cell) => {
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
          left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
          bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
          right: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        }
      })
    })

    // Add Summary Sheet
    const summarySheet = workbook.addWorksheet('Summary')
    const summaryData = generateSummaryData(wines)
    
    summarySheet.columns = [
      { header: 'Metric', key: 'metric', width: 30 },
      { header: 'Value', key: 'value', width: 20 },
    ]

    // Style summary header
    summarySheet.getRow(1).font = { bold: true, size: 11 }
    summarySheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF4F46E5' }
    }
    summarySheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
    summarySheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' }

    // Add summary data
    summaryData.forEach((item) => {
      const row = summarySheet.addRow(item)
      if (item.metric && !item.metric.startsWith('  ')) {
        row.font = { bold: true }
      }
    })

    // Generate Excel file and download
    const buffer = await workbook.xlsx.writeBuffer()
    const blob = new Blob([buffer], { 
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' 
    })
    
    const link = document.createElement('a')
    const url = URL.createObjectURL(blob)
    link.setAttribute('href', url)
    link.setAttribute('download', filename)
    link.style.visibility = 'hidden'
    
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)

    console.log(`✅ Wine Library exported successfully: ${filename}`)
  } catch (error) {
    console.error('❌ Error exporting Wine Library to Excel:', error)
    throw new Error('Failed to export Wine Library to Excel')
  }
}

/**
 * Export Wine Library to CSV format
 */
export function exportWineLibraryToCSV(
  wines: Wine[],
  filename: string = 'wine-library-export.csv'
): void {
  try {
    // Prepare CSV headers
    const headers = [
      'No.',
      'Wine ID',
      'SKU',
      'Wine Name',
      'Producer',
      'Vintage',
      'Type',
      'Grape Variety',
      'Country',
      'Region',
      'Appellation',
      'Body',
      'Sweetness',
      'Acidity',
      'Alcohol %',
      'Aromas',
      'Flavors',
      'Current Stock',
      'Threshold',
      'Stock Status',
      'Active',
      'Price ($)',
      'Provider Name',
      'Provider Contact',
      'Provider Phone',
      'Provider Email',
      'Provider Address',
    ]

    // Prepare CSV rows
    const rows = wines.map((wine, index) => [
      index + 1,
      wine.id,
      wine.sku || 'N/A',
      wine.name,
      wine.producer,
      wine.vintage || 'NV',
      wine.type.charAt(0).toUpperCase() + wine.type.slice(1),
      wine.grape,
      wine.country,
      wine.region,
      wine.appellation,
      wine.body,
      wine.sweetness,
      wine.acidity,
      wine.alcohol,
      wine.aromas.join('; '),
      wine.flavors.join('; '),
      wine.liveStock || 0,
      wine.threshold,
      getStockStatus(wine),
      wine.isActive !== false ? 'Yes' : 'No',
      wine.price.toFixed(2),
      wine.provider.name,
      wine.provider.contact,
      wine.provider.phone,
      wine.provider.email || 'N/A',
      wine.provider.address || 'N/A',
    ])

    // Convert to CSV string
    const csvContent = [
      headers.join(','),
      ...rows.map(row => 
        row.map(cell => {
          // Escape cells containing commas, quotes, or newlines
          const cellStr = String(cell)
          if (cellStr.includes(',') || cellStr.includes('"') || cellStr.includes('\n')) {
            return `"${cellStr.replace(/"/g, '""')}"`
          }
          return cellStr
        }).join(',')
      ),
    ].join('\n')

    // Create blob and download
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    const url = URL.createObjectURL(blob)
    
    link.setAttribute('href', url)
    link.setAttribute('download', filename)
    link.style.visibility = 'hidden'
    
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)

    console.log(`✅ Wine Library exported successfully: ${filename}`)
  } catch (error) {
    console.error('❌ Error exporting Wine Library to CSV:', error)
    throw new Error('Failed to export Wine Library to CSV')
  }
}

/**
 * Get stock status label
 */
function getStockStatus(wine: Wine): string {
  const stock = wine.liveStock || 0
  const threshold = wine.threshold
  const ratio = stock / threshold

  if (stock === 0) return 'Out of Stock'
  if (ratio <= 0.25) return 'Critical'
  if (ratio <= 0.5) return 'Low Stock'
  if (ratio <= 1) return 'Below Minimum'
  return 'In Stock'
}

/**
 * Generate summary statistics for the summary sheet
 */
function generateSummaryData(wines: Wine[]): Array<{ metric: string; value: string | number }> {
  const totalWines = wines.length
  const activeWines = wines.filter(w => w.isActive !== false).length
  const inactiveWines = totalWines - activeWines

  // Count by type
  const typeCount = wines.reduce((acc, wine) => {
    acc[wine.type] = (acc[wine.type] || 0) + 1
    return acc
  }, {} as Record<string, number>)

  // Count by stock status
  const stockStatusCount = wines.reduce((acc, wine) => {
    const status = getStockStatus(wine)
    acc[status] = (acc[status] || 0) + 1
    return acc
  }, {} as Record<string, number>)

  // Count by country
  const countryCount = wines.reduce((acc, wine) => {
    acc[wine.country] = (acc[wine.country] || 0) + 1
    return acc
  }, {} as Record<string, number>)

  // Calculate totals
  const totalStock = wines.reduce((sum, wine) => sum + (wine.liveStock || 0), 0)
  const totalValue = wines.reduce((sum, wine) => sum + (wine.price * (wine.liveStock || 0)), 0)
  const avgPrice = wines.reduce((sum, wine) => sum + wine.price, 0) / totalWines

  return [
    { metric: 'Total Wines', value: totalWines },
    { metric: 'Active Wines', value: activeWines },
    { metric: 'Inactive Wines', value: inactiveWines },
    { metric: '', value: '' },
    { metric: 'Wine Types', value: '' },
    ...Object.entries(typeCount).map(([type, count]) => ({
      metric: `  ${type.charAt(0).toUpperCase() + type.slice(1)}`,
      value: count,
    })),
    { metric: '', value: '' },
    { metric: 'Stock Status', value: '' },
    ...Object.entries(stockStatusCount).map(([status, count]) => ({
      metric: `  ${status}`,
      value: count,
    })),
    { metric: '', value: '' },
    { metric: 'Top 5 Countries', value: '' },
    ...Object.entries(countryCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([country, count]) => ({
        metric: `  ${country}`,
        value: count,
      })),
    { metric: '', value: '' },
    { metric: 'Total Stock (bottles)', value: totalStock },
    { metric: 'Total Inventory Value', value: `$${totalValue.toFixed(2)}` },
    { metric: 'Average Price per Bottle', value: `$${avgPrice.toFixed(2)}` },
  ]
}
