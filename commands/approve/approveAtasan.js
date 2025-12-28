// approveAtasan.js
const { MessageMedia } = require('whatsapp-web.js');
const { sendTyping } = require('../../utils/sendTyping');
const path = require('path');
const fs = require('fs');
const generatePDF = require('../../utils/pdfGenerator');
const moment = require('moment');

module.exports = async function approveAtasan(chat, user, pesan, db) {
    const query = (sql, params = []) =>
        new Promise((resolve, reject) =>
            db.query(sql, params, (err, res) => err ? reject(err) : resolve(res))
        );

    const rawText = pesan || '';
    const text = rawText.trim().toLowerCase();

    try {
        // Ambil data atasan
        const [atasan] = await query(
            `SELECT * FROM users WHERE wa_number=? LIMIT 1`,
            [user.wa_number]
        );
        if (!atasan || atasan.jabatan !== 'Head') {
            return sendTyping(chat, 'Maaf, hanya Head yang bisa melakukan approval.');
        }

        // Daftar pending
        if (text === 'status') {
            const pendingList = await query(
                `SELECT a.*, u.nama_lengkap AS user_nama, u.export_type
                 FROM approvals a
                 JOIN users u ON u.id = a.user_id
                 WHERE a.approver_wa=? AND a.status='pending'
                 ORDER BY a.created_at ASC`,
                [user.wa_number]
            );

            if (!pendingList.length) return sendTyping(chat, 'Tidak ada laporan yang menunggu approval.');

            let msg = '*Daftar Laporan Pending:*\n';
            pendingList.forEach(a => msg += `- ${a.export_type}-${a.user_nama}\n`);
            return sendTyping(chat, msg);
        }

        // Ambil approval terakhir
        const [approval] = await query(
            `SELECT a.*,
                    u.wa_number AS user_wa,
                    u.nama_lengkap AS user_nama,
                    u.nik AS user_nik,
                    u.jabatan AS user_jabatan,
                    u.template_export,
                    u.export_type
             FROM approvals a
             JOIN users u ON u.id = a.user_id
             WHERE a.approver_wa=? 
               AND a.status IN ('pending','revised')
             ORDER BY a.created_at DESC
             LIMIT 1`,
            [user.wa_number]
        );

        if (!approval)
            return sendTyping(chat, 'Tidak ada laporan yang menunggu approval.');

        const userWA = approval.user_wa.includes('@') ? approval.user_wa : approval.user_wa + '@c.us';

        // Regex approve/revisi per user
        const match = text.match(/^(approve|revisi)\s+(\w+)-(.+)$/i);
        if (match) {
            const action = match[1].toLowerCase();
            const export_type = match[2].toLowerCase();
            const user_nama = match[3].trim();

            const [approvalSelected] = await query(
                `SELECT a.*, u.wa_number AS user_wa, u.nama_lengkap AS user_nama, u.nik AS user_nik,
                        u.jabatan AS user_jabatan, u.template_export, u.export_type
                 FROM approvals a
                 JOIN users u ON u.id = a.user_id
                 WHERE a.approver_wa=? AND a.status='pending' AND u.nama_lengkap=? AND u.export_type=?`,
                [user.wa_number, user_nama, export_type]
            );

            if (!approvalSelected) return sendTyping(chat, `Tidak ditemukan laporan ${export_type}-${user_nama} yang menunggu approval.`);

            if (action === 'approve') {
                return await processApprove(chat, approvalSelected, atasan, query);
            } else if (action === 'revisi') {
                await query(`UPDATE approvals SET status='revised', step_input='alasan_revisi' WHERE id=?`, [approvalSelected.id]);
                return sendTyping(chat, `Silakan ketik *alasan revisi* untuk ${export_type}-${user_nama}.`);
            }
        }

        // Input alasan revisi
        if (approval.step_input === 'alasan_revisi') {
            if (approval.status !== 'revised') return sendTyping(chat, 'Status laporan tidak valid untuk revisi.');
            if (rawText.trim().length < 3) return sendTyping(chat, 'Silakan ketik *alasan revisi* yang jelas.');

            await query(`UPDATE approvals SET revisi_catatan=?, step_input=NULL WHERE id=?`,
                        [rawText.trim(), approval.id]);

            await chat.client.sendMessage(userWA,
                `*LAPORAN PERLU REVISI*\n\n` +
                `Approval: *${atasan.nama_lengkap}*\n\n` +
                `*Catatan revisi:*\n${rawText.trim()}\n\n` +
                `Silakan perbaiki dan lakukan */export* ulang.`
            );

            return sendTyping(chat, 'Revisi berhasil dikirim.');
        }

        // Perintah revisi sederhana
        if (text === 'revisi') {
            if (approval.status !== 'pending')
                return sendTyping(chat, 'Laporan sudah direvisi atau tidak bisa direvisi lagi.');

            await query(`UPDATE approvals SET status='revised', step_input='alasan_revisi' WHERE id=?`, [approval.id]);
            return sendTyping(chat, 'Silakan ketik *alasan revisi*.');
        }

        // Perintah approve sederhana
        if (text === 'approve') {
            if (approval.status !== 'pending')
                return sendTyping(chat, 'Laporan ini tidak bisa di-approve karena sudah direvisi.');

            return await processApprove(chat, approval, atasan, query);
        }

        if (text !== 'approve' && text !== 'revisi') {
            return sendTyping(chat, 'Ketik *approve* atau *revisi*.');
        }

    } catch (err) {
        console.error(err);
        return sendTyping(chat, 'Terjadi error pada sistem approval.');
    }
};

