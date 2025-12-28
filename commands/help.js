// help.js
const { sendTyping } = require('../utils/sendTyping');

module.exports = async function handleHelp(chat, nama_wa) {

    // Pesan pembuka
    await sendTyping(
        chat,
        `Halo *${nama_wa}* 👋\nBerikut daftar perintah yang bisa kamu gunakan di ARTA PRESENCE:`,
        1000
    );

    // Perintah Absensi
    await sendTyping(
        chat,
`*Absensi:*
- /absen - Mulai proses absen untuk (MASUK / PULANG)

- /lembur - Mulai proses untuk lmbur

- /edit - Edit data absensi atau lembur yang sudah dibuat

- /riwayat - Melihat data laporan approved sebelumnya`
        ,
        1000
    );

    // Perintah Export
    await sendTyping(
        chat,
`*Export:*
- /export - Export laporan Absensi atau Lembur ke PDF
`
        ,
        1000
    );

    // Perintah Approval
    await sendTyping(
        chat,
`*Pengajuan:*
- /approve - Kirim laporan ke atasan untuk disetujui`
        ,
        1000
    );

    // Perintah Lain
    await sendTyping(
        chat,
`*Perintah Lain:*
- /info - Informasi singkat tentang bot ARTA PRESENCE *(maintenance)*`
        ,
        1000
    );

    // Pesan penutup
    await sendTyping(
        chat,
        `Jika kamu mengalami kendala, tolong hubungi author 🤗`,
        1000
    );
};
