// approveUser.js
const { MessageMedia } = require('whatsapp-web.js');
const { sendTyping } = require('../../utils/sendTyping');
const getGreeting = require('../../data/greetingTime');
const fs = require('fs');
const path = require('path');
const generatePDF = require('../../utils/pdfGenerator');

// folder TTD
const ttdFolder = path.join(__dirname, '../../assets/ttd/');
if (!fs.existsSync(ttdFolder)) fs.mkdirSync(ttdFolder, { recursive: true });

module.exports = async function approveUser(chat, user, db) {
    const query = (sql, params = []) =>
        new Promise((res, rej) =>
            db.query(sql, params, (e, r) => (e ? rej(e) : res(r)))
        );

    const nama_user = user.pushname || user.nama_wa || 'Arta';
    const user_id = user.id;
    const wa_number = user.wa_number; // pastikan sesuai kolom db

    if (!user_id)
        return sendTyping(chat, 'ID user tidak tersedia.');

    try {
        /* =====================================================
           AMBIL APPROVAL TERAKHIR USER
        ===================================================== */
        const [approval] = await query(
            `SELECT *
             FROM approvals
             WHERE user_id=?
             ORDER BY created_at DESC
             LIMIT 1`,
            [user_id]
        );

        /* =====================================================
           BELUM PERNAH EXPORT
        ===================================================== */
        if (!approval || !approval.file_path) {
            return sendTyping(
                chat,
                'Kamu belum menyiapkan laporan atau belum di-export.\nSilakan ketik */export* terlebih dahulu.'
            );
        }

        const filePath = path.resolve(approval.file_path);
        if (!fs.existsSync(filePath)) {
            return sendTyping(
                chat,
                'File laporan tidak ditemukan.\nSilakan export ulang.'
            );
        }

        /* =====================================================
           CEK STATUS APPROVAL
        ===================================================== */
        if (approval.status === 'revised') {
            return sendTyping(
                chat,
                'Laporan kamu *perlu revisi*.\nSilakan perbaiki lalu */export* ulang.'
            );
        }

        if (approval.status === 'approved') {
            return sendTyping(
                chat,
                'Laporan kamu bulan ini sudah *DISETUJUI*.\nTidak bisa diajukan kembali.'
            );
        }

        if (approval.status !== 'pending') {
            return sendTyping(
                chat,
                'Laporan tidak dalam status pending approval.'
            );
        }

        /* =====================================================
           CEK TTD SEBELUM KIRIM
        ===================================================== */
        const ttdPng = path.join(ttdFolder, `${wa_number}.png`);
        const ttdJpg = path.join(ttdFolder, `${wa_number}.jpg`);
        let ttdFile = '';
        if (fs.existsSync(ttdPng)) ttdFile = ttdPng;
        else if (fs.existsSync(ttdJpg)) ttdFile = ttdJpg;

        if (!ttdFile) {
            return sendTyping(
                chat,
                `Kamu belum mengunggah TTD. Silakan kirim gambar TTD dalam format PNG/JPG.\n` +
                `Setelah dikirim, ketik */approve* lagi untuk mengajukan laporan.`
            );
        }

        /* =====================================================
           GENERATE ULANG FILE DENGAN TTD
        ===================================================== */
        const updatedFilePath = await generatePDFwithTTD(user, filePath, ttdFile);

        /* =====================================================
           KIRIM KE ATASAN
        ===================================================== */
        let approverWA = approval.approver_wa;
        if (!approverWA)
            return sendTyping(chat, 'Nomor approver belum disetel.');

        if (!approverWA.includes('@'))
            approverWA += '@c.us';

        const media = MessageMedia.fromFilePath(updatedFilePath);
        const greeting = getGreeting() || '';
        const nama_atasan = approval.nama_atasan || 'Atasan';

        await chat.client.sendMessage(
            approverWA,
            `*Permintaan Approval Laporan Absensi*\n\n` +
            `${greeting} *${nama_atasan}*\n\n` +
            `*${nama_user}* meminta permohonan approval untuk laporan absensi.\n` +
            `Mohon untuk diperiksa.`
        );

        await chat.client.sendMessage(approverWA, media);

        await chat.client.sendMessage(
            approverWA,
            `Silakan ketik:\n` +
            `• *approve*\n` +
            `• *revisi*`
        );

        return sendTyping(
            chat,
            `*${nama_user}*, laporan berhasil dikirim ke *${nama_atasan}* untuk proses approval.`
        );

    } catch (err) {
        console.error('Gagal kirim approval:', err);
        return sendTyping(
            chat,
            'Terjadi kesalahan saat mengirim approval.'
        );
    }
};

/* =====================================================
   GENERATE PDF DENGAN TTD
===================================================== */
async function generatePDFwithTTD(user, oldFilePath, ttdFile) {
    const fs = require('fs');
    const path = require('path');
    const generatePDF = require('../../utils/pdfGenerator');

    // ambil nama file lama
    const dir = path.dirname(oldFilePath);
    const ext = path.extname(oldFilePath);
    const baseName = path.basename(oldFilePath, ext);
    const newFilePath = path.join(dir, `${baseName}-TTD.pdf`);

    // baca file lama sebagai template HTML jika ada
    // asumsi generatePDF bisa menerima file HTML atau content lama
    // di sini kita pakai content lama untuk generate ulang dengan TTD

    let html = fs.readFileSync(oldFilePath.replace('.pdf', '.html'), 'utf8').toString();

    // baca TTD user
    const ttdBase64 = fs.readFileSync(ttdFile).toString('base64');
    const ttdHTML = `<img src="data:image/png;base64,${ttdBase64}" style="max-width:150px; max-height:80px;" />`;

    // replace placeholder TTD
    html = html.replace(/{{ttd_user}}/g, ttdHTML);

    await generatePDF(html, newFilePath);

    return newFilePath;
}