// Fungsi terpisah untuk proses approve
async function processApprove(chat, approval, atasan, query) {
    const path = require('path');
    const fs = require('fs');

    const templateRaw = approval.template_export || 'LMD';
    const templateName = templateRaw.toUpperCase();
    const templateLogo = templateRaw.toLowerCase();

    let logoBase64 = '';
    let logoPath = path.join(__dirname, '../../assets/logo', `${templateLogo}.png`);
    if (!fs.existsSync(logoPath)) logoPath = path.join(__dirname, '../../assets/logo/default.png');
    if (fs.existsSync(logoPath)) logoBase64 = fs.readFileSync(logoPath, 'base64');

    let ttdAtasanBase64 = '';
    const ttdPng = path.join(__dirname, '../../assets/ttd', `${atasan.wa_number}.png`);
    const ttdJpg = path.join(__dirname, '../../assets/ttd', `${atasan.wa_number}.jpg`);
    if (fs.existsSync(ttdPng)) ttdAtasanBase64 = fs.readFileSync(ttdPng, 'base64');
    else if (fs.existsSync(ttdJpg)) ttdAtasanBase64 = fs.readFileSync(ttdJpg, 'base64');

    if (!ttdAtasanBase64 && approval.step_input !== 'ttd_atasan') {
        await sendTyping(chat, 'Silakan kirim foto TTD kamu untuk approve laporan ini.');
        await query(`UPDATE approvals SET step_input='ttd_atasan' WHERE id=?`, [approval.id]);
        return;
    }

    if (ttdAtasanBase64 && approval.step_input === 'ttd_atasan') {
        await query(`UPDATE approvals SET step_input=NULL WHERE id=?`, [approval.id]);
    }

    let ttdUserBase64 = '';
    const ttdUserPng = path.join(__dirname, '../../assets/ttd', `${approval.user_wa}.png`);
    const ttdUserJpg = path.join(__dirname, '../../assets/ttd', `${approval.user_wa}.jpg`);
    if (fs.existsSync(ttdUserPng)) ttdUserBase64 = fs.readFileSync(ttdUserPng, 'base64');
    else if (fs.existsSync(ttdUserJpg)) ttdUserBase64 = fs.readFileSync(ttdUserJpg, 'base64');

    let outputPath;
    if (approval.export_type === 'lembur') {
        outputPath = await generatePDFLemburForAtasan(approval, query, ttdAtasanBase64, ttdUserBase64);
    } else {
        outputPath = await generatePDFForAtasan(approval, query, ttdAtasanBase64, ttdUserBase64);
    }

    await query(`UPDATE approvals SET status='approved', file_path=? WHERE id=?`, [Array.isArray(outputPath) ? outputPath.join(',') : outputPath, approval.id]);

    if (Array.isArray(outputPath)) {
        for (const file of outputPath) {
            await chat.client.sendMessage(approval.user_wa + '@c.us', MessageMedia.fromFilePath(file));
        }
    } else {
        await chat.client.sendMessage(approval.user_wa + '@c.us', MessageMedia.fromFilePath(outputPath));
    }

    await chat.client.sendMessage(approval.user_wa + '@c.us',
        `*Laporan Absensi Berhasil Di-Approve*\n\n` +
        `Halo *${approval.user_nama}*,\n` +
        `Laporan kamu telah *DISETUJUI* oleh *${atasan.nama_lengkap}*.\n\n` +
        `Terima kasih.`
    );

    return sendTyping(chat, `Approval berhasil dikirim ke *${approval.user_nama}*.`);
}

