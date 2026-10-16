export interface ReportFilter {
  label: string;
  value: string;
}

export interface ReportMetric {
  label: string;
  value: string | number;
  highlight?: boolean;
}

export interface PrintReportConfig {
  title: string;
  subtitle: string;
  period: string;
  filters: ReportFilter[];
  metrics: ReportMetric[];
  headers: string[];
  rows: (string | number)[][];
  orientation?: 'portrait' | 'landscape';
  companyName?: string;
  confidentialNotice?: string;
}

/**
 * Generates an executive-grade, standalone printable HTML document
 * fully equipped for physical printers, Save-As-PDF, and browser display.
 */
export function generateReportHtml(config: PrintReportConfig): string {
  const {
    title,
    subtitle,
    period,
    filters = [],
    metrics = [],
    headers = [],
    rows = [],
    orientation = 'landscape',
    companyName = 'WorkNest HRMS — Enterprise Workforce Operations',
    confidentialNotice = 'CONFIDENTIAL • Internal Management & Statutory Audit Report • Unauthorized Distribution Prohibited',
  } = config;

  const now = new Date();
  const printTimestamp = `${now.toLocaleDateString('en-US', {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })} at ${now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;

  const filtersHtml = filters
    .map(
      (f) => `
        <span class="filter-pill">
          <strong class="filter-label">${escapeHtml(f.label)}:</strong> ${escapeHtml(f.value)}
        </span>
      `
    )
    .join('');

  const metricsHtml = metrics
    .map(
      (m) => `
        <div class="metric-card ${m.highlight ? 'metric-highlight' : ''}">
          <div class="metric-label">${escapeHtml(m.label)}</div>
          <div class="metric-value">${escapeHtml(String(m.value))}</div>
        </div>
      `
    )
    .join('');

  const tableHeaderHtml = headers
    .map((h) => `<th>${escapeHtml(h)}</th>`)
    .join('');

  const tableRowsHtml = rows
    .map((row, idx) => {
      const isAlt = idx % 2 === 1;
      const cols = row
        .map((col, colIdx) => {
          const val = col === null || col === undefined ? '' : String(col);
          const isNumeric = /^\d+(\.\d+)?$/.test(val.replace(/,/g, ''));
          const isBadge =
            /^(present|on-time|active|paid|approved|online)$/i.test(val.trim()) ||
            /^(late|early-checkout|pending|warning)$/i.test(val.trim()) ||
            /^(absent|rejected|inactive|offline)$/i.test(val.trim());

          let cellContent = escapeHtml(val);
          if (isBadge) {
            const vLow = val.toLowerCase().trim();
            let badgeClass = 'badge-neutral';
            if (['present', 'on-time', 'active', 'paid', 'approved', 'online'].includes(vLow)) {
              badgeClass = 'badge-success';
            } else if (['late', 'early-checkout', 'pending', 'warning'].includes(vLow)) {
              badgeClass = 'badge-warning';
            } else if (['absent', 'rejected', 'inactive', 'offline'].includes(vLow)) {
              badgeClass = 'badge-danger';
            }
            cellContent = `<span class="badge ${badgeClass}">${cellContent}</span>`;
          }

          return `<td class="${isNumeric && colIdx > 1 ? 'text-right font-mono' : ''}">${cellContent}</td>`;
        })
        .join('');
      return `<tr class="${isAlt ? 'row-alt' : ''}">${cols}</tr>`;
    })
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)} — ${escapeHtml(period)}</title>
  <style>
    @page {
      size: ${orientation === 'landscape' ? 'A4 landscape' : 'A4 portrait'};
      margin: 10mm 12mm 12mm 12mm;
    }

    *, *::before, *::after {
      box-sizing: border-box;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }

    body {
      margin: 0;
      padding: 16px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      color: #0f172a;
      background: #f8fafc;
      font-size: 11px;
      line-height: 1.4;
    }

    .report-sheet {
      max-width: ${orientation === 'landscape' ? '1280px' : '960px'};
      margin: 0 auto;
      background: #ffffff;
      padding: 24px;
      border-radius: 8px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.06);
    }

    /* Screen-Only Control Toolbar */
    .screen-toolbar {
      position: sticky;
      top: 10px;
      z-index: 1000;
      max-width: ${orientation === 'landscape' ? '1280px' : '960px'};
      margin: 0 auto 16px auto;
      background: #0f172a;
      color: #ffffff;
      padding: 12px 20px;
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      box-shadow: 0 10px 25px -5px rgba(15, 23, 42, 0.4);
    }

    .toolbar-title {
      font-size: 13px;
      font-weight: 700;
      letter-spacing: -0.01em;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .toolbar-actions {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .btn {
      padding: 8px 16px;
      font-size: 12px;
      font-weight: 700;
      border-radius: 8px;
      cursor: pointer;
      border: none;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: background 0.15s ease;
      text-decoration: none;
    }

    .btn-primary {
      background: #4f46e5;
      color: #ffffff;
    }
    .btn-primary:hover {
      background: #4338ca;
    }

    .btn-secondary {
      background: #334155;
      color: #f1f5f9;
    }
    .btn-secondary:hover {
      background: #475569;
    }

    /* Report Corporate Header */
    .company-banner {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 2px solid #0f172a;
      padding-bottom: 14px;
      margin-bottom: 16px;
    }

    .company-title {
      font-size: 18px;
      font-weight: 900;
      color: #0f172a;
      letter-spacing: -0.02em;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .report-name {
      font-size: 14px;
      font-weight: 800;
      color: #312e81;
      margin-top: 4px;
      letter-spacing: -0.01em;
    }

    .report-sub {
      font-size: 10px;
      color: #64748b;
      margin-top: 2px;
    }

    .meta-box {
      text-align: right;
      font-size: 10px;
      color: #475569;
      line-height: 1.5;
    }

    .meta-box strong {
      color: #0f172a;
    }

    /* Filters Bar */
    .filters-bar {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      align-items: center;
      margin-bottom: 14px;
      padding: 8px 12px;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
    }

    .filter-pill {
      font-size: 10px;
      color: #334155;
      background: #ffffff;
      padding: 3px 8px;
      border-radius: 4px;
      border: 1px solid #cbd5e1;
    }

    .filter-label {
      color: #64748b;
    }

    /* Executive Metrics */
    .metrics-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
      gap: 8px;
      margin-bottom: 16px;
    }

    .metric-card {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      padding: 8px 12px;
    }

    .metric-highlight {
      background: #eef2ff;
      border-color: #c7d2fe;
    }

    .metric-label {
      font-size: 9px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #64748b;
    }

    .metric-value {
      font-size: 15px;
      font-weight: 900;
      color: #0f172a;
      margin-top: 2px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    }

    /* Data Table */
    .table-container {
      width: 100%;
      margin-bottom: 20px;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 10px;
      page-break-inside: auto;
    }

    thead {
      display: table-header-group;
    }

    tr {
      page-break-inside: avoid;
      page-break-after: auto;
    }

    th {
      background: #0f172a;
      color: #ffffff;
      font-weight: 700;
      text-align: left;
      padding: 7px 8px;
      border: 1px solid #0f172a;
      font-size: 9.5px;
      letter-spacing: 0.02em;
      white-space: nowrap;
    }

    td {
      padding: 6px 8px;
      border: 1px solid #e2e8f0;
      color: #1e293b;
      vertical-align: middle;
    }

    .row-alt {
      background-color: #f8fafc;
    }

    .text-right {
      text-align: right;
    }

    .font-mono {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    }

    /* Badges */
    .badge {
      display: inline-block;
      padding: 2px 6px;
      font-size: 8.5px;
      font-weight: 700;
      border-radius: 4px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .badge-success {
      background: #dcfce7;
      color: #15803d;
      border: 1px solid #bbf7d0;
    }

    .badge-warning {
      background: #fef3c7;
      color: #b45309;
      border: 1px solid #fde68a;
    }

    .badge-danger {
      background: #ffe4e6;
      color: #be123c;
      border: 1px solid #fecdd3;
    }

    .badge-neutral {
      background: #f1f5f9;
      color: #475569;
      border: 1px solid #e2e8f0;
    }

    /* Sign-off Block */
    .signatures-block {
      margin-top: 36px;
      padding-top: 16px;
      display: flex;
      justify-content: space-between;
      page-break-inside: avoid;
    }

    .sig-col {
      width: 28%;
      text-align: center;
    }

    .sig-line {
      border-top: 1px dashed #64748b;
      margin-bottom: 6px;
      padding-top: 4px;
    }

    .sig-title {
      font-size: 10px;
      font-weight: 700;
      color: #0f172a;
    }

    .sig-role {
      font-size: 9px;
      color: #64748b;
    }

    /* Document Footer */
    .doc-footer {
      margin-top: 24px;
      padding-top: 10px;
      border-top: 1px solid #cbd5e1;
      font-size: 9px;
      color: #94a3b8;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    /* Print-Only Overrides */
    @media print {
      body {
        padding: 0 !important;
        margin: 0 !important;
        background: #ffffff !important;
      }
      .report-sheet {
        padding: 0 !important;
        max-width: 100% !important;
        box-shadow: none !important;
        border-radius: 0 !important;
      }
      .screen-toolbar, .no-print {
        display: none !important;
      }
    }
  </style>
</head>
<body>
  <!-- Screen Floating Control Toolbar -->
  <div class="screen-toolbar no-print">
    <div class="toolbar-title">
      <span>🖨️</span>
      <span>${escapeHtml(title)} — Print &amp; PDF View</span>
    </div>
    <div class="toolbar-actions">
      <button class="btn btn-primary" onclick="window.print()">
        <span>🖨️</span>
        <span>Print / Save as PDF</span>
      </button>
      <button class="btn btn-secondary" onclick="window.close()">
        <span>✕</span>
        <span>Close Window</span>
      </button>
    </div>
  </div>

  <div class="report-sheet">
    <!-- Corporate Banner -->
    <div class="company-banner">
      <div>
        <div class="company-title">
          <span>🏛️</span>
          <span>${escapeHtml(companyName)}</span>
        </div>
        <div class="report-name">${escapeHtml(title)}</div>
        <div class="report-sub">${escapeHtml(subtitle)}</div>
      </div>
      <div class="meta-box">
        <div><strong>Reporting Period:</strong> ${escapeHtml(period)}</div>
        <div><strong>Generated On:</strong> ${escapeHtml(printTimestamp)}</div>
        <div><strong>Total Records:</strong> ${rows.length}</div>
        <div><strong>Status:</strong> Official Audit Certified</div>
      </div>
    </div>

    <!-- Active Filters -->
    ${
      filters.length > 0
        ? `
      <div class="filters-bar">
        <strong style="color: #0f172a; font-size: 10px; margin-right: 4px;">Applied Filters:</strong>
        ${filtersHtml}
      </div>
    `
        : ''
    }

    <!-- Key Metrics Grid -->
    ${
      metrics.length > 0
        ? `
      <div class="metrics-grid">
        ${metricsHtml}
      </div>
    `
        : ''
    }

    <!-- Tabular Data -->
    <div class="table-container">
      <table>
        <thead>
          <tr>
            ${tableHeaderHtml}
          </tr>
        </thead>
        <tbody>
          ${tableRowsHtml}
        </tbody>
      </table>
    </div>

    <!-- Sign-off Block -->
    <div class="signatures-block">
      <div class="sig-col">
        <div class="sig-line"></div>
        <div class="sig-title">Prepared By</div>
        <div class="sig-role">HR Operations Executive</div>
      </div>
      <div class="sig-col">
        <div class="sig-line"></div>
        <div class="sig-title">Verified &amp; Audited By</div>
        <div class="sig-role">Head of Human Resources</div>
      </div>
      <div class="sig-col">
        <div class="sig-line"></div>
        <div class="sig-title">Approved By</div>
        <div class="sig-role">Managing Director / Authorized Signatory</div>
      </div>
    </div>

    <!-- Doc Footer -->
    <div class="doc-footer">
      <span>${escapeHtml(confidentialNotice)}</span>
      <span>WorkNest Automated HR Operations • Page 1 of Official Audit Report</span>
    </div>
  </div>

  <script>
    // Autofocus and prepare print if requested
    window.onload = function() {
      window.focus();
    };
  </script>
</body>
</html>`;
}

