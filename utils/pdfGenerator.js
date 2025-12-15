// utils/pdfGenerator.js
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

module.exports = async function generatePDF(html, outputPath) {

  // Pastikan folder exports ada
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const browser = await puppeteer.launch({
    headless: "new"
  });

  const page = await browser.newPage();

  await page.setContent(html, {
    waitUntil: 'networkidle0'
  });

  await page.pdf({
    path: outputPath,
    format: 'A4',
    printBackground: true,
    margin: {
      top: '20mm',
      bottom: '20mm',
      left: '15mm',
      right: '15mm'
    }
  });

  await browser.close();
};
