// editAbsen.js
const { sendTyping } = require('../utils/sendTyping');

const editSessions = {};

module.exports = async function handleEdit(chat, user, pesan, query) {
    const wa_number = user.wa_number;
    const lowerMsg = pesan.toLowerCase().trim();

    if (!editSessions[wa_number]) {
        editSessions[wa_number] = { step: 'choose_type' };
        return sendTyping(chat, 'Mau edit *absen* atau *lembur*?');
    }

    const session = editSessions[wa_number];

    // Step: pilih tipe
    if (session.step === 'choose_type') {
        if (lowerMsg === 'absen' || lowerMsg === 'lembur') {
            session.type = lowerMsg;
            session.step = 'choose_date';
            return sendTyping(chat, `Mau edit ${lowerMsg} tanggal berapa? (format: YYYY-MM-DD)`);
        } else {
            return sendTyping(chat, 'Pilihan tidak dikenali. Balas dengan *absen* atau *lembur*.');
        }
    }

    // Step: pilih tanggal
    if (session.step === 'choose_date') {
        session.date = lowerMsg;
        try {
            let table = session.type === 'absen' ? 'absensi' : 'lembur';
            const rows = await query(
                `SELECT * FROM ${table} WHERE user_id=? AND tanggal=?`,
                [user.id, session.date]
            );

            if (!rows.length) {
                delete editSessions[wa_number];
                return sendTyping(chat, `Tidak ada data ${session.type} pada tanggal ${session.date}`);
            }

            session.oldData = rows[0];
            session.step = 'input_new_data';

            let msgOldData = `Data lama:\n`;
            if (session.type === 'absen') {
                msgOldData += `Tanggal   : ${rows[0].tanggal}\n`;
                msgOldData += `Jam Masuk : ${rows[0].jam_masuk || '-'}\n`;
                msgOldData += `Jam Pulang: ${rows[0].jam_pulang || '-'}\n`;
                msgOldData += `Deskripsi : ${rows[0].deskripsi || '-'}\n`;
                msgOldData += `\nKirim data baru (format: jam_masuk,jam_pulang,deskripsi)`;
            } else {
                msgOldData += `Tanggal     : ${rows[0].tanggal}\n`;
                msgOldData += `Jam Mulai   : ${rows[0].jam_mulai}\n`;
                msgOldData += `Jam Selesai : ${rows[0].jam_selesai}\n`;
                msgOldData += `Deskripsi   : ${rows[0].deskripsi || '-'}\n`;
                msgOldData += `\nKirim data baru (format: jam_mulai,jam_selesai,deskripsi)`;
            }

            return sendTyping(chat, msgOldData);

        } catch (err) {
            delete editSessions[wa_number];
            console.error(err);
            return sendTyping(chat, 'Terjadi kesalahan saat mengambil data lama.');
        }
    }

    // Step: input data baru
    if (session.step === 'input_new_data') {
        const parts = pesan.split(',');
        if (parts.length < 3) {
            return sendTyping(chat, 'Format data salah. Silakan kirim ulang data baru.');
        }

        if (session.type === 'absen') {
            session.newData = {
                jam_masuk: parts[0].trim(),
                jam_pulang: parts[1].trim(),
                deskripsi: parts[2].trim(),
            };
        } else {
            session.newData = {
                jam_mulai: parts[0].trim(),
                jam_selesai: parts[1].trim(),
                deskripsi: parts[2].trim(),
            };
        }

        session.step = 'confirm';

        let msgConfirm = `Data lama:\n`;
        if (session.type === 'absen') {
            msgConfirm += `Jam Masuk : ${session.oldData.jam_masuk || '-'}\n`;
            msgConfirm += `Jam Pulang: ${session.oldData.jam_pulang || '-'}\n`;
            msgConfirm += `Deskripsi : ${session.oldData.deskripsi || '-'}\n`;
        } else {
            msgConfirm += `Jam Mulai  : ${session.oldData.jam_mulai}\n`;
            msgConfirm += `Jam Selesai: ${session.oldData.jam_selesai}\n`;
            msgConfirm += `Deskripsi  : ${session.oldData.deskripsi || '-'}\n`;
        }

        msgConfirm += `\nData baru:\n`;
        for (let key in session.newData) {
            msgConfirm += `${key}: ${session.newData[key]}\n`;
        }

        msgConfirm += `\nApakah ingin menyimpan perubahan? (ya/tidak)`;
        return sendTyping(chat, msgConfirm);
    }

    // Step: konfirmasi
    if (session.step === 'confirm') {
        if (lowerMsg === 'ya') {
            try {
                let table = session.type === 'absen' ? 'absensi' : 'lembur';
                let setFields = Object.keys(session.newData)
                    .map(k => `${k}=?`)
                    .join(',');
                await query(
                    `UPDATE ${table} SET ${setFields} WHERE id=?`,
                    [...Object.values(session.newData), session.oldData.id]
                );
                delete editSessions[wa_number];
                return sendTyping(chat, `Perubahan berhasil disimpan.`);
            } catch (err) {
                delete editSessions[wa_number];
                console.error(err);
                return sendTyping(chat, 'Terjadi kesalahan saat menyimpan data.');
            }
        } else if (lowerMsg === 'tidak') {
            delete editSessions[wa_number];
            return sendTyping(chat, 'Perubahan dibatalkan.');
        } else {
            return sendTyping(chat, 'Balas dengan *ya* atau *tidak*.');
        }
    }
};
