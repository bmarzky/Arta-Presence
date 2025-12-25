// approveAtasan.js
const { MessageMedia } = require('whatsapp-web.js');
const { sendTyping } = require('../../utils/sendTyping');
const path = require('path');
const fs = require('fs');
const generatePDF = require('../../utils/pdfGenerator');
const moment = require('moment');

module.exports = async function approveAtasan(chat, user, pesan, db) {
    const query = (sql, params) =>
        new Promise((res, rej) => db.query(sql, params, (e, r) => e ? rej(e) : res(r)));

    const text = pesan.trim().toLowerCase();

    // Ambil data atasan dan step_input
    const [userData] = await query(
        `SELECT id, step_input FROM users WHERE wa_number=? LIMIT 1`,
        [user.wa_number]
    );
    if (!userData) return sendTyping(chat, 'Data atasan tidak ditemukan.');

    // Ambil approval terbaru pending/revised
    const [approval] = await query(
        `SELECT a.*, u.wa_number AS user_wa, u.nama_lengkap AS user_nama, u.nik AS user_nik, u.jabatan AS user_jabatan, u.template_export
         FROM approvals a
         JOIN users u ON u.id = a.user_id
         WHERE a.approver_wa = ? AND a.status IN ('pending','revised')
         ORDER BY a.created_at DESC
         LIMIT 1`,
        [user.wa_number]
    );
    if (!approval) return sendTyping(chat, 'Tidak ada approval pending untukmu.');

    const atasanWA = user.wa_number.includes('@') ? user.wa_number : user.wa_number + '@c.us';
    const userWA = approval.user_wa.includes('@') ? approval.user_wa : approval.user_wa + '@c.us';

    // Path TTD base64
    let ttdBase64 = '';
    const ttdPng = path.join(__dirname, '../../assets/ttd', `${user.wa_number}.png`);
    const ttdJpg = path.join(__dirname, '../../assets/ttd', `${user.wa_number}.jpg`);
    if (fs.existsSync(ttdPng)) ttdBase64 = fs.readFileSync(ttdPng, 'base64');
    else if (fs.existsSync(ttdJpg)) ttdBase64 = fs.readFileSync(ttdJpg, 'base64');
    if (!ttdBase64) return sendTyping(chat, 'TTD atasan tidak ditemukan.');

    // Cek file PDF user
    if (!approval.file_path || !fs.existsSync(approval.file_path)) {
        return sendTyping(chat, 'File laporan user tidak ditemukan. Pastikan user sudah melakukan /export.');
    }

    /* ==========================
       ALASAN REVISI (STATE)
    ========================== */
    if (userData.step_input === 'alasan_revisi') {
        // Anggap semua pesan berikutnya sebagai alasan revisi
        const alasan = pesan.trim();
        try {
            await query(`UPDATE approvals SET revisi_catatan=? WHERE id=?`, [alasan, approval.id]);
            await query(`UPDATE users SET step_input=NULL WHERE wa_number=?`, [user.wa_number]);

            await chat.client.sendMessage(
                userWA,
                `Laporan kamu *PERLU REVISI* oleh *${user.nama_lengkap}*.\nAlasan revisi: ${alasan}\nSilakan perbaiki dan export ulang.`
            );

            return sendTyping(chat, `Alasan revisi telah diteruskan ke *${approval.user_nama}*.`);
        } catch (err) {
            console.error(err);
            return sendTyping(chat, 'Terjadi error saat mengirim alasan revisi.');
        }
    }

    /* ==========================
       APPROVE
    ========================== */
    if (text === 'approve') {
        if (approval.status === 'approved') {
            return sendTyping(chat, `Laporan *${approval.user_nama}* sudah pernah di-approve sebelumnya.`);
        }

        try {
            // Generate PDF baru dengan TTD
            const exportsDir = path.join(__dirname, '../../exports');
            if (!fs.existsSync(exportsDir)) fs.mkdirSync(exportsDir, { recursive: true });

            const timestamp = Date.now();
            const templateName = (approval.template_export || 'LMD').toUpperCase();
            const fileName = `${approval.user_nama}-${templateName}-${timestamp}.pdf`;
            const outputPath = path.join(exportsDir, fileName);

            const templatePath = path.join(__dirname, '../../templates/absensi', `${templateName}.html`);
            if (!fs.existsSync(templatePath)) return sendTyping(chat, 'Template laporan tidak ditemukan.');
            const template = fs.readFileSync(templatePath, 'utf8');

            // Data absensi
            const now = new Date();
            const bulan = now.getMonth();
            const tahun = now.getFullYear();
            const totalHari = new Date(tahun, bulan + 1, 0).getDate();

            const absensi = await query(
                `SELECT * FROM absensi WHERE user_id=? AND MONTH(tanggal)=? AND YEAR(tanggal)=? ORDER BY tanggal`,
                [approval.user_id, bulan + 1, tahun]
            );

            const rows = [];
            for (let i = 1; i <= totalHari; i++) {
                const dateObj = moment(`${tahun}-${bulan + 1}-${i}`, 'YYYY-M-D');
                const iso = dateObj.format('YYYY-MM-DD');
                const r = absensi.find(a => moment(a.tanggal).format('YYYY-MM-DD') === iso);

                if (templateName === 'LMD') {
                    rows.push(`
                        <tr>
                            <td>${dateObj.format('DD/MM/YYYY')}</td>
                            <td>${dateObj.locale('id').format('dddd')}</td>
                            <td>${r?.jam_masuk || '-'}</td>
                            <td>${r?.jam_pulang || '-'}</td>
                            <td>${r?.deskripsi || '-'}</td>
                        </tr>
                    `);
                } else {
                    rows.push(`
                        <tr>
                            <td>${i}/${bulan+1}/${tahun}</td>
                            <td>${r?.jam_masuk || ''}</td>
                            <td>${r?.jam_pulang || ''}</td>
                            <td>${r?.deskripsi || ''}</td>
                            <td></td>
                        </tr>
                    `);
                }
            }

            const bulanNama = moment().month(bulan).locale('id').format('MMMM');
            const periode = templateName === 'LMD' ? `${bulanNama} - ${tahun}` : `1 - ${totalHari} ${bulanNama} ${tahun}`;

            const logoPath = path.join(__dirname, `../../assets/${templateName.toLowerCase()}.png`);
            const logo = fs.existsSync(logoPath) ? fs.readFileSync(logoPath, 'base64') : '';

            const html = template
                .replaceAll('{{logo_path}}', logo ? `data:image/png;base64,${logo}` : '')
                .replaceAll('{{nama}}', approval.user_nama)
                .replaceAll('{{jabatan}}', approval.user_jabatan || '')
                .replaceAll('{{nik}}', approval.user_nik)
                .replaceAll('{{divisi}}', 'Regional Operation')
                .replaceAll('{{lokasi}}', 'Aplikanusa Lintasarta Bandung')
                .replaceAll('{{kelompok_kerja}}', 'Central Regional Operation')
                .replaceAll('{{periode}}', periode)
                .replaceAll('{{rows_absensi}}', rows.join(''))
                .replaceAll('{{ttd_atasan}}', `<img src="data:image/png;base64,${ttdBase64}" width="80"/>`)
                .replaceAll('{{nama_atasan}}', user.nama_lengkap || '')
                .replaceAll('{{nik_atasan}}', user.nik || '');

            await generatePDF(html, outputPath);

            await query(
                `UPDATE approvals
                 SET status='approved',
                     ttd_atasan_at=NOW(),
                     ttd_atasan=?,
                     nama_atasan=?,
                     nik_atasan=?,
                     file_path=?,
                     template_export=?
                 WHERE id=?`,
                [ttdBase64, user.nama_lengkap, user.nik || '', outputPath, approval.template_export, approval.id]
            );

            await chat.client.sendMessage(userWA, MessageMedia.fromFilePath(outputPath));
            await chat.client.sendMessage(userWA, `Laporan kamu telah *DISETUJUI* oleh *${user.nama_lengkap}*.`);

            return sendTyping(chat, `Approval berhasil diproses dan dikirim ke *${approval.user_nama}*.`);
        } catch (err) {
            console.error(err);
            return sendTyping(chat, 'Terjadi error saat memproses approval. Cek log server.');
        }
    }

    /* ==========================
       REVISI (MINTA ALASAN)
    ========================== */
    if (text === 'revisi') {
        if (approval.status === 'revised' && approval.revisi_catatan) {
            return sendTyping(chat, `Laporan *${approval.user_nama}* sudah diberi catatan revisi.`);
        }

        try {
            await query(`UPDATE approvals SET status='revised', revisi_catatan=NULL WHERE id=?`, [approval.id]);
            await query(`UPDATE users SET step_input='alasan_revisi' WHERE wa_number=?`, [user.wa_number]);
            return sendTyping(chat, `Silakan ketik alasan revisi untuk laporan *${approval.user_nama}*.`);
        } catch (err) {
            console.error(err);
            return sendTyping(chat, 'Terjadi error saat meminta revisi.');
        }
    }

    // Default fallback
    await sendTyping(chat, `Aku belum paham pesan kamu. Coba ketik */help* untuk melihat perintah.`);
};
