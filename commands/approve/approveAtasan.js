// approveAtasan.js
const { MessageMedia } = require('whatsapp-web.js');
const { sendTyping } = require('../../utils/sendTyping');
const path = require('path');
const fs = require('fs');

module.exports = async function approveAtasan(chat, user, pesan, db) {

    const query = (sql, params) =>
        new Promise((res, rej) =>
            db.query(sql, params, (e, r) => e ? rej(e) : res(r))
        );

    const text = pesan.toLowerCase().trim();
    const waNumber = user.wa_number;

    // Ambil approval pending terbaru milik atasan ini
    const [approval] = await query(
        `SELECT a.*, u.wa_number as user_wa, u.nama_lengkap as user_nama, u.nik as user_nik
         FROM approvals a
         JOIN users u ON u.id = a.user_id
         WHERE a.approver_wa = ? AND a.status = 'pending'
         ORDER BY a.created_at DESC
         LIMIT 1`,
        [waNumber]
    );

    if (!approval) return; // tidak ada approval pending

    // Ambil data atasan sendiri
    const [atasan] = await query(
        `SELECT * FROM users WHERE wa_number = ? LIMIT 1`,
        [waNumber]
    );

    if (!atasan) return;

    // Path TTD atasan
    const ttdDir = path.join(__dirname, '../../ttd');
    if (!fs.existsSync(ttdDir)) fs.mkdirSync(ttdDir, { recursive: true });
    const ttdPath = path.join(ttdDir, `${atasan.id}.png`);

    /* ================================
       TERIMA GAMBAR TTD
    ================================ */
    if (chat.hasMedia && !fs.existsSync(ttdPath)) {
        const media = await chat.downloadMedia();
        if (!media || !media.data) return;

        const buffer = Buffer.from(media.data, 'base64');
        fs.writeFileSync(ttdPath, buffer);

        await chat.sendMessage(
            waNumber,
            'TTD berhasil diterima. Sekarang kamu bisa approve laporan.'
        );
        return sendTyping(chat, 'TTD tersimpan.');
    }

    // Jika belum ada TTD
    if (!fs.existsSync(ttdPath)) {
        await chat.sendMessage(
            waNumber,
            'Kamu belum mengirim TTD untuk approve. Silakan kirim gambarnya sekarang (format PNG/JPG).'
        );
        return sendTyping(chat, 'Menunggu TTD atasan...');
    }

    /* ================================
       APPROVE
    ================================ */
    if (text === 'approve') {

        await query(
            `UPDATE approvals
             SET status='approved',
                 ttd_atasan_at=NOW(),
                 ttd_atasan=?,
                 nama_atasan=?,
                 nik_atasan=?
             WHERE id=?`,
            [ttdPath, atasan.nama_lengkap, atasan.nik, approval.id]
        );

        const media = MessageMedia.fromFilePath(approval.file_path);

        await chat.sendMessage(
            approval.user_wa,
            `Laporan kamu telah *DISETUJUI* oleh atasan.`
        );
        await chat.sendMessage(
            approval.user_wa,
            media
        );

        return sendTyping(chat, 'Approval berhasil diproses.');
    }

    /* ================================
       REVISI
    ================================ */
    if (text === 'revisi') {

        await query(
            `UPDATE approvals
             SET status='revised'
             WHERE id=?`,
            [approval.id]
        );

        await query(
            `UPDATE users SET step_input='alasan_revisi'
             WHERE id=?`,
            [approval.user_id]
        );

        await chat.sendMessage(
            approval.user_wa,
            'Laporan kamu *PERLU REVISI*. Silakan perbaiki dan export ulang.'
        );

        return sendTyping(chat, 'Permintaan revisi telah dikirim.');
    }

    // Default fallback jika command tidak dikenali
    await sendTyping(chat, `Hmm… ${atasan.nama_lengkap}, aku belum paham pesan kamu.`, 1000);
    await sendTyping(chat, "Coba ketik */help* untuk melihat perintah.", 1000);
};
