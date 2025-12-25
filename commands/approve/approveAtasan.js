// approveAtasan.js
const { MessageMedia } = require('whatsapp-web.js');
const { sendTyping } = require('../../utils/sendTyping');
const path = require('path');
const fs = require('fs');
const generatePDF = require('../utils/pdfGenerator');
const moment = require('moment');

module.exports = async function approveAtasan(chat, user, pesan, db) {

    const query = (sql, params) =>
        new Promise((res, rej) =>
            db.query(sql, params, (e, r) => e ? rej(e) : res(r))
        );

    const text = pesan.toLowerCase().trim();

    // ambil approval pending terbaru untuk atasan ini
    const [approval] = await query(
        `SELECT a.*, u.wa_number AS user_wa, u.nama_lengkap AS user_nama, u.nik AS user_nik
        FROM approvals a
        JOIN users u ON u.id = a.user_id
        WHERE a.approver_wa = ? AND a.status = 'pending'
        ORDER BY a.created_at DESC
        LIMIT 1`,
        [user.wa_number]
    );

    if (!approval) {
        await sendTyping(chat, 'Tidak ada approval pending untukmu.');
        return;
    }

    // ambil data atasan dari tabel users
    const [atasan] = await query(
        `SELECT nama_lengkap, nik, wa_number FROM users WHERE wa_number = ? LIMIT 1`,
        [user.wa_number]
    );

    if (!atasan) {
        await sendTyping(chat, 'Data atasan tidak ditemukan di database.');
        return;
    }

    // path TTD berdasarkan wa_number atasan
    let ttdPath = '';
    const ttdPng = path.join(__dirname, '../../assets/ttd', `${atasan.wa_number}.png`);
    const ttdJpg = path.join(__dirname, '../../assets/ttd', `${atasan.wa_number}.jpg`);
    if (fs.existsSync(ttdPng)) ttdPath = ttdPng;
    else if (fs.existsSync(ttdJpg)) ttdPath = ttdJpg;

    if (!ttdPath) {
        await sendTyping(chat, 'TTD atasan tidak ditemukan. Pastikan file ada di folder /assets/ttd dengan nama wa_number.png/jpg');
        return;
    }

    /* ==============================
       APPROVE DAN BUAT PDF BARU
    ============================== */
    if (text === 'approve') {

        // generate file PDF baru dengan timestamp
        const exportsDir = path.join(__dirname, '../../exports');
        if (!fs.existsSync(exportsDir)) fs.mkdirSync(exportsDir, { recursive: true });

        const timestamp = Date.now();
        const fileName = `${approval.user_nama}-${timestamp}.pdf`;
        const outputPath = path.join(exportsDir, fileName);

        // baca template lama
        const templatePath = path.join(__dirname, '../../templates/absensi/LMD.html'); // sesuaikan jika template berbeda
        if (!fs.existsSync(templatePath)) {
            await sendTyping(chat, 'Template laporan tidak ditemukan.');
            return;
        }
        const template = fs.readFileSync(templatePath, 'utf8');

        // ambil data absensi user
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

            rows.push(
                `<tr>
                    <td>${i}</td>
                    <td>${r?.jam_masuk || ''}</td>
                    <td>${r?.jam_pulang || ''}</td>
                    <td>${r?.deskripsi || ''}</td>
                    <td></td>
                 </tr>`
            );
        }

        const logoPath = path.join(__dirname, '../../assets/lmd.png');
        const logo = fs.existsSync(logoPath) ? fs.readFileSync(logoPath, 'base64') : '';

        const html = template
            .replaceAll('{{logo_path}}', `data:image/png;base64,${logo}`)
            .replaceAll('{{nama}}', approval.user_nama)
            .replaceAll('{{jabatan}}', approval.jabatan)
            .replaceAll('{{nik}}', approval.user_nik)
            .replaceAll('{{divisi}}', 'Regional Operation')
            .replaceAll('{{lokasi}}', 'Aplikanusa Lintasarta Bandung')
            .replaceAll('{{kelompok_kerja}}', 'Central Regional Operation')
            .replaceAll('{{periode}}', `${bulan + 1}-${tahun}`)
            .replaceAll('{{rows_absensi}}', rows.join(''));

        // generate PDF
        await generatePDF(html, outputPath);

        if (!fs.existsSync(outputPath)) {
            await sendTyping(chat, 'Gagal membuat file PDF baru.');
            return;
        }

        // update approvals
        await query(
            `UPDATE approvals
             SET status='approved',
                 ttd_atasan_at=NOW(),
                 ttd_atasan=?,
                 nama_atasan=?,
                 nik_atasan=?,
                 file_path=?
             WHERE id=?`,
            [ttdPath, atasan.nama_lengkap, atasan.nik || '', outputPath, approval.id]
        );

        // kirim PDF ke user
        const media = MessageMedia.fromFilePath(outputPath);
        await chat.client.sendMessage(approval.user_wa, `Laporan kamu telah *DISETUJUI* oleh atasan.`);
        await chat.client.sendMessage(approval.user_wa, media);

        return sendTyping(chat, 'Approval berhasil diproses dan PDF baru dikirim.');
    }

    /* ==============================
       REVISI
    ============================== */
    if (text === 'revisi') {
        await query(
            `UPDATE approvals SET status='revised' WHERE id=?`,
            [approval.id]
        );
        await query(
            `UPDATE users SET step_input='alasan_revisi' WHERE id=?`,
            [approval.user_id]
        );
        await chat.client.sendMessage(approval.user_wa, 'Laporan kamu *PERLU REVISI*. Silakan perbaiki dan export ulang.');
        return sendTyping(chat, 'Permintaan revisi telah dikirim.');
    }

    // fallback
    await sendTyping(chat, `Aku belum paham pesan kamu. Coba ketik */help* untuk melihat perintah.`);
};
