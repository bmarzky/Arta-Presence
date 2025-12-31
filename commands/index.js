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
const { sendTypingPerChar } = require('../utils/sendTypingPerChar');
const handleLembur = require('./absensi/lembur'); 
const handleEdit = require('./absensi/editAbsen');
const handleRiwayatAbsen = require('./absensi/riwayatAbsen');
const waitingTTD = require('../utils/waitingTTD');

const ttdFolder = path.join(__dirname, '../assets/ttd/');

if (!fs.existsSync(ttdFolder)) fs.mkdirSync(ttdFolder, { recursive: true });

const typeAndDelay = async (chat, ms = 800, random = 400) => {
    await chat.sendStateTyping();
    await new Promise(r => setTimeout(r, ms + Math.random() * random));
};

const isUserDataComplete = (user) => !!(user.nama_lengkap && user.jabatan && user.nik);

module.exports = {
    message: async (chat, wa_number, nama_wa, db, pesan, messageMedia) => {
        const lowerMsg = pesan.toLowerCase().trim();
        const query = (sql, params) =>
            new Promise((res, rej) =>
                db.query(sql, params, (err, result) => err ? rej(err) : res(result))
            );

        try {
            // Ambil user atau buat baru
            let [user] = await query("SELECT * FROM users WHERE wa_number=?", [wa_number]);

            if (!user) {
                await query("INSERT INTO users (wa_number, nama_wa, intro) VALUES (?, ?, 0)", [wa_number, nama_wa]);
                [user] = await query("SELECT * FROM users WHERE wa_number=?", [wa_number]);
            } else if (user.nama_wa !== nama_wa) {

                await query("UPDATE users SET nama_wa=? WHERE id=?", [nama_wa, user.id]);
                user.nama_wa = nama_wa;
            }

            const command = pesan.split(' ')[0].toLowerCase();
            const restrictedCommands = ['approve', 'revisi', 'status'];

            // Guard restricted commands untuk atasan
            if (restrictedCommands.includes(command)) {
                if (!user.jabatan) return sendTypingPerChar(chat, 'Data jabatan kamu tidak ditemukan.', 30);
                if (user.jabatan !== 'Head West Java Operation') 
                    return sendTypingPerChar(chat, 'Jabatan anda bukan *Head West Java Operation*,\n akses terbatas untuk approvals.', 30);

                return approveAtasan(chat, user, pesan, db);
            }

            // Cancel / close global
            if (['batal', 'cancel', 'close', '/cancel'].includes(lowerMsg)) {
                await query(`UPDATE users SET
                    step_input=NULL, export_type=NULL, template_export=NULL,
                    step_absen=NULL, step_lembur=NULL, step_riwayat=NULL
                    WHERE id=?`, [user.id]);

                if (waitingTTD[wa_number]) delete waitingTTD[wa_number];

                return sendTypingPerChar(chat, 'Proses dibatalkan.', 30);
            }

            // Media (TTD)
            if (messageMedia && messageMedia.mimetype.startsWith('image/')) {
                const ext = messageMedia.mimetype.split('/')[1] || 'png';
                const filePath = path.join(ttdFolder, `${wa_number}.${ext}`);
                fs.writeFileSync(filePath, messageMedia.data, { encoding: 'base64' });

                if (waitingTTD[wa_number]?.user) {
                    const [dbUser] = await query("SELECT * FROM users WHERE wa_number=?", [wa_number]);
                    delete waitingTTD[wa_number];
                    await chat.sendTypingPerChar('*File berhasil ditandatangani*\nLaporan akan dikirim ke atasan untuk proses approval.', 30);
                    return approveUser(chat, dbUser, db);
                }

                if (waitingTTD[wa_number]?.atasan) {
                    const [dbAtasan] = await query("SELECT * FROM users WHERE wa_number=?", [wa_number]);
                    delete waitingTTD[wa_number];
                    await chat.sendTypingPerChar('*File berhasil ditandatangani*\nApproval laporan telah selesai.', 30);
                    return approveAtasan(chat, dbAtasan, 'approve', db);
                }

                return;
            }

            // Intro
            if (user.intro === 0) {
                if (sendingIntro[wa_number]) return;

                sendingIntro[wa_number] = true;

                await typeAndDelay(chat);
                await chat.sendTypingPerChar(
                    `Halo *${nama_wa}* Saya *Arta Presence*, bot absensi otomatis *Lintasarta*.\n\n` +
                    `Silakan gunakan perintah */help* untuk melihat daftar perintah.`, 30
                );

                await query("UPDATE users SET intro=1 WHERE id=?", [user.id]);

                delete sendingIntro[wa_number];
                return;
            }

            // Help
            if (lowerMsg === '/help') return require('./help')(chat, user.nama_wa);

            // Export
            if (lowerMsg.startsWith('/export') || user.step_input) {
                if (!isUserDataComplete(user) && ['choose_export_type', 'choose_template', 'start_export'].includes(user.step_input)) {
                    await query(`UPDATE users SET step_input=NULL, export_type=NULL, template_export=NULL WHERE id=?`, [user.id]);
                    user.step_input = null;
                }

                const [pendingApproval] = await query(`SELECT file_path FROM approvals WHERE user_id=? AND status='pending' ORDER BY created_at DESC LIMIT 1`, [user.id]);
                if (pendingApproval && lowerMsg.startsWith('/export')) {
                    const filename = path.basename(pendingApproval.file_path || '');
                    const type = filename.startsWith('LEMBUR-') ? 'LEMBUR' : 'ABSENSI';
                    return sendTypingPerChar(chat, `Laporan *${type}* kamu sedang dalam proses approval.\nSilakan tunggu sampai proses approval selesai.`, 30);
                }

                await query(`DELETE FROM approvals WHERE user_id=? AND status='draft'`, [user.id]);
                const paramBulan = pesan.split(' ').slice(1)[0] || null;
                return handleExport(chat, user, pesan, db, paramBulan);
            }

            // /approve untuk user biasa
            if (lowerMsg === '/approve') return approveUser(chat, user, db);

            // Absen / lembur / riwayat / edit
            if (lowerMsg === '/riwayat' || user.step_riwayat) return handleRiwayatAbsen(chat, user, pesan, db);
            if (lowerMsg === '/absen' || user.step_absen) return handleAbsen(chat, user, lowerMsg, pesan, query);
            if (lowerMsg === '/lembur' || user.step_lembur) return handleLembur(chat, user, pesan, (sql, params, cb) => db.query(sql, params, cb));
            if (lowerMsg === '/edit' || handleEdit.isEditing(user.wa_number)) return handleEdit(chat, user, pesan, query);

            // Greeting
            const replyGreeting = greetings[lowerMsg];
            if (replyGreeting) {
                const randomReply = greetingReplies[Math.floor(Math.random() * greetingReplies.length)];
                return sendTypingPerChar(chat, `${replyGreeting} *${nama_wa}*, ${randomReply}`, 30);
            }

            // Default fallback
            await sendTypingPerChar(chat, `Hmm… ${nama_wa}, aku belum paham pesan kamu.`, 30);
            await sendTypingPerChar(chat, "Coba ketik */help* untuk melihat perintah.", 30);

        } catch (err) {
            console.error('Error handling message:', err);
            return chat.sendTypingPerChar('Terjadi kesalahan sistem.', 30);
        }
    }
};

