// editLembur.js
const sessions = {};
const moment = require('moment');
moment.locale('id');

function parseFlexibleTime(input) {
    input = input.trim().toLowerCase();
    let h = 0, m = 0;

    const matchHHMM = input.match(/^(\d{1,2}):(\d{2})$/);
    if (matchHHMM) return { h: parseInt(matchHHMM[1]), m: parseInt(matchHHMM[2]) };

    const matchSetengah = input.match(/^setengah\s+(\d{1,2})\s*(pagi|siang|sore|malam)$/);
    if (matchSetengah) {
        let num = parseInt(matchSetengah[1]);
        const period = matchSetengah[2];
        m = 30;
        switch(period){
            case 'pagi': h = num-1; break;
            case 'siang': case 'sore': case 'malam': h = (num%12)+12-1; break;
        }
        if (h<0) h+=12;
        return {h,m};
    }

    const matchPeriod = input.match(/^(\d{1,2})\s*(pagi|siang|sore|malam)$/);
    if (matchPeriod) {
        let num = parseInt(matchPeriod[1]);
        const period = matchPeriod[2];
        m = 0;
        switch(period){
            case 'pagi': h = num%12; break;
            case 'siang': case 'sore': case 'malam': h = (num%12)+12; break;
        }
        return {h,m};
    }
    return null;
}

module.exports = async function handleEditLembur(chat, user, pesan, query) {
    const userId = user.id;
    const rawText = pesan.trim();
    const lowerMsg = rawText.toLowerCase();

    // =========================
    // RESET SESSION SETIAP /editLembur
    // =========================
    if (lowerMsg === '/edit') {
        // reset session dari awal
        sessions[userId] = { step: 'choose_date', data: {} };
        return chat.sendMessage('Silakan masukkan tanggal lembur yang ingin diedit (format: YYYY-MM-DD):');
    }

    // Pastikan session sudah ada
    if (!sessions[userId]) sessions[userId] = { step: 'choose_date', data: {} };
    const session = sessions[userId];

    switch(session.step) {
        case 'choose_date': {
            const date = moment(rawText, ['YYYY-MM-DD','D MMMM YYYY'], true);
            if (!date.isValid()) return chat.sendMessage('Format tanggal tidak valid. Contoh: 28 Desember 2025');
            const tanggal = date.format('YYYY-MM-DD');
            session.data.tanggal = tanggal;

            query(`SELECT * FROM lembur WHERE user_id=? AND tanggal=?`, [userId, tanggal], (err, results) => {
                if (err) return chat.sendMessage('Terjadi kesalahan saat mengambil data lembur.');
                if (!results.length) {
                    delete sessions[userId];
                    return chat.sendMessage(`Tidak ada data lembur pada tanggal ${tanggal}`);
                }

                session.data.old = results[0];
                session.step = 'input_new_data';

                let msgOldData = `Data lama:\n`;
                msgOldData += `Tanggal     : ${results[0].tanggal}\n`;
                msgOldData += `Jam Mulai   : ${results[0].jam_mulai}\n`;
                msgOldData += `Jam Selesai : ${results[0].jam_selesai}\n`;
                msgOldData += `Deskripsi   : ${results[0].deskripsi || '-'}\n`;
                msgOldData += `\nKirim data baru (format: jam_mulai,jam_selesai,deskripsi)`;
                chat.sendMessage(msgOldData);
            });
            break;
        }

        case 'input_new_data': {
            const parts = rawText.split(',');
            if (parts.length < 3) return chat.sendMessage('Format salah. Kirim: jam_mulai,jam_selesai,deskripsi');

            const jamMulaiParsed = parseFlexibleTime(parts[0]);
            const jamSelesaiParsed = parseFlexibleTime(parts[1]);
            if (!jamMulaiParsed || !jamSelesaiParsed) return chat.sendMessage('Format jam salah.');

            session.data.new = {
                jam_mulai: `${String(jamMulaiParsed.h).padStart(2,'0')}:${String(jamMulaiParsed.m).padStart(2,'0')}`,
                jam_selesai: `${String(jamSelesaiParsed.h).padStart(2,'0')}:${String(jamSelesaiParsed.m).padStart(2,'0')}`,
                deskripsi: parts[2].trim()
            };

            session.step = 'confirm';

            let msgConfirm = 'Data lama:\n';
            msgConfirm += `Jam Mulai   : ${session.data.old.jam_mulai}\n`;
            msgConfirm += `Jam Selesai : ${session.data.old.jam_selesai}\n`;
            msgConfirm += `Deskripsi   : ${session.data.old.deskripsi || '-'}\n\n`;

            msgConfirm += 'Data baru:\n';
            msgConfirm += `Jam Mulai   : ${session.data.new.jam_mulai}\n`;
            msgConfirm += `Jam Selesai : ${session.data.new.jam_selesai}\n`;
            msgConfirm += `Deskripsi   : ${session.data.new.deskripsi}\n`;
            msgConfirm += '\nApakah ingin menyimpan perubahan? (Ya/Tidak)';

            chat.sendMessage(msgConfirm);
            break;
        }

        case 'confirm': {
            if (lowerMsg === 'ya') {
                query(
                    `UPDATE lembur SET jam_mulai=?, jam_selesai=?, deskripsi=? WHERE id=?`,
                    [session.data.new.jam_mulai, session.data.new.jam_selesai, session.data.new.deskripsi, session.data.old.id],
                    (err) => {
                        if (err) return chat.sendMessage('Terjadi kesalahan saat menyimpan data.');
                        delete sessions[userId];
                        chat.sendMessage('Perubahan lembur berhasil disimpan. Total lembur akan dihitung saat export.');
                    }
                );
            } else if (lowerMsg === 'tidak') {
                delete sessions[userId];
                chat.sendMessage('Perubahan dibatalkan.');
            } else {
                chat.sendMessage('Ketik Ya atau Tidak untuk konfirmasi.');
            }
            break;
        }
    }
};
