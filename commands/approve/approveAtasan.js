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

    // path TTD berdasarkan wa_number atasan, cek PNG dan JPG
    let ttdPath = '';
    const ttdPng = path.join(__dirname, '../../assets/ttd', `${user.wa_number}.png`);
    const ttdJpg = path.join(__dirname, '../../assets/ttd', `${user.wa_number}.jpg`);

    if (fs.existsSync(ttdPng)) ttdPath = ttdPng;
    else if (fs.existsSync(ttdJpg)) ttdPath = ttdJpg;

    if (!ttdPath) {
        await sendTyping(chat, 'TTD atasan tidak ditemukan. Pastikan file ada di folder /assets/ttd dengan nama wa_number.png/jpg');
        return;
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
            [
                ttdPath,
                approval.nama_atasan || user.pushname || '',
                approval.nik_atasan || '',
                approval.id
            ]
        );

        // kirim PDF ke user
        const media = MessageMedia.fromFilePath(approval.file_path);
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
            `UPDATE users
             SET step_input='alasan_revisi'
             WHERE id=?`,
            [approval.user_id]
        );

        await chat.client.sendMessage(
            approval.user_wa,
            'Laporan kamu *PERLU REVISI*. Silakan perbaiki dan export ulang.'
        );
        return sendTyping(chat, 'Permintaan revisi telah dikirim.');
    }

    // fallback jika pesan tidak dikenali
    await sendTyping(chat, `Hmm… aku belum paham pesan kamu. Coba ketik */help* untuk melihat perintah.`);
};