/**
 * Escapes HTML characters to prevent XSS.
 */
function escapeHtml(str: string): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Prints HTML via an isolated hidden iframe with cross-browser resilience.
 */
export function printViaIframe(htmlContent: string): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const existing = document.getElementById('worknest-report-print-iframe');
      if (existing) existing.remove();

      const iframe = document.createElement('iframe');
      iframe.id = 'worknest-report-print-iframe';
      iframe.style.position = 'fixed';
      iframe.style.left = '-10000px';
      iframe.style.top = '0';
      iframe.style.width = '1024px';
      iframe.style.height = '768px';
      iframe.style.border = '0';
      iframe.style.opacity = '0.01';
      iframe.style.pointerEvents = 'none';
      iframe.style.zIndex = '-1';
      document.body.appendChild(iframe);

      const iframeDoc = iframe.contentWindow?.document;
      if (!iframeDoc) {
        resolve(false);
        return;
      }

      iframeDoc.open();
      iframeDoc.write(htmlContent);
      iframeDoc.close();

      setTimeout(() => {
        try {
          iframe.contentWindow?.focus();
          iframe.contentWindow?.print();
          resolve(true);
        } catch (err) {
          console.warn('Iframe print failed, falling back:', err);
          resolve(false);
        }
      }, 120);
    } catch (err) {
      console.warn('Error setting up print iframe:', err);
      resolve(false);
    }
  });
}

/**
 * Downloads the printable report as a standalone .html file.
 * The user can open it offline and print or Save As PDF with 100% fidelity.
 */
export function downloadReportHtml(filename: string, htmlContent: string): void {
  const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${filename}_${new Date().toISOString().slice(0, 10)}.html`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Copies the report table to clipboard in TSV (Tab Separated Values) format
 * for pasting straight into Microsoft Excel or Google Sheets.
 */
export async function copyReportAsTsv(headers: string[], rows: (string | number)[][]): Promise<boolean> {
  try {
    const tsvContent = [
      headers.join('\t'),
      ...rows.map((row) =>
        row
          .map((cell) => {
            const str = cell === null || cell === undefined ? '' : String(cell);
            return str.replace(/\t/g, ' ').replace(/\n/g, ' ');
          })
          .join('\t')
      ),
    ].join('\n');

    await navigator.clipboard.writeText(tsvContent);
    return true;
  } catch (err) {
    console.warn('Failed to copy TSV to clipboard:', err);
    return false;
  }
}
