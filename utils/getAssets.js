// utils/getAssets.js
const fs = require('fs');
const path = require('path');

const ttdFolder = path.join(__dirname, '../assets/ttd/');
const logoFolder = path.join(__dirname, '../assets/logo/');

function getLogoBase64(templateName){
    const file = path.join(logoFolder, `${templateName.toLowerCase()}.png`);
    return fs.existsSync(file) ? 'data:image/png;base64,' + fs.readFileSync(file).toString('base64') : '';
}

function getTTDHTML(waNumber, maxSize = 150){
    const png = path.join(ttdFolder, `${waNumber}.png`);
    const jpg = path.join(ttdFolder, `${waNumber}.jpg`);
    let base64 = '';
    if(fs.existsSync(png)) base64 = fs.readFileSync(png,'base64');
    else if(fs.existsSync(jpg)) base64 = fs.readFileSync(jpg,'base64');
    return base64 ? `<img src="data:image/png;base64,${base64}" style="max-width:${maxSize}px; max-height:${maxSize}px; display:block; margin:auto;">` : '';
}

module.exports = { getLogoBase64, getTTDHTML };
