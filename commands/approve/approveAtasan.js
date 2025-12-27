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
        /* =========================
           DATA ATASAN
        ========================= */
        const [atasan] = await query(
            `SELECT * FROM users WHERE wa_number=? LIMIT 1`,
            [user.wa_number]
        );

        if (!atasan)
            return sendTyping(chat, 'Data atasan tidak ditemukan.');

        /* =========================
           APPROVAL TERAKHIR
        ========================= */
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

        const userWA = approval.user_wa.includes('@')
            ? approval.user_wa
            : approval.user_wa + '@c.us';

        /* =========================
           INPUT ALASAN REVISI
        ========================= */
        if (approval.step_input === 'alasan_revisi') {

            if (approval.status !== 'revised')
                return sendTyping(chat, 'Status laporan tidak valid untuk revisi.');

            if (rawText.trim().length < 3)
                return sendTyping(chat, 'Silakan ketik *alasan revisi* yang jelas.');

            await query(
                `UPDATE approvals
                 SET revisi_catatan=?,
                     step_input=NULL
                 WHERE id=?`,
                [rawText.trim(), approval.id]
            );

            await chat.client.sendMessage(
                userWA,
                `*LAPORAN PERLU REVISI*\n\n` +
                `Approval: *${atasan.nama_lengkap}*\n\n` +
                `*Catatan revisi:*\n${rawText.trim()}\n\n` +
                `Silakan perbaiki dan lakukan */export* ulang.`
            );

            return sendTyping(chat, 'Revisi berhasil dikirim.');
        }

        /* =========================
           REVISI
        ========================= */
        if (text === 'revisi') {

            if (approval.status !== 'pending')
                return sendTyping(
                    chat,
                    'Laporan sudah direvisi atau tidak bisa direvisi lagi.'
                );

            await query(
                `UPDATE approvals
                 SET status='revised',
                     step_input='alasan_revisi'
                 WHERE id=?`,
                [approval.id]
            );

            return sendTyping(chat, 'Silakan ketik *alasan revisi*.');
        }

        /* =========================
        APPROVE
        ========================= */
        if (text === 'approve') {

            if (approval.status !== 'pending')
                return sendTyping(
                    chat,
                    'Laporan ini tidak bisa di-approve karena sudah direvisi.'
                );

            /* ===== NORMALISASI TEMPLATE ===== */
            const templateRaw = approval.template_export || 'LMD';
            const templateHTML = templateRaw.toUpperCase();
            const templateLogo = templateRaw.toLowerCase();

            /* ===== LOGO ===== */
            let logoBase64 = '';
            let logoPath = path.join(__dirname, '../../assets/logo', `${templateLogo}.png`);
            if (!fs.existsSync(logoPath))
                logoPath = path.join(__dirname, '../../assets/logo/default.png');
            if (fs.existsSync(logoPath))
                logoBase64 = fs.readFileSync(logoPath, 'base64');

            /* ===== TTD ATASAN ===== */
            let ttdAtasanBase64 = '';
            const ttdPng = path.join(__dirname, '../../assets/ttd', `${atasan.wa_number}.png`);
            const ttdJpg = path.join(__dirname, '../../assets/ttd', `${atasan.wa_number}.jpg`);
            if (fs.existsSync(ttdPng)) ttdAtasanBase64 = fs.readFileSync(ttdPng, 'base64');
            else if (fs.existsSync(ttdJpg)) ttdAtasanBase64 = fs.readFileSync(ttdJpg, 'base64');

            // jika TTD belum ada dan step_input belum 'ttd_atasan', minta kirim TTD
            if (!ttdAtasanBase64 && approval.step_input !== 'ttd_atasan') {
                await sendTyping(chat, 'Silakan kirim foto TTD kamu untuk approve laporan ini.');
                await query(`UPDATE approvals SET step_input='ttd_atasan' WHERE id=?`, [approval.id]);
                return;
            }

            // jika TTD sudah ada dan step_input='ttd_atasan', langsung lanjut approve
            if (ttdAtasanBase64 && approval.step_input === 'ttd_atasan') {
                await query(`UPDATE approvals SET step_input=NULL WHERE id=?`, [approval.id]);
                // lanjut ke proses approve
            }

            /* ===== TTD USER ===== */
            let ttdUserBase64 = '';
            const ttdUserPng = path.join(__dirname, '../../assets/ttd', `${approval.user_wa}.png`);
            const ttdUserJpg = path.join(__dirname, '../../assets/ttd', `${approval.user_wa}.jpg`);
            if (fs.existsSync(ttdUserPng)) ttdUserBase64 = fs.readFileSync(ttdUserPng, 'base64');
            else if (fs.existsSync(ttdUserJpg)) ttdUserBase64 = fs.readFileSync(ttdUserJpg, 'base64');

            /* ===== GENERATE PDF SESUAI TIPE ===== */
            let outputPath;
            if (approval.export_type === 'lembur') {
                // generate PDF lembur
                outputPath = await generatePDFLemburForAtasan(approval, db, ttdAtasanBase64, ttdUserBase64);
            } else {
                // generate PDF absensi biasa
                outputPath = await generatePDFForAtasan(approval, db, ttdAtasanBase64, ttdUserBase64);
            }

            /* ===== UPDATE STATUS DAN KIRIM KE USER ===== */
            await query(
                `UPDATE approvals
                 SET status='approved',
                     file_path=?
                 WHERE id=?`,
                [outputPath, approval.id]
            );

            await chat.client.sendMessage(userWA, MessageMedia.fromFilePath(outputPath));
            await chat.client.sendMessage(userWA,
                `*Laporan Absensi Berhasil Di-Approve*\n\n` +
                `Halo *${approval.user_nama}*,\n` +
                `Laporan kamu telah *DISETUJUI* oleh *${atasan.nama_lengkap}*.\n\n` +
                `Terima kasih.`
            );
            return sendTyping(chat,
                `Approval berhasil dikirim ke *${approval.user_nama}*.`
            );
        }

        if (text !== 'approve' && text !== 'revisi') {
            return sendTyping(chat, 'Ketik *approve* atau *revisi*.');
        }

    } catch (err) {
        console.error(err);
        return sendTyping(chat, 'Terjadi error pada sistem approval.');
    }
};

