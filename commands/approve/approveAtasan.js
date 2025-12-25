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

    // ambil approval pending terbaru milik atasan ini
    const [approval] = await query(
        `SELECT a.*, u.wa_number as user_wa, u.nama_lengkap as user_nama, u.nik as user_nik, u.template_export
         FROM approvals a
         JOIN users u ON u.id = a.user_id
         WHERE a.approver_wa = ? AND a.status = 'pending'
         ORDER BY a.created_at DESC
         LIMIT 1`,
        [user.wa_number]
    );

    if (!approval) return;

    // ambil data atasan sendiri
    const [atasan] = await query(
        `SELECT * FROM users WHERE wa_number = ? LIMIT 1`,
        [user.wa_number]
    );

    if (!atasan) return;

    const ttdPath = path.join(__dirname, '../../ttd', `${user.id}.png`);

    // jika atasan belum punya TTD
    if (!fs.existsSync(ttdPath) && text !== 'kirim ttd') {
        await chat.client.sendMessage(
            user.wa_number,
            'Kamu belum mengirim TTD untuk approve. Silakan kirim gambarnya sekarang (format PNG/JPG).'
        );
        return sendTyping(chat, 'Menunggu TTD atasan...');
    }

    /* =============================
       TERIMA GAMBAR TTD
    ============================= */
    if (chat.hasMedia && !fs.existsSync(ttdPath)) {
        const media = await chat.downloadMedia();
        if (!media || !media.data) return;

        const buffer = Buffer.from(media.data, 'base64');
        fs.writeFileSync(ttdPath, buffer);

        await chat.client.sendMessage(
            user.wa_number,
            'TTD berhasil diterima. Sekarang kamu bisa approve laporan.'
        );
        return sendTyping(chat, 'TTD tersimpan.');
    }

    /* =============================
       APPROVE
    ============================= */
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

        // generate media PDF
        const media = MessageMedia.fromFilePath(approval.file_path);

        // kirim ke user
        await chat.client.sendMessage(
            approval.user_wa,
            `Laporan kamu telah *DISETUJUI* oleh atasan.`
        );
        await chat.client.sendMessage(
            approval.user_wa,
            media
        );

        return sendTyping(chat, 'Approval berhasil diproses.');
    }

    /* =============================
       REVISI
    ============================= */
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

        await chat.client.sendMessage(
            approval.user_wa,
            'Laporan kamu *PERLU REVISI*. Silakan perbaiki dan export ulang.'
        );

        return sendTyping(chat, 'Permintaan revisi telah dikirim.');
    }
};