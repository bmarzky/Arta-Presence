const sendTypingPerChar = require('../utils/sendTypingPerChar');

module.exports = async function handleHelp(chat, nama_wa) {
    await sendTypingPerChar(chat, `Halo *${nama_wa}* 👋`, 15);
    await sendTypingPerChar(
        chat,
        `ARTA PRESENCE sekarang sudah menggunakan *AI Intent*, jadi kamu bisa mengetik *bahasa biasa* tanpa harus hafal perintah 😊`,
        10
    );

    await sendTypingPerChar(
        chat,
        `*Absensi & Lembur*\n` +
        `Contoh:\n` +
        `• "absen masuk"\n` +
        `• "absen pulang"\n` +
        `• "saya lembur hari ini"\n` +
        `• "edit absen kemarin"\n` +
        `• "lihat riwayat absen"\n\n` +
        `*(command lama masih bisa: /absen, /lembur, /edit, /riwayat)*`,
        10
    );

    await sendTypingPerChar(
        chat,
        `*Export Laporan*\n` +
        `Contoh:\n` +
        `• "export laporan absen bulan ini"\n` +
        `• "download laporan lembur"\n\n` +
        `*(command: /export)*`,
        10
    );

    await sendTypingPerChar(
        chat,
        `*Approval*\n` +
        `Contoh:\n` +
        `• "kirim laporan untuk approval"\n` +
        `• "ajukan laporan ke atasan"\n\n` +
        `*(command: /approve)*`,
        10
    );

    await sendTypingPerChar(
        chat,
        `Jika mengalami kendala, silakan hubungi admin 🙏`,
        25
    );
};
