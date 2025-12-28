// index.js
const fs = require('fs');
const path = require('path');
const handleAbsen = require('./absen');
const { handleExport } = require('./export');
const greetings = require('../data/greetings');
const greetingReplies = require('../data/greetingReplies');
const sendingIntro = {};
const approveUser = require('./approve/approveUser');
const approveAtasan = require('./approve/approveAtasan');
const { sendTyping } = require('../utils/sendTyping');
const handleLembur = require('./absensi/lembur'); 
const handleEdit = require('./absensi/editAbsen');
const handleRiwayat = require('./absensi/riwayatAbsen');

const ttdFolder = path.join(__dirname, '../assets/ttd/');

// Buat folder jika belum ada
if (!fs.existsSync(ttdFolder)) {
    fs.mkdirSync(ttdFolder, { recursive: true });
}

// state untuk menunggu TTD per user/atasan
const waitingTTD = {};

const typeAndDelay = async (chat, ms = 800, random = 400) => {
    await chat.sendStateTyping();
    await new Promise(r => setTimeout(r, ms + Math.random() * random));
};

module.exports = {
    message: async (chat, wa_number, nama_wa, db, pesan, messageMedia) => {
        const lowerMsg = pesan.toLowerCase().trim();

        const query = (sql, params) =>
            new Promise((res, rej) =>
                db.query(sql, params, (err, result) =>
                    err ? rej(err) : res(result)
                )
            );

        try {

            // User
            let [user] = await query(
                "SELECT * FROM users WHERE wa_number=?",
                [wa_number]
            );

            if (!user) {
                await query(
                    "INSERT INTO users (wa_number, nama_wa, intro) VALUES (?, ?, 0)",
                    [wa_number, nama_wa]
                );
                [user] = await query(
                    "SELECT * FROM users WHERE wa_number=?",
                    [wa_number]
                );
            }

            // global cancle
            if (['batal', 'cancel', 'close', '/cancel'].includes(lowerMsg)) {

                // reset semua state user
                await query(`
                    UPDATE users SET
                        step_input=NULL,
                        export_type=NULL,
                        template_export=NULL,
                        step_absen=NULL,
                        step_lembur=NULL
                    WHERE id=?
                `, [user.id]);

                // reset waiting TTD
                if (waitingTTD[wa_number]) {
                    delete waitingTTD[wa_number];
                }

                return sendTyping(
                    chat,
                    'Proses dibatalkan.'
                );
            }

            // cek media (TTD)
            if (messageMedia && messageMedia.mimetype.startsWith('image/')) {
                const ext = messageMedia.mimetype.split('/')[1] || 'png';
                const filename = `${wa_number}.${ext}`;
                const filePath = path.join(ttdFolder, filename);
                fs.writeFileSync(filePath, messageMedia.data, { encoding: 'base64' });
                await chat.sendMessage('Laporan Approved');

                // Jika user menunggu TTD untuk approve
                if (waitingTTD[wa_number]?.user) {
                    const [dbUser] = await query(`SELECT * FROM users WHERE wa_number=?`, [wa_number]);
                    delete waitingTTD[wa_number];
                    return await approveUser(chat, dbUser, db);
                }

                // Jika atasan menunggu TTD
                if (waitingTTD[wa_number]?.atasan) {
                    const [dbAtasan] = await query(`SELECT * FROM users WHERE wa_number=?`, [wa_number]);
                    delete waitingTTD[wa_number];
                    // langsung jalankan approveAtasan tanpa harus ketik approve lagi
                    return await approveAtasan(chat, dbAtasan, 'approve', db);
                }

                return;
            }

            // Intro
            if (user.intro === 0 && !sendingIntro[wa_number]) {
                sendingIntro[wa_number] = true;
                await typeAndDelay(chat);
                await chat.sendMessage(
                    `Halo *${nama_wa}* Saya *Arta Presence*, bot absensi otomatis *Lintasarta*.\n\n` +
                    `silakan gunakan perintah */help* untuk melihat daftar perintah yang tersedia.`
                );
                await query("UPDATE users SET intro=1 WHERE id=?", [user.id]);
                sendingIntro[wa_number] = false;
                return;
            }

            // Help
            if (lowerMsg === '/help') {
                return require('./help')(chat, user.nama_wa);
            }


            // Approve atasan
            const [approvalStep] = await query(
                `SELECT id, step_input
                 FROM approvals
                 WHERE approver_wa=? AND step_input IS NOT NULL
                 ORDER BY created_at DESC
                 LIMIT 1`,
                [wa_number]
            );

            if (approvalStep) {
                return approveAtasan(chat, user, pesan, db);
            }

            // Export step
            if (lowerMsg.startsWith('/export') || user.step_input) {

                // CEK LAPORAN MASIH PENDING APPROVAL
                const [pendingApproval] = await query(
                    `SELECT file_path, user_approved
                    FROM approvals
                    WHERE user_id=? AND status='pending'
                    ORDER BY created_at DESC
                    LIMIT 1`,
                    [user.id]
                );

                if (pendingApproval && pendingApproval.status === 'pending' && lowerMsg.startsWith('/export')) {
                    const isLembur  = pendingApproval.file_path?.startsWith('LEMBUR-');
                    const isAbsensi = pendingApproval.file_path?.startsWith('ABSENSI-');

                    return sendTyping(
                        chat,
                        `Laporan *${isLembur ? 'LEMBUR' : 'ABSENSI'}* kamu sedang dalam proses approval.\n` +
                        `Silakan tunggu sampai proses approval selesai.`
                    );
                }

                // Hapus draft lama sebelum di proses
                await query(
                    `DELETE FROM approvals WHERE user_id=? AND status='draft'`,
                    [user.id]
                );

                const parts = pesan.split(' ').slice(1);
                const paramBulan = parts.length ? parts[0] : null;
                return handleExport(chat, user, pesan, db, paramBulan);
            }

            // Absen
            if (lowerMsg === '/absen' || user.step_absen) {
                return handleAbsen(chat, user, lowerMsg, pesan, query);
            }

            if (lowerMsg === '/lembur' || user.step_lembur) {
                const queryCallback = (sql, params, cb) => db.query(sql, params, cb);
                return handleLembur(chat, user, pesan, queryCallback);
            }
            
            if (lowerMsg === '/edit' || handleEdit.isEditing(user.wa_number)) {
                return handleEdit(chat, user, pesan, query);
            }

            if (lowerMsg === '/riwayat' || user.step_riwayat) {
                return handleRiwayat(chat, user, pesan, db);
            }

            // Approve user
            if (lowerMsg === '/approve') {
                // cek laporan pending
                let [approval] = await query(
                    `SELECT *
                    FROM approvals
                    WHERE user_id=? AND status='pending'
                    ORDER BY created_at DESC
                    LIMIT 1`,
                    [user.id]
                );

                if (!approval) {
                    // jika tidak ada pending, cek draft
                    [approval] = await query(
                        `SELECT *
                        FROM approvals
                        WHERE user_id=? AND status='draft'
                        ORDER BY created_at DESC
                        LIMIT 1`,
                        [user.id]
                    );

                    if (!approval) {
                        return sendTyping(chat, 'Kamu belum menyiapkan laporan.');
                    }

                    // ubah draft jadi pending
                    await query(
                        `UPDATE approvals SET status='pending', created_at=NOW() WHERE id=?`,
                        [approval.id]
                    );
                }

                // cek TTD user
                const ttdPng = path.join(ttdFolder, `${wa_number}.png`);
                const ttdJpg = path.join(ttdFolder, `${wa_number}.jpg`);
                const ttdExists = fs.existsSync(ttdPng) || fs.existsSync(ttdJpg);

                if (!ttdExists) {
                    await sendTyping(chat, 'Silakan kirim tanda tangan untuk approve terlebih dahulu laporan ini..');
                    waitingTTD[wa_number] = { user }; // simpan state untuk menunggu TTD
                    return;
                }

                // jika TTD sudah ada, refresh data user dari DB dan approve
                const [dbUser] = await query(`SELECT * FROM users WHERE wa_number=?`, [wa_number]);
                return await approveUser(chat, dbUser, db);
            }

            // Approve / revisi atasan
            if (['approve', 'revisi'].includes(lowerMsg)) {
                const [approval] = await query(
                    `SELECT *
                    FROM approvals
                    WHERE approver_wa=? AND status IN ('pending','revised')
                    ORDER BY created_at DESC
                    LIMIT 1`,
                    [wa_number]
                );

                if (!approval) {
                    return sendTyping(chat, 'Tidak ada laporan yang menunggu approval.');
                }

                if (lowerMsg === 'revisi') {
                    if (approval.status !== 'pending') {
                        return sendTyping(chat, 'Laporan mungkin sedang direvisi, silahkan tunggu dikirim kembali.');
                    }
                    // jalankan revisi langsung tanpa TTD
                    return approveAtasan(chat, user, pesan, db);
                }

                if (lowerMsg === 'approve') {
                    if (approval.status === 'revised') {
                        return sendTyping(chat, 'Laporan ini sudah direvisi.');
                    }

                    // cek TTD atasan
                    const ttdPng = path.join(ttdFolder, `${wa_number}.png`);
                    const ttdJpg = path.join(ttdFolder, `${wa_number}.jpg`);
                    const ttdExists = fs.existsSync(ttdPng) || fs.existsSync(ttdJpg);

                    if (!ttdExists && approval.step_input !== 'ttd_atasan') {
                        await sendTyping(chat, 'Silakan kirim tanda tangan untuk approve laporan ini.');
                        await query(`UPDATE approvals SET step_input='ttd_atasan' WHERE id=?`, [approval.id]);
                        waitingTTD[wa_number] = { atasan: true }; // simpan state menunggu TTD
                        return;
                    }

                    // langsung approve jika TTD sudah ada
                    return approveAtasan(chat, user, pesan, db);
                }
            }

            // Greeting
            const replyGreeting = greetings[lowerMsg];
            if (replyGreeting) {
                const randomReply =
                    greetingReplies[Math.floor(Math.random() * greetingReplies.length)];
                return sendTyping(
                    chat,
                    `${replyGreeting} *${nama_wa}*, ${randomReply}`,
                    1000
                );
            }

            // Default
            await sendTyping(chat, `Hmm… ${nama_wa}, aku belum paham pesan kamu.`, 1000);
            await sendTyping(chat, "Coba ketik */help* untuk melihat perintah.", 1000);

        } catch (err) {
            console.error('Error handling message:', err);
            return chat.sendMessage('Terjadi kesalahan sistem.');
        }
    }
};
