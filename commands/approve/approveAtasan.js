// approveAtasan.js
const { MessageMedia } = require('whatsapp-web.js');
const { sendTyping } = require('../../utils/sendTyping');
const path = require('path');
const fs = require('fs');
const moment = require('moment');
const generatePDF = require('../../utils/pdfGenerator');
const { getLogoBase64, getTTDHTML } = require('../../utils/getAssets');
const waitingTTD = require('../../utils/waitingTTD');


module.exports = async function approveAtasan(chat, user, pesan, db, isTTDReady = false) {
    const query = (sql, params = []) =>
        new Promise((resolve, reject) =>
            db.query(sql, params, (err, res) => err ? reject(err) : resolve(res))
        );

    const rawText = pesan || '';
    const text = rawText.trim().toLowerCase();
    let currentApprovalId = null;

    try {
        // data atasan
        const [atasan] = await query(`SELECT * FROM users WHERE wa_number=? LIMIT 1`, [user.wa_number]);
        if (!atasan) return sendTyping(chat, 'Data atasan tidak ditemukan.');
        // ttd confirm
if (waitingTTD[user.wa_number]?.atasan) {
    if (!chat.hasMedia) {
        return sendTyping(chat, 'Silakan kirim *foto TTD* untuk melanjutkan approval.');
    }

    const image = await chat.downloadMedia();
    if (!image.mimetype.startsWith('image/')) {
        return sendTyping(chat, 'TTD harus berupa *gambar* (PNG/JPG).');
    }

    const ext = image.mimetype.split('/')[1];
    const ttdPath = path.join(__dirname, '../../assets/ttd', `${atasan.wa_number}.${ext}`);
    fs.writeFileSync(ttdPath, image.data, { encoding: 'base64' });

    // Hapus waitingTTD agar tidak looping minta TTD lagi
    const approvalId = waitingTTD[user.wa_number].approval_id;
    delete waitingTTD[user.wa_number];

    // Langsung generate PDF
    const [approval] = await query(`SELECT * FROM approvals WHERE id=?`, [approvalId]);
    const ttdAtasanHTML = getTTDHTML(atasan.wa_number);
    const ttdUserHTML   = getTTDHTML(approval.user_wa);

    let outputPath;
    if (approval.export_type === 'lembur') {
        outputPath = await generatePDFLemburForAtasan(approval, db, ttdAtasanHTML, ttdUserHTML);
    } else {
        outputPath = await generatePDFForAtasan(approval, db, ttdAtasanHTML, ttdUserHTML);
    }

    await query(`UPDATE approvals SET status='approved', step_input=NULL, ttd_atasan_at=NOW() WHERE id=?`, [approval.id]);

    const media = MessageMedia.fromFilePath(outputPath);
    const userWA = approval.user_wa.includes('@') ? approval.user_wa : approval.user_wa + '@c.us';
    await chat.client.sendMessage(userWA, media);
    await chat.client.sendMessage(userWA, `Laporan ${approval.export_type}-${approval.user_nama} telah disetujui oleh *${atasan.nama_lengkap}*.`);

    return sendTyping(chat, '*File berhasil ditandatangani*\nApproval laporan telah selesai.');
}

        // Semua laporan pending/revised
        const pendingApprovals = await query(`
            SELECT a.*,
                   u.wa_number AS user_wa,
                   u.nama_lengkap AS user_nama,
                   u.nik AS user_nik,
                   u.jabatan AS user_jabatan,
                   u.template_export,
                   u.export_type
            FROM approvals a
            JOIN users u ON u.id = a.user_id
            WHERE a.approver_wa=? 
                AND (
                    a.status IN ('pending','revised','processing')
                    OR a.step_input IN ('alasan_revisi','ttd_atasan')
                )
            ORDER BY a.created_at ASC
        `, [user.wa_number]);

        if (!pendingApprovals.length) return sendTyping(chat, 'Tidak ada laporan yang menunggu approval.');

        // Status
        if (text === 'status') {
            const msg = pendingApprovals.map((a, i) =>
                `${i+1}. ${a.user_nama} (${a.export_type}) - Status: ${a.status}`
            ).join('\n');
            return sendTyping(chat, `*Daftar Laporan Pending / Revisi:*\n\n${msg}`);
        }


        // ================= STEP 2: kirim alasan revisi =================
        if (waitingTTD[user.wa_number]?.revisi_id) {
            const revisiId = waitingTTD[user.wa_number].revisi_id;

            await query(
                `UPDATE approvals SET revisi_catatan=?, step_input=NULL WHERE id=?`,
                [pesan.trim(), revisiId]
            );

            // ambil data user untuk dikirim revisi
            const [revisiApproval] = await query(
                `SELECT u.wa_number AS user_wa, u.nama_lengkap AS user_nama 
                 FROM approvals a 
                 JOIN users u ON u.id = a.user_id
                 WHERE a.id=?`,
                [revisiId]
            );

            const userWA = revisiApproval.user_wa.includes('@') ? revisiApproval.user_wa : revisiApproval.user_wa + '@c.us';
            await chat.client.sendMessage(
                userWA,
                `*LAPORAN PERLU REVISI*\n\nApproval: *${user.nama_lengkap}*\n\n*Catatan revisi:*\n${pesan.trim()}\n\nSilakan perbaiki dan lakukan */export* ulang.`
            );

            delete waitingTTD[user.wa_number];
            return sendTyping(chat, `Revisi berhasil dikirim ke *${revisiApproval.user_nama}*.`);
        }


        // Parsing approve/revisi
        const match = rawText.trim().match(/^(approve|revisi)\s+([^-]+)-(.+)$/i);
        if (!match)
            return sendTyping(chat, 'Format salah. Contoh:\napprove lembur-Bima Rizki');

        const action = match[1].toLowerCase();
        const export_type = match[2].trim().toLowerCase();
        const namaUser = match[3].trim().toLowerCase();

        // Ambil approval terbaru yang pending
        const allowedStatuses = ['pending', 'processing'];
        const approval = pendingApprovals
            .filter(a =>
                a.export_type.toLowerCase() === export_type &&
                a.user_nama.toLowerCase() === namaUser &&
                allowedStatuses.includes(a.status)
            )
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];


        if (!approval) {
            const oldApproval = pendingApprovals.find(a =>
                a.export_type.toLowerCase() === export_type &&
                a.user_nama.toLowerCase() === namaUser
            );
            if (!oldApproval) return sendTyping(chat, `Tidak ditemukan laporan ${export_type}-${namaUser}.`);
            if (oldApproval.status === 'revised') return sendTyping(chat, 'Laporan sudah dikembalikan untuk di revisi.');
            if (oldApproval.status === 'approved') return sendTyping(chat, 'Laporan sudah disetujui.');
        }

        // Handle revisi
// STEP 1: atasan ketik "revisi ..."
if (action === 'revisi') {
    await query(
        `UPDATE approvals SET status='revised', step_input='alasan_revisi' WHERE id=?`,
        [approval.id]
    );

    // simpan id revisi untuk menunggu alasan
    waitingTTD[user.wa_number] = { revisi_id: approval.id };
    return sendTyping(chat, `Silakan ketik *alasan revisi* untuk ${export_type}-${namaUser}.`);
}

        // Handle approve
        if (action === 'approve') {
            if (!approval) {
                return sendTyping(chat, `Tidak ditemukan laporan ${export_type}-${namaUser} yang pending.`);
            }

        // cek TTD atasan
        const ttdFolder = path.join(__dirname, '../../assets/ttd');
        const ttdFiles = fs.readdirSync(ttdFolder);

        const ttdExists = ttdFiles.some(f => f.startsWith(atasan.wa_number));
        if (!ttdExists) {
            waitingTTD[user.wa_number] = {
                atasan: true,
                approval_id: approval.id
            };
            await sendTyping(chat, 'Silakan kirim foto TTD kamu untuk approve laporan ini.');
            await query(
                `UPDATE approvals 
                SET step_input='ttd_atasan' 
                WHERE id=? AND status='pending'`,
                [approval.id]
            );
            return;
        }

        currentApprovalId = approval.id;

// Jika masih pending, update ke processing
if (approval.status === 'pending') {
    await query(
        `UPDATE approvals SET status='processing' WHERE id=?`,
        [approval.id]
    );
}

// Lanjutkan proses approve
const ttdAtasanHTML = getTTDHTML(atasan.wa_number);
const ttdUserHTML = getTTDHTML(approval.user_wa);

// Generate PDF
let outputPath;
if (approval.export_type === 'lembur') {
    outputPath = await generatePDFLemburForAtasan(approval, db, ttdAtasanHTML, ttdUserHTML, atasan.wa_number);
} else {
    outputPath = await generatePDFForAtasan(approval, db, ttdAtasanHTML, ttdUserHTML, atasan.wa_number);
}

// Update status approved
await query(
    `UPDATE approvals 
    SET status='approved',
        step_input=NULL,
        ttd_atasan_at=NOW()
    WHERE id=?`,
    [approval.id]
);

        // Kirim file ke user
        const media = MessageMedia.fromFilePath(outputPath);
        const userWA = approval.user_wa.includes('@') ? approval.user_wa : approval.user_wa + '@c.us';
        await chat.client.sendMessage(userWA, media);
        await chat.client.sendMessage(userWA, `Laporan ${approval.export_type}-${approval.user_nama} telah disetujui oleh *${atasan.nama_lengkap}*.`);
        await sendTyping(chat, `*File berhasil ditandatangani*\nApproval laporan telah selesai dan dikirim ke *${approval.user_nama}*.`);

        return;
    }


    } catch (e) {
    if (currentApprovalId) {
        await query(
            `UPDATE approvals SET status='pending' 
             WHERE id=? AND status='processing'`,
            [currentApprovalId]
        );
    }
    console.error(e);
    return sendTyping(chat, 'Terjadi kesalahan saat memproses approval.');
        }
};

