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

    // 6x4 inches LANDSCAPE orientation (matching shipping label)
    const width = 600;
    const height = 400;

    // Build items list (smaller font, tighter spacing for landscape)
    const itemLines = items.map((item, index) => {
      const y = 195 + (index * 22);
      const qty = item.qty || 1;
      const filter = item.filter || item.Filter || 'Filter';
      return `<text x="320" y="${y}" font-family="DejaVu Sans, Liberation Sans, sans-serif" font-size="14" fill="#000">(${qty}) ${escapeXml(filter)}</text>`;
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
      const cleanedLogo = logoSvg
        .replace(/<\?xml[^?]*\?>/g, '')
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<svg[^>]*>/, '')
        .replace(/<\/svg>/, '');
      logoSection = `
        <g transform="translate(20, 15) scale(0.5)">
          ${cleanedLogo}
        </g>
      `;
    } else {
      logoSection = `
        <text x="20" y="45" font-family="DejaVu Sans, Liberation Sans, sans-serif" font-size="24" font-weight="bold" fill="#8B9B6B">Smart</text>
        <text x="20" y="70" font-family="DejaVu Sans, Liberation Sans, sans-serif" font-size="24" fill="#333">Filter<tspan font-weight="bold" fill="#8B9B6B">PRO</tspan></text>
      `;
    }

    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <rect width="100%" height="100%" fill="white"/>
  <rect x="5" y="5" width="${width - 10}" height="${height - 10}" fill="none" stroke="#000" stroke-width="2"/>

  ${logoSection}

  <text x="200" y="50" font-family="DejaVu Sans, Liberation Sans, sans-serif" font-size="20" font-weight="bold" fill="#000">PACKING SLIP</text>

  <line x1="20" y1="85" x2="580" y2="85" stroke="#000" stroke-width="1"/>

  <text x="20" y="105" font-family="DejaVu Sans, Liberation Sans, sans-serif" font-size="12" font-weight="bold" fill="#000">SHIP TO:</text>
  <text x="20" y="125" font-family="DejaVu Sans, Liberation Sans, sans-serif" font-size="16" font-weight="bold" fill="#000">${escapeXml(shipToName || '')}</text>
  <text x="20" y="145" font-family="DejaVu Sans, Liberation Sans, sans-serif" font-size="14" fill="#000">${escapeXml(shipToAddress || '')}</text>
  <text x="20" y="165" font-family="DejaVu Sans, Liberation Sans, sans-serif" font-size="14" fill="#000">${escapeXml(shipToCity || '')}${shipToCity && shipToState ? ', ' : ''}${escapeXml(shipToState || '')} ${escapeXml(shipToZip || '')}</text>

  <line x1="300" y1="95" x2="300" y2="300" stroke="#000" stroke-width="1"/>

  <text x="320" y="105" font-family="DejaVu Sans, Liberation Sans, sans-serif" font-size="12" font-weight="bold" fill="#000">ITEMS:</text>
  ${itemLines}

  <line x1="20" y1="310" x2="580" y2="310" stroke="#000" stroke-width="1"/>

  ${orderNumber ? `<text x="20" y="330" font-family="DejaVu Sans, Liberation Sans, sans-serif" font-size="12" font-weight="bold" fill="#000">Order: <tspan font-weight="bold" fill="#000">${escapeXml(orderNumber)}</tspan></text>` : ''}
  ${orderDate ? `<text x="150" y="330" font-family="DejaVu Sans, Liberation Sans, sans-serif" font-size="12" font-weight="bold" fill="#000">Date: <tspan fill="#000">${escapeXml(orderDate)}</tspan></text>` : ''}
  <text x="320" y="330" font-family="DejaVu Sans, Liberation Sans, sans-serif" font-size="14" font-weight="bold" fill="#000">Total Filters: <tspan font-weight="bold">${totalQty}</tspan></text>
  ${boxInfo ? `<text x="480" y="330" font-family="DejaVu Sans, Liberation Sans, sans-serif" font-size="14" font-weight="bold" fill="#000">${escapeXml(boxInfo)}</text>` : ''}

  <text x="300" y="370" font-family="DejaVu Sans, Liberation Sans, sans-serif" font-size="12" fill="#000" text-anchor="middle">Thank you for your order!</text>
</svg>`;

    return svg;
  }

  async generateReceipt(data) {
    const logoSvg = await this.fetchLogo();
    const svg = this.generateReceiptSVG({ ...data, logoSvg });
    const svgBase64 = Buffer.from(svg).toString('base64');

    return {
      svg: svgBase64,
      format: 'SVG'
    };
  }
}

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
