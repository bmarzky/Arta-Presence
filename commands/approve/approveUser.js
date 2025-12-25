const { MessageMedia } = require('whatsapp-web.js');
const { sendTyping } = require('../../utils/sendTyping');
const getGreeting = require('../../data/greetingTime');
const fs = require('fs');

module.exports = async function approveUser(chat, user, db) {
    const query = (sql, params) =>
        new Promise((res, rej) => db.query(sql, params, (e, r) => e ? rej(e) : res(r)));

    const nama_wa = user.pushname || user.nama_wa || 'User';

    // ambil approval pending
    const [approval] = await query(
        `SELECT id, approver_wa, file_path FROM approvals WHERE user_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1`,
        [user.id]
    );
    if (!approval) return sendTyping(chat, 'Tidak ada laporan yang menunggu approval.');

    // pastikan nomor WA valid
    let approverWA = approval.approver_wa.replace(/@.*/, '') + '@c.us';

    // ambil info approver
    const [approver] = await query(
        `SELECT nama_lengkap FROM users WHERE wa_number = ? LIMIT 1`,
        [approverWA]
    );
    const approverName = approver?.nama_lengkap || 'Approver';

    // cek file
    if (!approval.file_path || !fs.existsSync(approval.file_path)) {
        return sendTyping(chat, 'File laporan tidak ditemukan. Silakan export ulang.');
    }
    let media;
    try { media = MessageMedia.fromFilePath(approval.file_path); }
    catch { return sendTyping(chat, 'File laporan tidak bisa dibuka.'); }

    // greeting
    let greeting = '';
    try { greeting = getGreeting() || ''; } catch {}

    // kirim pesan + file ke approver
    try {
        await chat.client.sendMessage(
            approverWA,
            `${greeting}\n\n*${nama_wa}* meminta approval absensi berikut.\nSilakan diperiksa.\n\nBalas dengan:\n• approve\n• revisi`
        );
        await chat.client.sendMessage(approverWA, media);

        return sendTyping(chat, `Permintaan approval sudah dikirim ke *${approverName}*.`);
    } catch (err) {
        console.error('Gagal kirim approval:', err);
        return sendTyping(chat, 'Terjadi kesalahan saat mengirim approval. Silakan coba lagi.');
    }
};
