const fs = require('fs');
const path = require('path');
const handleAbsen = require('./absen');
const handleExport = require('./export');
const greetings = require('../data/greetings');
const greetingReplies = require('../data/greetingReplies');
const sendingIntro = {};
const approveUser = require('./approve/approveUser');
const approveAtasan = require('./approve/approveAtasan');
const { sendTyping } = require('../utils/sendTyping');

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
            // =========================
            // USER
            // =========================
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

            // =========================
            // CEK MEDIA (TTD)
            // =========================
            if (messageMedia && messageMedia.mimetype.startsWith('image/')) {
                const ext = messageMedia.mimetype.split('/')[1] || 'png';
                const filename = `${wa_number}.${ext}`;
                const filePath = path.join(ttdFolder, filename);
                fs.writeFileSync(filePath, messageMedia.data, { encoding: 'base64' });
                await chat.sendMessage('TTD berhasil diterima dan disimpan!');

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
                    // langsung jalankan approveAtasan tanpa menunggu input lagi
                    return await approveAtasan(chat, dbAtasan, pesan, db);
                }

                return; // selesai
            }

            // =========================
            // INTRO
            // =========================
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

            // =========================
            // HELP
            // =========================
            if (lowerMsg === '/help') {
                return require('./help')(chat, user.nama_wa);
            }

            // =========================
            // APPROVE ATASAN (STATEFUL)
            // =========================
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

            // =========================
            // EXPORT (COMMAND & STEP)
            // =========================
            if (lowerMsg.startsWith('/export') || user.step_input) {
                const parts = pesan.split(' ').slice(1);
                const paramBulan = parts.length ? parts[0] : null;
                return handleExport(chat, user, pesan, db, paramBulan);
            }

            // =========================
            // ABSEN
            // =========================
            if (lowerMsg === '/absen' || user.step_absen) {
                return handleAbsen(chat, user, lowerMsg, pesan, query);
            }

            // =========================
            // APPROVE USER (SUBMIT LAPORAN)
            // =========================
            if (lowerMsg === '/approve') {
                const ttdPng = path.join(ttdFolder, `${wa_number}.png`);
                const ttdJpg = path.join(ttdFolder, `${wa_number}.jpg`);
                const ttdExists = fs.existsSync(ttdPng) || fs.existsSync(ttdJpg);

                if (!ttdExists) {
                    await chat.sendMessage(
                        'Kamu belum mengunggah TTD. Silakan kirim gambar TTD dalam format PNG/JPG.'
                    );
                    waitingTTD[wa_number] = { user }; // simpan state untuk menunggu TTD
                    return;
                }

                // jika TTD sudah ada, refresh data user dari DB dan approve
                const [dbUser] = await query(`SELECT * FROM users WHERE wa_number=?`, [wa_number]);
                return await approveUser(chat, dbUser, db);
            }

            // =========================
            // APPROVE / REVISI ATASAN (KEYWORD)
            // =========================
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

                // tandai state menunggu TTD jika belum ada
                const ttdPng = path.join(ttdFolder, `${wa_number}.png`);
                const ttdJpg = path.join(ttdFolder, `${wa_number}.jpg`);
                const ttdExists = fs.existsSync(ttdPng) || fs.existsSync(ttdJpg);

                if (!ttdExists) {
                    // simpan state menunggu TTD tapi langsung jalankan approveAtasan nanti setelah TTD dikirim
                    waitingTTD[wa_number] = { atasan: true };
                    await sendTyping(chat, 'Silakan kirim foto TTD kamu untuk approve laporan ini.');
                    return;
                }

                // TTD sudah ada, langsung approve
                return approveAtasan(chat, user, pesan, db);
            }

            // =========================
            // GREETING
            // =========================
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

            // =========================
            // DEFAULT
            // =========================
            await sendTyping(chat, `Hmm… ${nama_wa}, aku belum paham pesan kamu.`, 1000);
            await sendTyping(chat, "Coba ketik */help* untuk melihat perintah.", 1000);

        } catch (err) {
            console.error('Error handling message:', err);
            return chat.sendMessage('Terjadi kesalahan sistem.');
        }
    }
};
