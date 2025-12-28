const { sendTyping } = require('../utils/sendTyping');

module.exports = async function handleRiwayatAbsen(chat, user, pesan, db){
    const text = pesan.trim().toLowerCase();

    // STEP 0: trigger
    if(text === '/riwayat'){
        user.step_riwayat = 'pilih';

        return sendTyping(chat,
`Ingin melihat riwayat apa?
1. Absen
2. Lembur

Balas: absen atau lembur`);
    }

    // STEP 1: pilih jenis
    if(user.step_riwayat === 'pilih'){
        if(!['absen','lembur'].includes(text))
            return sendTyping(chat,'Balas dengan: absen atau lembur');

        // untuk sekarang kita handle absen saja
        if(text === 'lembur'){
            delete user.step_riwayat;
            return sendTyping(chat,'Riwayat lembur menyusul');
        }

        user.step_riwayat = 'periode';

        return sendTyping(
            chat,
            'Silakan ketik bulan dan tahun laporan.\nContoh: 12 2024'
        );
    }

    // STEP 2: input bulan & tahun
    if(user.step_riwayat === 'periode'){
        const match = pesan.match(/^(\d{1,2})\s+(\d{4})$/);
        if(!match)
            return sendTyping(chat,'Format salah.\nContoh: 12 2024');

        const bulan = Number(match[1]);
        const tahun = Number(match[2]);

        if(bulan < 1 || bulan > 12)
            return sendTyping(chat,'Bulan harus antara 1–12');

        // === AMBIL RIWAYAT ABSEN DI SINI ===
        const data = await new Promise((res, rej)=>{
            db.query(
                `SELECT *
                 FROM absensi
                 WHERE user_id=?
                 AND MONTH(tanggal)=?
                 AND YEAR(tanggal)=?
                 ORDER BY tanggal`,
                [user.id, bulan, tahun],
                (e,r)=>e?rej(e):res(r)
            );
        });

        if(!data.length){
            delete user.step_riwayat;
            return sendTyping(chat,'Tidak ada data absen pada periode tersebut.');
        }

        // TODO: generate PDF di sini
        await sendTyping(chat,`Menampilkan riwayat absen ${bulan}/${tahun} (PDF menyusul)`);

        // reset state
        delete user.step_riwayat;
        return;
    }
};
