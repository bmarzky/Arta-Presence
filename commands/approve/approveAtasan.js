const { MessageMedia } = require('whatsapp-web.js');
const { sendTyping } = require('../../utils/sendTyping');

module.exports = async function approveAtasan(chat, user, pesan, db) {

    const query = (sql, params) =>
        new Promise((res, rej) =>
            db.query(sql, params, (e, r) => e ? rej(e) : res(r))
        );

    const text = pesan.toLowerCase().trim();

    // cari approval pending milik atasan ini
    const [approval] = await query(
        `SELECT a.*, u.wa_number
         FROM approvals a
         JOIN users u ON u.id = a.user_id
         WHERE a.approver_wa = ? AND a.status = 'pending'
         ORDER BY a.created_at DESC
         LIMIT 1`,
        [user.wa_number]
    );

    if (!approval) return;

    /* =============================
       APPROVE
    ============================= */
    if (text === 'approve') {

        await query(
            `UPDATE approvals
             SET status = 'approved',
                 ttd_atasan_at = NOW()
             WHERE id = ?`,
            [approval.id]
        );

        const media = MessageMedia.fromFilePath(approval.file_path);

        await chat.client.sendMessage(
            approval.wa_number,
            'Laporan kamu telah *DISETUJUI* oleh atasan.'
        );

        await chat.client.sendMessage(
            approval.wa_number,
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
             SET status = 'revised'
             WHERE id = ?`,
            [approval.id]
        );

        await chat.client.sendMessage(
            approval.wa_number,
            'Laporan kamu *PERLU REVISI*. Silakan perbaiki dan export ulang.'
        );

        return sendTyping(chat, 'Permintaan revisi telah dikirim.');
    }
};