// Fungsi generate PDF - absensi
async function generatePDFForAtasan(approval, db, ttdAtasanHTML, ttdUserHTML)
 {

    const generatePDF = require('../../utils/pdfGenerator');
    const templateName = approval.template_export;

    // helper query
    const query = (sql, params = []) =>
        new Promise((res, rej) => db.query(sql, params, (err, r) => err ? rej(err) : res(r)));

    // ambil absensi
    const now = new Date();
    const bulan = now.getMonth() + 1;
    const tahun = now.getFullYear();
    const totalHari = new Date(tahun, bulan, 0).getDate();

    const absensi = await query(
        `SELECT * FROM absensi WHERE user_id=? AND MONTH(tanggal)=? AND YEAR(tanggal)=? ORDER BY tanggal`,
        [approval.user_id, bulan, tahun]
    );

    // template HTML
    const templatePath = path.join(__dirname, `../../templates/absensi/${templateName}.html`);
    if (!fs.existsSync(templatePath)) throw new Error(`Template ${templateName}.html tidak ditemukan.`);
    let html = fs.readFileSync(templatePath, 'utf8');

    // rows absensi
    const rows = [];
    for (let i = 1; i <= totalHari; i++) {
        const dateObj = moment(`${tahun}-${bulan}-${i}`, 'YYYY-M-D');
        const r = absensi.find(a => moment(a.tanggal).format('YYYY-MM-DD') === dateObj.format('YYYY-MM-DD'));
        rows.push(
            templateName === 'LMD'
                ? `<tr style="background-color:${[0,6].includes(dateObj.day())?'#f15a5a':'#FFF'}">
                     <td>${dateObj.format('DD/MM/YYYY')}</td>
                     <td>${dateObj.format('dddd')}</td>
                     <td>${r?.jam_masuk||'-'}</td>
                     <td>${r?.jam_pulang||'-'}</td>
                     <td>${r?.deskripsi||'-'}</td>
                   </tr>`
                : `<tr style="background-color:${[0,6].includes(dateObj.day())?'#f0f0f0':'#FFF'}">
                     <td>${i}</td>
                     <td>${r?.jam_masuk||''}</td>
                     <td>${r?.jam_pulang||''}</td>
                     <td>${[0,6].includes(dateObj.day())?'<b>LIBUR</b>':(r?.deskripsi||'')}</td>
                     <td></td>
                   </tr>`
        );
    }

    // logo
    const logoBase64 = getLogoBase64(templateName);

    html = html.replace(/{{logo}}/g, logoBase64)
               .replace(/{{nama}}/g, approval.user_nama)
               .replace(/{{jabatan}}/g, approval.user_jabatan || '')
               .replace(/{{nik}}/g, approval.user_nik || '')
               .replace(/{{periode}}/g, `${1}-${totalHari} ${moment().format('MMMM YYYY')}`)
               .replace(/{{rows_absensi}}/g, rows.join(''))
               .replace(/{{ttd_user}}/g, ttdUserHTML)
               .replace(/{{ttd_atasan}}/g, ttdAtasanHTML)
               .replace(/{{nama_atasan}}/g, approval.nama_atasan || 'Atasan')
               .replace(/{{nik_atasan}}/g, approval.nik_atasan || '');

    // export PDF
    const exportsDir = path.join(__dirname, '../../exports');
    if (!fs.existsSync(exportsDir)) fs.mkdirSync(exportsDir, { recursive: true });
    const safeName = approval.user_nama
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');

    const outputPath = path.join(
        exportsDir,
        `ABSENSI-${safeName}-${templateName}-Approved.pdf`
    );
    
    await generatePDF(html, outputPath);
    return outputPath;
}