/* =========================
   Fungsi generate PDF untuk atasan
   - absensi
========================= */
async function generatePDFForAtasan(approval, db, ttdAtasanBase64, ttdUserBase64) {
    const fs = require('fs');
    const path = require('path');
    const generatePDF = require('../../utils/pdfGenerator');
    const moment = require('moment');

    const templateName = approval.template_export;

    // helper query
    const query = (sql, params = []) =>
        new Promise((res, rej) => db.query(sql, params, (err, r) => err ? rej(err) : res(r)));

    // ambil absensi
    const now = new Date();
    const bulan = now.getMonth() + 1;
    const tahun = now.getFullYear();
    const totalHari = new Date(tahun, bulan, 0).getDate();

    const absensi = await query(
        `SELECT * FROM absensi WHERE user_id=? AND MONTH(tanggal)=? AND YEAR(tanggal)=? ORDER BY tanggal`,
        [approval.user_id, bulan, tahun]
    );

    // template HTML
    const templatePath = path.join(__dirname, `../../templates/absensi/${templateName}.html`);
    if (!fs.existsSync(templatePath)) throw new Error(`Template ${templateName}.html tidak ditemukan.`);
    let html = fs.readFileSync(templatePath, 'utf8');

    // rows absensi
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

    // logo
    const logoFile = path.join(__dirname, `../../assets/logo/${templateName.toLowerCase()}.png`);
    const logoBase64 = fs.existsSync(logoFile)
        ? 'data:image/png;base64,' + fs.readFileSync(logoFile).toString('base64')
        : '';

    // TTD user
    const ttdUserHTML = ttdUserBase64
        ? `<img src="data:image/png;base64,${ttdUserBase64}" style="max-width:150px; max-height:80px;" />`
        : '';

    // TTD atasan
    const ttdAtasanHTML = `<img src="data:image/png;base64,${ttdAtasanBase64}" style="max-width:150px; max-height:80px;" />`;

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

    // export PDF
    const exportsDir = path.join(__dirname, '../../exports');
    if (!fs.existsSync(exportsDir)) fs.mkdirSync(exportsDir, { recursive: true });
    const outputPath = path.join(exportsDir, `ABSENSI-${approval.user_nama}-${templateName}-Approve.pdf`);

    await generatePDF(html, outputPath);
    return outputPath;
}

