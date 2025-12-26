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

const ttdFolder = path.resolve('../assets/ttd/');
if (!fs.existsSync(ttdFolder)) fs.mkdirSync(ttdFolder, { recursive: true });

// state untuk menunggu TTD per user
const waitingTTD = {};

const typeAndDelay = async (chat, ms = 800, random = 400) => {
    await chat.sendStateTyping();
    await new Promise(r => setTimeout(r, ms + Math.random() * random));
};

module.exports = {
    message: async (chat, wa_number, nama_wa, db, pesan) => {
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

            // CEK JIKA USER MENGIRIM MEDIA
            if (chat.hasMedia) {
                const media = await chat.downloadMedia();
                if (media && media.mimetype.includes('image/png')) {
                    const ttdPath = path.join(ttdFolder, `${wa_number}.png`);
                    fs.writeFileSync(ttdPath, media.data, 'base64');

                    await chat.sendMessage('TTD berhasil tersimpan.');

                    // jika user sedang menunggu approval
                    if (waitingTTD[wa_number]) {
                        await approveUser(chat, waitingTTD[wa_number].user, db);
                        delete waitingTTD[wa_number];
                    }

                    return; // penting, hentikan eksekusi lain
                } else {
                    return chat.sendMessage('File harus berupa gambar PNG. Silakan kirim ulang TTD.');
                }
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

            // =====================================================
            // APPROVE ATASAN (STATEFUL)
            // =====================================================
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
                const ttdPath = path.join(ttdFolder, `${wa_number}.png`);

                if (!fs.existsSync(ttdPath)) {
                    await chat.sendMessage(
                        'Kamu belum mengunggah TTD. Silakan kirim gambar TTD dalam format PNG.'
                    );

                    waitingTTD[wa_number] = { user }; // simpan state untuk menunggu TTD
                    return;
                }

                // jika TTD sudah ada, langsung approve
                return await approveUser(chat, user, db);
            }
            // =========================
            // APPROVE / REVISI ATASAN (KEYWORD)
            // =========================
            if (['approve', 'revisi'].includes(lowerMsg)) {
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
