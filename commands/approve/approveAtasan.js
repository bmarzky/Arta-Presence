const { MessageMedia } = require('whatsapp-web.js');
const { sendTyping } = require('../../utils/sendTyping');
const path = require('path');
const fs = require('fs');
const generatePDF = require('../../utils/pdfGenerator');
const moment = require('moment');

module.exports = async function approveAtasan(chat, user, pesan, db) {
    const query = (sql, params = []) =>
        new Promise((res, rej) =>
            db.query(sql, params, (e, r) => (e ? rej(e) : res(r)))
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

        /* =====================================================
           APPROVAL TERAKHIR
        ===================================================== */
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
            return sendTyping(
                chat,
                'Tidak ada laporan yang menunggu approval.\n(Revisi menunggu export ulang user)'
            );

        const userWA = approval.user_wa.includes('@')
            ? approval.user_wa
            : approval.user_wa + '@c.us';

        /* =========================
           INPUT ALASAN REVISI
        ========================= */
        if (approval.step_input === 'alasan_revisi') {
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
                `📌 *LAPORAN PERLU REVISI*\n` +
                `Atasan: *${atasan.nama_lengkap}*\n\n` +
                `📝 *Alasan revisi:*\n${rawText.trim()}\n\n` +
                `Silakan perbaiki dan lakukan */export* ulang.`
            );

            return sendTyping(chat, 'Alasan revisi berhasil dikirim.');
        }

        /* =========================
           REVISI
        ========================= */
        if (text === 'revisi') {
            if (approval.status !== 'pending')
                return sendTyping(chat, 'Laporan sudah direvisi.');

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

            /* =====================================================
               FIX LOGO (INI BAGIAN YANG DIPERBAIKI)
            ===================================================== */
            const templateKey = (approval.template_export || 'lmd').toLowerCase();

            const logoPath = path.join(
                __dirname,
                '../../assets/logo',
                `${templateKey}.png`
            );

            let logoBase64 = '';
            if (fs.existsSync(logoPath)) {
                logoBase64 = fs.readFileSync(logoPath, 'base64');
            } else {
                console.warn(`Logo ${templateKey}.png tidak ditemukan, pakai default.`);
            }

            /* =========================
               TTD
            ========================= */
            let ttdBase64 = '';
            const ttdPng = path.join(__dirname, '../../assets/ttd', `${atasan.wa_number}.png`);
            const ttdJpg = path.join(__dirname, '../../assets/ttd', `${atasan.wa_number}.jpg`);

            if (fs.existsSync(ttdPng)) ttdBase64 = fs.readFileSync(ttdPng, 'base64');
            else if (fs.existsSync(ttdJpg)) ttdBase64 = fs.readFileSync(ttdJpg, 'base64');

            if (!ttdBase64)
                return sendTyping(chat, 'TTD atasan tidak ditemukan.');

            /* =========================
               TEMPLATE & PDF
            ========================= */
            const exportsDir = path.join(__dirname, '../../exports');
            if (!fs.existsSync(exportsDir)) fs.mkdirSync(exportsDir, { recursive: true });

            const timestamp = Date.now();
            const fileName = `${approval.user_nama}-${templateKey}-${timestamp}.pdf`;
            const outputPath = path.join(exportsDir, fileName);

            const templatePath = path.join(
                __dirname,
                '../../templates/absensi',
                `${templateKey}.html`
            );

            const template = fs.readFileSync(templatePath, 'utf8');

            const now = new Date();
            const bulan = now.getMonth();
            const tahun = now.getFullYear();

            const absensi = await query(
                `SELECT * FROM absensi
                 WHERE user_id=?
                   AND MONTH(tanggal)=?
                   AND YEAR(tanggal)=?
                 ORDER BY tanggal`,
                [approval.user_id, bulan + 1, tahun]
            );

            const totalHari = new Date(tahun, bulan + 1, 0).getDate();
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
                .replaceAll('{{logo}}', logoBase64 ? `data:image/png;base64,${logoBase64}` : '')
                .replaceAll('{{nama}}', approval.user_nama)
                .replaceAll('{{jabatan}}', approval.user_jabatan || '')
                .replaceAll('{{nik}}', approval.user_nik)
                .replaceAll('{{periode}}', moment().locale('id').format('MMMM YYYY'))
                .replaceAll('{{rows_absensi}}', rows.join(''))
                .replaceAll('{{ttd_atasan}}', `<img src="data:image/png;base64,${ttdBase64}" width="80"/>`)
                .replaceAll('{{nama_atasan}}', atasan.nama_lengkap)
                .replaceAll('{{nik_atasan}}', atasan.nik || '');

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
        return sendTyping(chat, 'Terjadi error.');
    }
};
