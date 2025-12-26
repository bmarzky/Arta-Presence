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
                    u.template_export
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
                `Atasan: *${atasan.nama_lengkap}*\n\n` +
                `*Catatan revisi:*\n${rawText.trim()}\n\n` +
                `Silakan perbaiki dan lakukan */export* ulang.`
            );

            return sendTyping(chat, 'Alasan revisi berhasil dikirim.');
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

            /* ===== TTD ===== */
            let ttdBase64 = '';
            const ttdPng = path.join(__dirname, '../../assets/ttd', `${atasan.wa_number}.png`);
            const ttdJpg = path.join(__dirname, '../../assets/ttd', `${atasan.wa_number}.jpg`);

            if (fs.existsSync(ttdPng)) ttdBase64 = fs.readFileSync(ttdPng, 'base64');
            else if (fs.existsSync(ttdJpg)) ttdBase64 = fs.readFileSync(ttdJpg, 'base64');

            if (!ttdBase64)
                return sendTyping(chat, 'TTD atasan tidak ditemukan.');

            /* ===== TEMPLATE ===== */
            const templatePath = path.join(
                __dirname,
                '../../templates/absensi',
                `${templateHTML}.html`
            );

            if (!fs.existsSync(templatePath))
                return sendTyping(chat, `Template ${templateHTML}.html tidak ditemukan.`);

            const template = fs.readFileSync(templatePath, 'utf8');

            /* ===== DATA ABSENSI ===== */
            const now = new Date();
            const bulan = now.getMonth();
            const tahun = now.getFullYear();
            const totalHari = new Date(tahun, bulan + 1, 0).getDate();

            const absensi = await query(
                `SELECT * FROM absensi
                 WHERE user_id=?
                   AND MONTH(tanggal)=?
                   AND YEAR(tanggal)=?
                 ORDER BY tanggal`,
                [approval.user_id, bulan + 1, tahun]
            );

            const rows = [];
            for (let i = 1; i <= totalHari; i++) {
                const d = moment(`${tahun}-${bulan + 1}-${i}`, 'YYYY-M-D');
                const r = absensi.find(a =>
                    moment(a.tanggal).format('YYYY-MM-DD') === d.format('YYYY-MM-DD')
                );

                rows.push(`
                    <tr>
                        <td>${d.format('DD/MM/YYYY')}</td>
                        <td>${d.locale('id').format('dddd')}</td>
                        <td>${r?.jam_masuk || '-'}</td>
                        <td>${r?.jam_pulang || '-'}</td>
                        <td>${r?.deskripsi || '-'}</td>
                    </tr>
                `);
            }

            const html = template
                .replaceAll('{{logo}}', `data:image/png;base64,${logoBase64}`)
                .replaceAll('{{nama}}', approval.user_nama)
                .replaceAll('{{jabatan}}', approval.user_jabatan || '')
                .replaceAll('{{nik}}', approval.user_nik)
                .replaceAll('{{periode}}', moment().locale('id').format('MMMM YYYY'))
                .replaceAll('{{rows_absensi}}', rows.join(''))
                .replaceAll('{{ttd_atasan}}', `<img src="data:image/png;base64,${ttdBase64}" width="80"/>`)
                .replaceAll('{{nama_atasan}}', atasan.nama_lengkap)
                .replaceAll('{{nik_atasan}}', atasan.nik || '');

            const exportsDir = path.join(__dirname, '../../exports');
            if (!fs.existsSync(exportsDir)) fs.mkdirSync(exportsDir, { recursive: true });

            const outputPath = path.join(
                exportsDir,
                `ABSENSI-${approval.user_nama}-${templateHTML}-Approve.pdf`
            );

            await generatePDF(html, outputPath);

            await query(
                `UPDATE approvals
                 SET status='approved',
                     file_path=?
                 WHERE id=?`,
                [outputPath, approval.id]
            );

            await chat.client.sendMessage(userWA, MessageMedia.fromFilePath(outputPath));
            return sendTyping(chat, 'Approval berhasil.');
        }

        return sendTyping(chat, 'Ketik *approve* atau *revisi*.');

    } catch (err) {
        console.error(err);
        return sendTyping(chat, 'Terjadi error pada sistem approval.');
    }
};