// Fungsi generate PDF untuk atasan - absensi
async function generatePDFForAtasan(approval, query, ttdAtasanBase64, ttdUserBase64) {
    const fs = require('fs');
    const path = require('path');
    const generatePDF = require('../../utils/pdfGenerator');
    const moment = require('moment');

    const templateName = approval.template_export;

    const now = new Date();
    const bulan = now.getMonth() + 1;
    const tahun = now.getFullYear();
    const totalHari = new Date(tahun, bulan, 0).getDate();

    const absensi = await query(
        `SELECT * FROM absensi WHERE user_id=? AND MONTH(tanggal)=? AND YEAR(tanggal)=? ORDER BY tanggal`,
        [approval.user_id, bulan, tahun]
    );

    const templatePath = path.join(__dirname, `../../templates/absensi/${templateName}.html`);
    if (!fs.existsSync(templatePath)) throw new Error(`Template ${templateName}.html tidak ditemukan.`);
    let html = fs.readFileSync(templatePath, 'utf8');

    const rows = [];
    for (let i = 1; i <= totalHari; i++) {
        const dateObj = moment(`${tahun}-${bulan}-${i}`, 'YYYY-M-D');
        const r = absensi.find(a => moment(a.tanggal).format('YYYY-MM-DD') === dateObj.format('YYYY-MM-DD'));
        rows.push(
            templateName === 'LMD'
                ? `<tr style="background-color:${[0,6].includes(dateObj.day())?'#f15a5a':'#FFF'}">
                     <td>${dateObj.format('DD/MM/YYYY')}</td>
                     <td>${dateObj.format('dddd')}</td>
                     <td>${r?.jam_masuk||'-'}</td>
                     <td>${r?.jam_pulang||'-'}</td>
                     <td>${r?.deskripsi||'-'}</td>
                   </tr>`
                : `<tr style="background-color:${[0,6].includes(dateObj.day())?'#f0f0f0':'#FFF'}">
                     <td>${i}</td>
                     <td>${r?.jam_masuk||''}</td>
                     <td>${r?.jam_pulang||''}</td>
                     <td>${[0,6].includes(dateObj.day())?'<b>LIBUR</b>':(r?.deskripsi||'')}</td>
                     <td></td>
                   </tr>`
        );
    }

    const logoFile = path.join(__dirname, `../../assets/logo/${templateName.toLowerCase()}.png`);
    const logoBase64 = fs.existsSync(logoFile) ? 'data:image/png;base64,' + fs.readFileSync(logoFile).toString('base64') : '';

    const ttdUserHTML = ttdUserBase64 ? `<img src="data:image/png;base64,${ttdUserBase64}" style="max-width:150px; max-height:150px;" />` : '';
    const ttdAtasanHTML = `<img src="data:image/png;base64,${ttdAtasanBase64}" style="max-width:150px; max-height:150px;" />`;

    html = html.replace(/{{logo}}/g, logoBase64)
               .replace(/{{nama}}/g, approval.user_nama)
               .replace(/{{jabatan}}/g, approval.user_jabatan || '')
               .replace(/{{nik}}/g, approval.user_nik || '')
               .replace(/{{periode}}/g, `${1}-${totalHari} ${moment().format('MMMM YYYY')}`)
               .replace(/{{rows_absensi}}/g, rows.join(''))
               .replace(/{{ttd_user}}/g, ttdUserHTML)
               .replace(/{{ttd_atasan}}/g, ttdAtasanHTML)
               .replace(/{{nama_atasan}}/g, approval.nama_atasan || 'Atasan')
               .replace(/{{nik_atasan}}/g, approval.nik_atasan || '');

    const exportsDir = path.join(__dirname, '../../exports');
    if (!fs.existsSync(exportsDir)) fs.mkdirSync(exportsDir, { recursive: true });
    const outputPath = path.join(exportsDir, `ABSENSI-${approval.user_nama}-${templateName}-Approve.pdf`);

    await generatePDF(html, outputPath);
    return outputPath;
}

