const fs = require('fs');
const path = require('path');
const moment = require('moment');
const generatePDF = require('../utils/pdfGenerator');
const { MessageMedia } = require('whatsapp-web.js');
const { sendTyping } = require('../utils/sendTyping');

module.exports = async function handleExport(chat, user, pesan, db, paramBulan = null) {
    if (!db) return chat.sendMessage('Database tidak tersedia.');

    const query = (sql, params) => new Promise((res, rej) => {
        db.query(sql, params, (err, result) => err ? rej(err) : res(result));
    });

    // Ambil data user terbaru
    const userData = await query(`SELECT * FROM users WHERE id=?`, [user.id]);
    if (!userData || userData.length === 0) return sendTyping(chat, 'Data user tidak ditemukan.');
    user = { ...user, ...userData[0] };

    const fields = ['nama_lengkap','jabatan','divisi','nik'];
    const labels = {
        nama_lengkap: 'Nama lengkap',
        jabatan: 'Jabatan',
        divisi: 'Divisi',
        nik: 'NIK'
    };

    let stepNow = user.step_input;

    // --- Step konfirmasi nama ---
    if (!user.nama_lengkap && !stepNow && !user.has_done_export) {
        await query(`UPDATE users SET step_input='confirm_name' WHERE id=?`, [user.id]);
        return sendTyping(chat,
            `Maaf, untuk membuat laporan PDF aku butuh beberapa data kamu. Ini hanya untuk sekali saja.\n\n` +
            `Apakah benar nama kamu *${user.nama_wa}*? (iya/tidak)`
        );
    }

    if (stepNow === 'confirm_name' && pesan) {
        const lower = pesan.toLowerCase();
        if (lower === 'iya' || lower === 'benar') {
            await query(`UPDATE users SET nama_lengkap=?, step_input=NULL WHERE id=?`, [user.nama_wa, user.id]);
            user.nama_lengkap = user.nama_wa;
            stepNow = null;
        } else if (lower === 'tidak') {
            await query(`UPDATE users SET step_input='nama_lengkap' WHERE id=?`, [user.id]);
            return sendTyping(chat, `Silakan isi ${labels['nama_lengkap']}:`);
        } else {
            return sendTyping(chat, `Mohon jawab dengan 'iya' atau 'tidak'.`);
        }
    }

    // --- Cek field kosong ---
    const missingFields = fields.filter(f => !user[f]);
    if (missingFields.length > 0 && !stepNow) {
        await query(`UPDATE users SET step_input=? WHERE id=?`, [missingFields[0], user.id]);
        await sendTyping(chat, `Maaf, datamu masih ada yang kurang, tolong isi dulu yaa.`, 800);
        const firstMissing = labels[missingFields[0]];
        return sendTyping(chat, `Silakan isi ${firstMissing}:`, 800);
    }

    // --- Step input field satu per satu ---
    if (stepNow && fields.includes(stepNow) && pesan) {
        await query(`UPDATE users SET ${stepNow}=? WHERE id=?`, [pesan, user.id]);
        user[stepNow] = pesan;

        // Ambil field kosong berikutnya
        const nextStep = fields.find(f => !user[f]);
        if (nextStep) {
            await query(`UPDATE users SET step_input=? WHERE id=?`, [nextStep, user.id]);
            return sendTyping(chat, `Terima kasih. Silakan isi ${labels[nextStep]}:`);
        } else {
            // Semua lengkap → hapus step_input & generate PDF
            await query(`UPDATE users SET step_input=NULL WHERE id=?`, [user.id]);
            return generatePDFandSend(chat, user, db, paramBulan);
        }
    }

    // --- Jika semua lengkap dan step_input kosong ---
    if (fields.every(f => user[f])) {
        return generatePDFandSend(chat, user, db, paramBulan);
    }
};

// --- Fungsi generate PDF ---
async function generatePDFandSend(chat, user, db, paramBulan = null) {
    const namaBulanArr = ["Januari","Februari","Maret","April","Mei","Juni",
                          "Juli","Agustus","September","Oktober","November","Desember"];
    
    const now = new Date();
    let bulan = now.getMonth();
    let tahun = now.getFullYear();

    if (paramBulan) {
        const idx = namaBulanArr.findIndex(b => b.toLowerCase() === paramBulan.toLowerCase());
        if (idx >= 0) bulan = idx;
    }

    const jumlahHari = new Date(tahun, bulan + 1, 0).getDate();
    user.periode = `1 - ${jumlahHari} ${namaBulanArr[bulan]} ${tahun}`;

    const query = (sql, params) => new Promise((res, rej) => {
        db.query(sql, params, (err, result) => err ? rej(err) : res(result));
    });

    const absensiData = await query(
        `SELECT * FROM absensi WHERE user_id=? AND MONTH(tanggal)=? AND YEAR(tanggal)=? ORDER BY tanggal`,
        [user.id, bulan + 1, tahun]
    );

    const absensiByDate = [];
    for (let i = 1; i <= jumlahHari; i++) {
        const tgl = moment(`${tahun}-${bulan + 1}-${i}`, 'YYYY-M-D').format('YYYY-MM-DD');
        const record = absensiData.find(a => moment(a.tanggal).format('YYYY-MM-DD') === tgl);
        absensiByDate.push({
            tanggal: tgl,
            jam_masuk: record ? record.jam_masuk : '',
            jam_pulang: record ? record.jam_pulang : '',
            deskripsi: record ? record.deskripsi : ''
        });
    }

    const rows_absensi = absensiByDate.map(a => `
        <tr>
            <td>${moment(a.tanggal).format('DD')}</td>
            <td>${a.jam_masuk}</td>
            <td>${a.jam_pulang}</td>
            <td>${a.deskripsi}</td>
            <td></td>
        </tr>
    `).join('');

    const template = fs.readFileSync(path.join(__dirname, '../templates/pdf.html'), 'utf8');
    const logoBase64 = fs.readFileSync(path.join(__dirname, '../assets/ksps.png'), 'base64');

    const html = template
        .replaceAll('{{logo_path}}', `data:image/png;base64,${logoBase64}`)
        .replaceAll('{{nama}}', user.nama_lengkap)
        .replaceAll('{{jabatan}}', user.jabatan)
        .replaceAll('{{divisi}}', user.divisi)
        .replaceAll('{{lokasi}}', user.lokasi || 'Aplikanusa Lintasarta Bandung')
        .replaceAll('{{kelompok_pekerjaan}}', user.kelompok_pekerjaan || 'Central Regional Operation')
        .replaceAll('{{periode}}', user.periode)
        .replaceAll('{{rows_absensi}}', rows_absensi)
        .replaceAll('{{nama_atasan}}', user.nama_atasan || 'Deni Ramdiansyah')
        .replaceAll('{{nik_atasan}}', user.nik_atasan || '76970654')
        .replaceAll('{{nik}}', user.nik);

    await sendTyping(chat, 'File sedang disiapkan, mohon tunggu...', 1500);
    const fileName = `${user.nama_lengkap}-${namaBulanArr[bulan]}.pdf`;
    const outputPath = path.join(__dirname, '../exports', fileName);
    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);

    await generatePDF(html, outputPath);
    const media = MessageMedia.fromFilePath(outputPath);
    await chat.sendMessage(media);

    // Tandai bahwa user sudah pernah export
    await query(`UPDATE users SET has_done_export=1 WHERE id=?`, [user.id]);

    return sendTyping(chat, `Laporan absensi berhasil dibuat: ${fileName}`, 1000);


}