/* =========================
   Fungsi generate PDF untuk atasan
   - lembur
========================= */
async function generatePDFLemburForAtasan(approval, db, ttdAtasanBase64, ttdUserBase64) {
    const fs = require('fs');
    const path = require('path');
    const generatePDF = require('../../utils/pdfGenerator');
    const moment = require('moment');

    // exportType dari users
    const exportType = approval.export_type || 'absen';
    const templateName = approval.template_export || 'LMD';
    const templatePath = path.join(__dirname, `../../templates/${exportType}/${templateName}.html`);

    if (!fs.existsSync(templatePath)) throw new Error(`Template ${templateName}.html tidak ditemukan di folder ${exportType}`);
    let htmlTemplate = fs.readFileSync(templatePath, 'utf8');

    // ambil data lembur dari DB
    const now = new Date();
    const bulan = now.getMonth();
    const tahun = now.getFullYear();
    const firstTanggal = new Date(tahun, bulan, 1);
    const totalHari = new Date(tahun, bulan + 1, 0).getDate();

    const lemburData = await new Promise((resolve, reject) =>
        db.query(
            `SELECT * FROM lembur WHERE user_id=? AND MONTH(tanggal)=? AND YEAR(tanggal)=? ORDER BY tanggal`,
            [approval.user_id, bulan + 1, tahun],
            (err, res) => err ? reject(err) : resolve(res)
        )
    );

    // Generate rows sesuai template
    const rows = [];
    if (templateName === 'LMD') {
        for (const l of lemburData) {
            const tgl = moment(l.tanggal).format('DD/MM/YYYY');
            const hari = moment(l.tanggal).locale('id').format('dddd');
            rows.push(`<tr>
                <td>${tgl}</td>
                <td>${hari}</td>
                <td>${l.jam_mulai || '-'}</td>
                <td>${l.jam_selesai || '-'}</td>
                <td>${l.total_lembur || '-'}</td>
                <td>${l.deskripsi || '-'}</td>
            </tr>`);
        }
    } else { // KSPS atau lainnya
        for (let i = 1; i <= totalHari; i++) {
            const dateObj = moment(`${firstTanggal.getFullYear()}-${firstTanggal.getMonth() + 1}-${i}`, 'YYYY-M-D');
            const r = lemburData.find(l => moment(l.tanggal).format('YYYY-MM-DD') === dateObj.format('YYYY-MM-DD'));
            rows.push(`<tr>
                <td>${i}</td>
                <td>${r?.jam_mulai || ''}</td>
                <td>${r?.jam_selesai || ''}</td>
                <td>${r?.total_lembur || ''}</td>
                <td>${r?.deskripsi || ''}</td>
                <td></td>
            </tr>`);
        }
    }

    // Logo
    const logoFile = path.join(__dirname, `../../assets/logo/${templateName.toLowerCase()}.png`);
    const logoBase64 = fs.existsSync(logoFile)
        ? 'data:image/png;base64,' + fs.readFileSync(logoFile).toString('base64')
        : '';

    // TTD Atasan
    const ttdAtasanHTML = ttdAtasanBase64
        ? `<img src="data:image/png;base64,${ttdAtasanBase64}" style="max-width:150px; max-height:80px;" />`
        : '';

    // TTD User
    const ttdUserHTML = ttdUserBase64
        ? `<img src="data:image/png;base64,${ttdUserBase64}" style="max-width:150px; max-height:80px;" />`
        : '';

    const periode = moment(firstTanggal).locale('id').format('MMMM YYYY');

    const html = htmlTemplate
        .replace(/{{rows_lembur}}/g, rows.join(''))
        .replace(/{{nama}}/g, approval.user_nama || '-')
        .replace(/{{jabatan}}/g, approval.user_jabatan || '-')
        .replace(/{{nik}}/g, approval.user_nik || '-')
        .replace(/{{periode}}/g, periode)
        .replace(/{{logo}}/g, logoBase64)
        .replace(/{{ttd_user}}/g, ttdUserHTML)
        .replace(/{{ttd_atasan}}/g, ttdAtasanHTML)
        .replace(/{{nama_atasan}}/g, approval.nama_atasan || '')
        .replace(/{{nik_atasan}}/g, approval.nik_atasan || '');

    const exportsDir = path.join(__dirname, '../../exports');
    if (!fs.existsSync(exportsDir)) fs.mkdirSync(exportsDir, { recursive: true });

    const outputPath = path.join(exportsDir, `LEMBUR-${approval.user_nama}-Approve.pdf`);

    await generatePDF(html, outputPath);
    return outputPath;
}