// Fungsi generate PDF - lembur
async function generatePDFLemburForAtasan(approval, db, ttdAtasanHTML, ttdUserHTML) {

    const generatePDF = require('../../utils/pdfGenerator');
    const templateName = approval.template_export || 'LMD';
    const bulanNama = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];

    // Ambil semua data lembur user
    const lemburData = await new Promise((resolve, reject) =>
        db.query(
            `SELECT *, YEAR(tanggal) AS tahun, MONTH(tanggal) AS bulan FROM lembur WHERE user_id=? ORDER BY tanggal`,
            [approval.user_id],
            (err, res) => err ? reject(err) : resolve(res)
        )
    );
    if (!lemburData.length) throw new Error('Belum ada data lembur.');

    // Group per bulan
    const grouped = {};
    for (const l of lemburData) {
        const key = `${l.tahun}-${l.bulan}`;
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(l);
    }

    // Prioritas bulan sekarang, fallback bulan terakhir
    const now = new Date();
    const currentKey = `${now.getFullYear()}-${now.getMonth() + 1}`;
    const keysToGenerate = grouped[currentKey] ? [currentKey] : [Object.keys(grouped).sort().pop()];

    const exportsDir = path.join(__dirname, '../../exports');
    if (!fs.existsSync(exportsDir)) fs.mkdirSync(exportsDir, { recursive: true });

    const pdfFiles = [];

    for (const key of keysToGenerate) {
        const dataBulan = grouped[key];
        const sample = dataBulan[0];
        const bulanIdx = sample.bulan - 1;
        const tahun = sample.tahun;

        const periode = templateName === 'LMD'
            ? `${bulanNama[bulanIdx]} ${tahun}`
            : `1 - ${new Date(tahun, bulanIdx+1, 0).getDate()} ${bulanNama[bulanIdx]} ${tahun}`;

        let rows = '';
        let totalLemburDecimal = 0;

        if (templateName === 'KSPS') {
            const totalHari = new Date(tahun, bulanIdx + 1, 0).getDate();
            for (let i = 1; i <= totalHari; i++) {
                const dateObj = moment(`${tahun}-${bulanIdx + 1}-${i}`, 'YYYY-M-D');
                const l = dataBulan.find(x => moment(x.tanggal).format('YYYY-MM-DD') === dateObj.format('YYYY-MM-DD'));

                let totalJam = '';
                if (l?.total_lembur) {
                    const [h, m=0] = l.total_lembur.includes(':') ? l.total_lembur.split(':').map(Number) : [parseFloat(l.total_lembur),0];
                    const jamDecimal = h + m/60;
                    totalLemburDecimal += jamDecimal;
                    totalJam = `${Number.isInteger(jamDecimal) ? jamDecimal : jamDecimal.toFixed(1)} Jam`;
                }

                rows += `<tr>
<td>${i}</td>
<td>${l?.jam_mulai||''}</td>
<td>${l?.jam_selesai||''}</td>
<td>${totalJam}</td>
<td>${l?.deskripsi||''}</td>
<td></td>
</tr>`;
            }
        } else { // LMD
            for (const l of dataBulan) {
                let jamDecimal = 0;
                if (l.total_lembur) {
                    if (l.total_lembur.includes(':')) {
                        const [h,m] = l.total_lembur.split(':').map(Number);
                        jamDecimal = h + m/60;
                    } else {
                        jamDecimal = parseFloat(l.total_lembur);
                    }
                    totalLemburDecimal += jamDecimal;
                    l.total_lembur = `${Number.isInteger(jamDecimal) ? jamDecimal : jamDecimal.toFixed(1)} Jam`;
                }

                rows += `<tr>
<td>${moment(l.tanggal).format('DD/MM/YYYY')}</td>
<td>${moment(l.tanggal).locale('id').format('dddd')}</td>
<td>${l.jam_mulai||'-'}</td>
<td>${l.jam_selesai||'-'}</td>
<td>${l.total_lembur||'-'}</td>
<td>${l.deskripsi||'-'}</td>
</tr>`;
            }
        }

        const totalLemburKeseluruhan = `${Number.isInteger(totalLemburDecimal) ? totalLemburDecimal : totalLemburDecimal.toFixed(1)} Jam`;

    // logo
    const logoBase64 = getLogoBase64(templateName);

        // Template HTML
        const templatePath = path.join(__dirname, `../../templates/lembur/${templateName}.html`);
        if (!fs.existsSync(templatePath)) throw new Error(`Template ${templateName}.html tidak ditemukan`);
        let htmlTemplate = fs.readFileSync(templatePath, 'utf8');

        const html = htmlTemplate
            .replace(/{{rows_lembur}}/g, rows)
            .replace(/{{nama}}/g, approval.user_nama || '')
            .replace(/{{jabatan}}/g, approval.user_jabatan || '')
            .replace(/{{nik}}/g, approval.user_nik || '')
            .replace(/{{periode}}/g, periode)
            .replace(/{{logo}}/g, logoBase64)
            .replace(/{{ttd_user}}/g, ttdUserHTML)
            .replace(/{{ttd_atasan}}/g, ttdAtasanHTML)
            .replace(/{{nama_atasan}}/g, approval.nama_atasan || '')
            .replace(/{{nik_atasan}}/g, approval.nik_atasan || '')
            .replace(/{{total_lembur}}/g, totalLemburKeseluruhan);

        const safeName = approval.user_nama.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
        const outputPath = path.join(exportsDir, `LEMBUR-${safeName}-${templateName}-${bulanNama[bulanIdx]}-${tahun}-Approved.pdf`);
        await generatePDF(html, outputPath);
        pdfFiles.push(outputPath);
    }

    return pdfFiles.length === 1 ? pdfFiles[0] : pdfFiles;
}
