// help.js
const { sendTyping } = require('../utils/sendTyping');

module.exports = async function handleHelp(chat, nama_wa) {

    // Pesan pembuka
    await sendTyping(
        chat,
        `Halo ${nama_wa} 👋\nBerikut daftar perintah yang bisa kamu gunakan di ARTA PRESENCE:`,
        1000
    );

    // Perintah Absensi
    await sendTyping(
        chat,
`*Perintah Absensi:*
- /absen
  Mulai proses absen untuk (MASUK / PULANG)

- /lembur
  Mulai proses untuk lmbur

- /edit
  Edit data absensi atau lembur yang sudah dibuat *(jika masih bisa diedit)*`
        ,
        1000
    );

    // Perintah Export
    await sendTyping(
        chat,
`*Perintah Export:*
- /export
  Export laporan Absensi atau Lembur ke PDF
`
        ,
        1000
    );

    // Perintah Approval
    await sendTyping(
        chat,
`*Perintah Pengajuan:*
- /approve
  Kirim laporan ke atasan untuk disetujui
`
        ,
        1000
    );

    // Perintah Lain
    await sendTyping(
        chat,
`*Perintah Lain:*
- /help
  Menampilkan daftar perintah

- /info
  Informasi singkat tentang bot ARTA PRESENCE`
        ,
        1000
    );

    // Pesan penutup
    await sendTyping(
        chat,
        `Jika mengalami kendala, tolong hubungi author 🤗`,
        1000
    );
};