// Fungsi generate PDF untuk atasan - lembur
async function generatePDFLemburForAtasan(approval, query, ttdAtasanBase64='', ttdUserBase64='') {
    const fs = require('fs');
    const path = require('path');
    const generatePDF = require('../../utils/pdfGenerator');
    const moment = require('moment');

    const templateName = approval.template_export || 'LMD';
    
    // Ambil data lembur user
    const lemburData = await query(
        `SELECT YEAR(tanggal) AS tahun, MONTH(tanggal) AS bulan, lembur.* 
         FROM lembur WHERE user_id=? ORDER BY tanggal`,
        [approval.user_id]
    );
    if (!lemburData.length) throw new Error('Belum ada data lembur.');

    const bulanNama = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];

    // Grouping per bulan
    const grouped = {};
    for(const l of lemburData){
        const key = `${l.tahun}-${l.bulan}`;
        if(!grouped[key]) grouped[key] = [];
        grouped[key].push(l);
    }

    const now = new Date();
    const currentKey = `${now.getFullYear()}-${now.getMonth() + 1}`;
    const keysToGenerate = grouped[currentKey] ? [currentKey] : [Object.keys(grouped).sort().pop()];

    const exportsDir = path.join(__dirname,'../../exports');
    if(!fs.existsSync(exportsDir)) fs.mkdirSync(exportsDir,{recursive:true});

    const pdfFiles = [];

    for(const key of keysToGenerate){
        const dataBulan = grouped[key];
        const sample = dataBulan[0];
        const bulanIdx = sample.bulan - 1;
        const tahun = sample.tahun;

        const periode = templateName === 'LMD'
            ? `${bulanNama[bulanIdx]} ${tahun}`
            : `1 - ${new Date(tahun, bulanIdx+1, 0).getDate()} ${bulanNama[bulanIdx]} ${tahun}`;

        const logoFile = path.join(__dirname, `../../assets/logo/${templateName.toLowerCase()}.png`);
        const logoBase64 = fs.existsSync(logoFile) ? 'data:image/png;base64,' + fs.readFileSync(logoFile).toString('base64') : '';

        const ttdUserHTML = ttdUserBase64 ? `<img src="data:image/png;base64,${ttdUserBase64}" style="max-width:150px; max-height:150px;">` : '';
        const ttdAtasanHTML = ttdAtasanBase64 ? `<img src="data:image/png;base64,${ttdAtasanBase64}" style="max-width:150px; max-height:150px;">` : '';

        let rows = '';
        let totalLemburDecimal = 0;

        if(templateName === 'KSPS'){
            const totalHari = new Date(tahun, bulanIdx+1, 0).getDate();
            for(let i=1;i<=totalHari;i++){
                const dateObj = moment(`${tahun}-${bulanIdx+1}-${i}`, 'YYYY-M-D');
                const l = dataBulan.find(x => moment(x.tanggal).format('YYYY-MM-DD') === dateObj.format('YYYY-MM-DD'));

                let totalJam = '';
                if(l?.total_lembur){
                    const [h,m=0] = l.total_lembur.includes(':') ? l.total_lembur.split(':').map(Number) : [parseFloat(l.total_lembur),0];
                    const jam = h + m/60;
                    totalLemburDecimal += jam;
                    totalJam = `${jam % 1 === 0 ? jam : jam.toFixed(1)} Jam`;
                }

                rows += `<tr>
<td>${i}</td>
<td>${l?.jam_mulai||''}</td>
<td>${l?.jam_selesai||''}</td>
<td>${totalJam}</td>
<td>${l?.deskripsi||''}</td>
<td></td>
</tr>`;
            }
        } else { // LMD
            for(const l of dataBulan){
                let jam = 0;
                if(l.total_lembur){
                    const [h,m] = l.total_lembur.split(':').map(Number);
                    jam = h + m/60;
                    totalLemburDecimal += jam;
                }
                rows += `<tr>
<td>${moment(l.tanggal).format('DD/MM/YYYY')}</td>
<td>${moment(l.tanggal).format('dddd')}</td>
<td>${l.jam_mulai}</td>
<td>${l.jam_selesai}</td>
<td>${l.deskripsi}</td>
</tr>`;
            }
        }

        const templatePath = path.join(__dirname, `../../templates/lembur/${templateName}.html`);
        if(!fs.existsSync(templatePath)) throw new Error(`${templateName} template tidak ditemukan`);
        let html = fs.readFileSync(templatePath,'utf8');

        html = html.replace(/{{logo}}/g, logoBase64)
                   .replace(/{{nama}}/g, approval.user_nama)
                   .replace(/{{jabatan}}/g, approval.user_jabatan || '')
                   .replace(/{{nik}}/g, approval.user_nik || '')
                   .replace(/{{periode}}/g, periode)
                   .replace(/{{rows_lembur}}/g, rows)
                   .replace(/{{ttd_user}}/g, ttdUserHTML)
                   .replace(/{{ttd_atasan}}/g, ttdAtasanHTML)
                   .replace(/{{nama_atasan}}/g, approval.nama_atasan || 'Atasan')
                   .replace(/{{nik_atasan}}/g, approval.nik_atasan || '')
                   .replace(/{{total_lembur}}/g, totalLemburDecimal.toFixed(2));

        const outputFile = path.join(exportsDir, `LEMBUR-${approval.user_nama}-${templateName}-Approve.pdf`);
        await generatePDF(html, outputFile);
        pdfFiles.push(outputFile);
    }

    return pdfFiles.length === 1 ? pdfFiles[0] : pdfFiles;
}
