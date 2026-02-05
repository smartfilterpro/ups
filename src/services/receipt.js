const sharp = require('sharp');

// Logo URL - can be overridden with LOGO_URL environment variable
const DEFAULT_LOGO_URL = 'https://51568b615cebbb736b16194a197c101f.cdn.bubble.io/f1722603581863x952206576004489300/Logo.svg';

class ReceiptService {
  constructor() {
    this.logoCache = null;
  }

  async fetchLogo() {
    if (this.logoCache) {
      return this.logoCache;
    }

    const logoUrl = process.env.LOGO_URL || DEFAULT_LOGO_URL;

    try {
      const response = await fetch(logoUrl);
      if (response.ok) {
        const svgText = await response.text();
        this.logoCache = svgText;
        return svgText;
      }
    } catch (error) {
      console.error('Failed to fetch logo:', error.message);
    }

    // Return a simple text fallback if logo fetch fails
    return null;
  }

  generateReceiptSVG(data) {
    const {
      shipToName,
      shipToAddress,
      shipToCity,
      shipToState,
      shipToZip,
      items = [],
      boxNumber,
      totalBoxes,
      orderDate,
      orderNumber,
      logoSvg
    } = data;

    // 4x6 inches at 203 DPI (thermal printer standard) = 812 x 1218 pixels
    // Using 600x900 for good quality while keeping file size reasonable
    const width = 600;
    const height = 900;

    // Build items list
    const itemLines = items.map((item, index) => {
      const y = 480 + (index * 35);
      const qty = item.qty || 1;
      const filter = item.filter || item.Filter || 'Filter';
      return `<text x="50" y="${y}" font-family="DejaVu Sans, Liberation Sans, sans-serif" font-size="22" fill="#333">(${qty}) ${escapeXml(filter)}</text>`;
    }).join('\n    ');

    // Calculate total quantity
    const totalQty = items.reduce((sum, item) => sum + (item.qty || 1), 0);

    // Box info
    const boxInfo = (boxNumber && totalBoxes)
      ? `Box ${boxNumber} of ${totalBoxes}`
      : '';

    // Logo section - embed SVG or use text fallback
    let logoSection;
    if (logoSvg) {
      // Extract just the SVG content, remove comments and XML declaration
      const cleanedLogo = logoSvg
        .replace(/<\?xml[^?]*\?>/g, '')
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<svg[^>]*>/, '')
        .replace(/<\/svg>/, '');
      logoSection = `
        <g transform="translate(50, 30) scale(0.8)">
          ${cleanedLogo}
        </g>
      `;
    } else {
      logoSection = `
        <text x="50" y="70" font-family="DejaVu Sans, Liberation Sans, sans-serif" font-size="36" font-weight="bold" fill="#8B9B6B">Smart</text>
        <text x="50" y="110" font-family="DejaVu Sans, Liberation Sans, sans-serif" font-size="36" fill="#333">Filter<tspan font-weight="bold" fill="#8B9B6B">PRO</tspan></text>
      `;
    }

    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <rect width="100%" height="100%" fill="white"/>

  ${logoSection}

  <text x="50" y="180" font-family="DejaVu Sans, Liberation Sans, sans-serif" font-size="28" font-weight="bold" fill="#333">PACKING SLIP</text>

  <line x1="50" y1="200" x2="550" y2="200" stroke="#ccc" stroke-width="2"/>

  <text x="50" y="245" font-family="DejaVu Sans, Liberation Sans, sans-serif" font-size="18" font-weight="bold" fill="#666">SHIP TO:</text>
  <text x="50" y="280" font-family="DejaVu Sans, Liberation Sans, sans-serif" font-size="24" font-weight="bold" fill="#333">${escapeXml(shipToName || '')}</text>
  <text x="50" y="310" font-family="DejaVu Sans, Liberation Sans, sans-serif" font-size="20" fill="#333">${escapeXml(shipToAddress || '')}</text>
  <text x="50" y="340" font-family="DejaVu Sans, Liberation Sans, sans-serif" font-size="20" fill="#333">${escapeXml(shipToCity || '')}${shipToCity && shipToState ? ', ' : ''}${escapeXml(shipToState || '')} ${escapeXml(shipToZip || '')}</text>

  <line x1="50" y1="370" x2="550" y2="370" stroke="#ccc" stroke-width="2"/>

  ${orderNumber ? `<text x="50" y="410" font-family="DejaVu Sans, Liberation Sans, sans-serif" font-size="18" fill="#666">Order: <tspan font-weight="bold" fill="#333">${escapeXml(orderNumber)}</tspan></text>` : ''}
  ${orderDate ? `<text x="350" y="410" font-family="DejaVu Sans, Liberation Sans, sans-serif" font-size="18" fill="#666">Date: <tspan fill="#333">${escapeXml(orderDate)}</tspan></text>` : ''}

  <text x="50" y="455" font-family="DejaVu Sans, Liberation Sans, sans-serif" font-size="18" font-weight="bold" fill="#666">ITEMS:</text>

  ${itemLines}

  <line x1="50" y1="${500 + (items.length * 35)}" x2="550" y2="${500 + (items.length * 35)}" stroke="#ccc" stroke-width="2"/>

  <text x="50" y="${550 + (items.length * 35)}" font-family="DejaVu Sans, Liberation Sans, sans-serif" font-size="22" fill="#333">Total Filters: <tspan font-weight="bold">${totalQty}</tspan></text>
  ${boxInfo ? `<text x="350" y="${550 + (items.length * 35)}" font-family="DejaVu Sans, Liberation Sans, sans-serif" font-size="22" fill="#333">${escapeXml(boxInfo)}</text>` : ''}

  <text x="300" y="${height - 40}" font-family="DejaVu Sans, Liberation Sans, sans-serif" font-size="16" fill="#999" text-anchor="middle">Thank you for your order!</text>
</svg>`;

    return svg;
  }

  async generateReceipt(data) {
    // Try to fetch logo
    const logoSvg = await this.fetchLogo();

    // Generate SVG with logo
    const svg = this.generateReceiptSVG({ ...data, logoSvg });

    // Return SVG as base64 (browsers will render fonts correctly)
    const svgBase64 = Buffer.from(svg).toString('base64');

    return {
      svg: svgBase64,
      format: 'SVG'
    };
  }
}

// Helper function to escape XML special characters
function escapeXml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

module.exports = new ReceiptService();
