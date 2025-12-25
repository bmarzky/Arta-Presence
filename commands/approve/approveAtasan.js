const { MessageMedia } = require('whatsapp-web.js');
const { sendTyping } = require('../../data/greetingTime');

module.exports = async function approveAtasan(chat, user, pesan, db) {

    const query = (sql, params) =>
        new Promise((res, rej) =>
            db.query(sql, params, (e, r) => e ? rej(e) : res(r))
        );

    const text = pesan.toLowerCase();

    const [approval] = await query(
        `SELECT * FROM approvals
         WHERE approver_wa=? AND status='pending'
         ORDER BY created_at DESC LIMIT 1`,
        [user.id]
    );

    if (!approval) return;

    /* =============================
       APPROVE
    ============================= */
    if (text === 'approve') {

        await query(
            `UPDATE approvals
             SET status='approved', ttd_atasan_at=NOW()
             WHERE id=?`,
            [approval.id]
        );

        const media = MessageMedia.fromFilePath(approval.file_path);

        await chat.client.sendMessage(
            approval.user_id + '@c.us',
            'Laporan absensi kamu telah *disetujui* oleh atasan.'
        );

        await chat.client.sendMessage(
            approval.user_id + '@c.us',
            media
        );

        return sendTyping(chat, 'Approval berhasil.');
    }

    /* =============================
       REVISI
    ============================= */
    if (text === 'revisi') {
        await query(
            `UPDATE approvals SET status='revised' WHERE id=?`,
            [approval.id]
        );

        await query(
            `UPDATE users SET step_input='alasan_revisi'
             WHERE id=?`,
            [approval.user_id]
        );

        return sendTyping(chat, 'Silakan kirim alasan revisi.');
    }
};
