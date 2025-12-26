const { MessageMedia } = require('whatsapp-web.js');
const { sendTyping } = require('../../utils/sendTyping');
const path = require('path');
const fs = require('fs');
const generatePDF = require('../../utils/pdfGenerator');
const moment = require('moment');

module.exports = async function approveAtasan(chat, user, pesan, db) {
    const query = (sql, params) =>
        new Promise((res, rej) =>
            db.query(sql, params, (e, r) => (e ? rej(e) : res(r)))
        );

    const text = (pesan || '').trim();

    try {
        /* =====================================================
           DATA ATASAN
        ===================================================== */
        const [atasan] = await query(
            `SELECT * FROM users WHERE wa_number=? LIMIT 1`,
            [user.wa_number]
        );
        if (!atasan) return sendTyping(chat, 'Data atasan tidak ditemukan.');

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
            return sendTyping(chat, 'Tidak ada approval pending untukmu.');

        const userWA = approval.user_wa.includes('@')
            ? approval.user_wa
            : approval.user_wa + '@c.us';

        /* =====================================================
           STEP INPUT — MENUNGGU ALASAN REVISI (PALING ATAS)
        ===================================================== */
        if (approval.step_input === 'alasan_revisi') {
            // ❌ atasan salah ketik "revisi" lagi
            if (text.toLowerCase() === 'revisi') {
                return sendTyping(
                    chat,
                    'Silakan ketik *alasan revisi*, bukan kata "revisi".'
                );
            }

            // ❌ alasan kosong / terlalu pendek
            if (!text || text.length < 3) {
                return sendTyping(
                    chat,
                    'Alasan revisi terlalu singkat. Silakan jelaskan.'
                );
            }

            // ✅ simpan alasan & reset state
            await query(
                `UPDATE approvals
                 SET revisi_catatan=?, step_input=NULL
                 WHERE id=?`,
                [text, approval.id]
            );

            // ✅ kirim ke user (BARU DI SINI)
            await chat.client.sendMessage(
                userWA,
                `📌 *LAPORAN PERLU REVISI*\n` +
                `Atasan: *${atasan.nama_lengkap}*\n\n` +
                `📝 *Alasan revisi:*\n${text}\n\n` +
                `Silakan perbaiki dan export ulang laporan.`
            );

            return sendTyping(
                chat,
                `Alasan revisi berhasil dikirim ke *${approval.user_nama}*.`
            );
        }

        /* =====================================================
           PATH TTD ATASAN
        ===================================================== */
        let ttdBase64 = '';
        const ttdPng = path.join(
            __dirname,
            '../../assets/ttd',
            `${atasan.wa_number}.png`
        );
        const ttdJpg = path.join(
            __dirname,
            '../../assets/ttd',
            `${atasan.wa_number}.jpg`
        );
        if (fs.existsSync(ttdPng)) ttdBase64 = fs.readFileSync(ttdPng, 'base64');
        else if (fs.existsSync(ttdJpg))
            ttdBase64 = fs.readFileSync(ttdJpg, 'base64');

        /* =====================================================
           APPROVE
        ===================================================== */
        if (text.toLowerCase() === 'approve') {
            if (!ttdBase64)
                return sendTyping(chat, 'TTD atasan tidak ditemukan.');

            const exportsDir = path.join(__dirname, '../../exports');
            if (!fs.existsSync(exportsDir))
                fs.mkdirSync(exportsDir, { recursive: true });

            const timestamp = Date.now();
            const templateName = (approval.template_export || 'LMD').toUpperCase();
            const fileName = `${approval.user_nama}-${templateName}-${timestamp}.pdf`;
            const outputPath = path.join(exportsDir, fileName);

            const templatePath = path.join(
                __dirname,
                '../../templates/absensi',
                `${templateName}.html`
            );
            if (!fs.existsSync(templatePath))
                return sendTyping(chat, 'Template laporan tidak ditemukan.');

            const template = fs.readFileSync(templatePath, 'utf8');

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
                const dateObj = moment(`${tahun}-${bulan + 1}-${i}`, 'YYYY-M-D');
                const iso = dateObj.format('YYYY-MM-DD');
                const r = absensi.find(
                    a => moment(a.tanggal).format('YYYY-MM-DD') === iso
                );

                rows.push(`
                    <tr>
                        <td>${dateObj.format('DD/MM/YYYY')}</td>
                        <td>${dateObj.locale('id').format('dddd')}</td>
                        <td>${r?.jam_masuk || '-'}</td>
                        <td>${r?.jam_pulang || '-'}</td>
                        <td>${r?.deskripsi || '-'}</td>
                    </tr>
                `);
            }

            const bulanNama = moment()
                .month(bulan)
                .locale('id')
                .format('MMMM');

            const logoPath = path.join(
                __dirname,
                `../../assets/${templateName.toLowerCase()}.png`
            );
            const logo = fs.existsSync(logoPath)
                ? fs.readFileSync(logoPath, 'base64')
                : '';

            const html = template
                .replaceAll('{{logo_path}}', logo ? `data:image/png;base64,${logo}` : '')
                .replaceAll('{{nama}}', approval.user_nama)
                .replaceAll('{{jabatan}}', approval.user_jabatan || '')
                .replaceAll('{{nik}}', approval.user_nik)
                .replaceAll('{{periode}}', `${bulanNama} - ${tahun}`)
                .replaceAll('{{rows_absensi}}', rows.join(''))
                .replaceAll(
                    '{{ttd_atasan}}',
                    `<img src="data:image/png;base64,${ttdBase64}" width="80"/>`
                )
                .replaceAll('{{nama_atasan}}', atasan.nama_lengkap || '')
                .replaceAll('{{nik_atasan}}', atasan.nik || '');

            await generatePDF(html, outputPath);

            await query(
                `UPDATE approvals
                 SET status='approved',
                     step_input=NULL,
                     ttd_atasan_at=NOW(),
                     ttd_atasan=?,
                     nama_atasan=?,
                     nik_atasan=?,
                     file_path=?
                 WHERE id=?`,
                [
                    ttdBase64,
                    atasan.nama_lengkap,
                    atasan.nik || '',
                    outputPath,
                    approval.id
                ]
            );

            await chat.client.sendMessage(
                userWA,
                MessageMedia.fromFilePath(outputPath)
            );
            await chat.client.sendMessage(
                userWA,
                `✅ Laporan kamu telah *DISETUJUI* oleh *${atasan.nama_lengkap}*.`
            );

            return sendTyping(
                chat,
                `Approval berhasil dikirim ke *${approval.user_nama}*.`
            );
        }

        /* =====================================================
           REVISI — TRIGGER AWAL (TIDAK KIRIM KE USER)
        ===================================================== */
        if (text.toLowerCase() === 'revisi') {
            await query(
                `UPDATE approvals
                 SET status='revised',
                     step_input='alasan_revisi'
                 WHERE id=?`,
                [approval.id]
            );

            return sendTyping(
                chat,
                'Silakan ketik *alasan revisi* untuk laporan ini.'
            );
        }

        /* =====================================================
           FALLBACK
        ===================================================== */
        return sendTyping(
            chat,
            'Perintah tidak dikenali.\nKetik *approve* atau *revisi*.'
        );

    } catch (err) {
        console.error('Error di approveAtasan:', err);
        return sendTyping(chat, 'Terjadi error saat memproses approval.');
    }
};
