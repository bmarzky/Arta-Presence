// approveUser.js
const { MessageMedia } = require('whatsapp-web.js');
const { sendTyping } = require('../../utils/sendTyping');
const getGreeting = require('../../data/greetingTime');
const fs = require('fs');
const path = require('path');
const generatePDF = require('../../utils/pdfGenerator');
const { getLogoBase64, getTTDHTML } = require('../../utils/getAssets');
const waitingTTD = require('../../utils/waitingTTD');
const moment = require('moment');

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
    const wa_number = user.wa_number;

    if (!user_id)
        return sendTyping(chat, 'ID user tidak tersedia.');


    try {
        // Ambil approval terakhir
        const [approval] = await query(
            `SELECT * FROM approvals WHERE user_id=? ORDER BY created_at DESC LIMIT 1`,
            [user_id]
        );

        if (!approval || !approval.file_path)
            return sendTyping(chat, 'Kamu belum menyiapkan laporan.');
        // export type dari file path
        if (approval.file_path) {
            const filename = path.basename(approval.file_path);

            let fixedType = approval.export_type;

            if (filename.startsWith('LEMBUR-')) {
                fixedType = 'lembur';
            } else if (filename.startsWith('ABSENSI-')) {
                fixedType = 'absensi';
            }

            if (fixedType !== approval.export_type) {
                approval.export_type = fixedType;
                await query(
                    `UPDATE approvals SET export_type=? WHERE id=?`,
                    [fixedType, approval.id]
                );
            }
        }


// Ambil approver dari DB jika kosong
let approverWA = approval.approver_wa;
let nama_atasan = approval.nama_atasan || '';
let nik_atasan = approval.nik_atasan || '';

if (!approverWA) {
    const [approver] = await query(`SELECT * FROM users WHERE jabatan='Head West Java Operation' LIMIT 1`);
    if (!approver) {
        return sendTyping(chat, "Head West Java Operation Belum Menggunakan *ARTA PRESENCE*");
    }
    
    approverWA = approver.wa_number;
    nama_atasan = approver.nama_lengkap;
    nik_atasan  = approver.nik;

    await query(
        `UPDATE approvals SET approver_wa=?, nama_atasan=?, nik_atasan=? WHERE id=?`,
        [approverWA, nama_atasan, nik_atasan, approval.id]
    );
}

        // Ambil approval untuk bulan & tipe saat ini
        const now = new Date();
        const [currentApproval] = await query(
        `SELECT * FROM approvals
        WHERE user_id=? 
            AND export_type=? 
            AND MONTH(created_at)=? 
            AND YEAR(created_at)=?
        ORDER BY created_at DESC
        LIMIT 1`,
        [user_id, approval.export_type, now.getMonth() + 1, now.getFullYear()]
        );

        const approvalToSend = currentApproval || approval;

        if (currentApproval) {
            // validasi status
            if (approvalToSend.status === 'approved') {
                return sendTyping(chat, 'Laporan bulan ini sudah disetujui.');
            }

            if (approvalToSend.status === 'revised') {
                return sendTyping(chat, 'Laporan perlu revisi. Silakan export ulang.');
            }

            // hanya draft yang boleh naik ke pending
            if (approvalToSend.status === 'draft') {
                await query(
                    `UPDATE approvals SET status='pending' WHERE id=?`,
                    [approvalToSend.id]
                );
                approvalToSend.status = 'pending';
            }

            if (approvalToSend.status !== 'pending') {
                return sendTyping(chat, 'Laporan ini sedang diproses.');
            }
        }

        // update ke processing tanpa mengunci status
        await query(
            `UPDATE approvals SET status='processing' WHERE id=?`,
            [approvalToSend.id]
        );
        approvalToSend.status = 'processing';


// pastikan WA format
if (!approverWA || typeof approverWA !== 'string') {
    return sendTyping(chat, 'Nomor WhatsApp atasan belum tersedia.');
}

if (!approverWA.includes('@')) {
    approverWA += '@c.us';
}

// cek ttd user
const ttdPng = path.join(ttdFolder, `${wa_number}.png`);
const ttdJpg = path.join(ttdFolder, `${wa_number}.jpg`);

if (!fs.existsSync(ttdPng) && !fs.existsSync(ttdJpg)) {
    // simpan context supaya bot tahu user sedang dikirim TTD
    waitingTTD[wa_number] = { user: true, approval_id: approvalToSend.id };

    return sendTyping(
        chat,
        'Silakan kirim foto tanda tangan kamu untuk melanjutkan approval.'
    );
}

// jika TTD sudah ada → langsung generate PDF + kirim ke atasan
const updatedFilePath =
    approvalToSend.export_type === 'lembur'
        ? await generatePDFLemburwithTTD(
              user,
              db,
              approvalToSend.template_export,
              nama_atasan,
              nik_atasan
          )
        : await generatePDFwithTTD(
              user,
              db,
              approvalToSend.template_export,
              nama_atasan,
              nik_atasan
          );

// pastikan WA approver
let approverWAfinal = approverWA.includes('@') ? approverWA : approverWA + '@c.us';

const media = MessageMedia.fromFilePath(
    Array.isArray(updatedFilePath) ? updatedFilePath[0] : updatedFilePath
);

await chat.client.sendMessage(
    approverWAfinal,
    `*Permintaan Approval Laporan ${approvalToSend.export_type === 'lembur' ? 'Lembur' : 'Absensi'}*\n\n` +
    `${getGreeting() || ''} *${nama_atasan}*\n\n` +
    `*${nama_user}* meminta permohonan approval untuk laporan ${approvalToSend.export_type}.\nMohon untuk diperiksa.`
);

await chat.client.sendMessage(approverWAfinal, media);
await chat.client.sendMessage(
    approverWAfinal,
    `Silakan ketik salah satu opsi berikut:\n\n` +
    `• *approve* Tipe Laporan-nama\n` +
    `• *revisi*  Tipe Laporan-nama`
);

// update status ke pending (langsung kirim ke atasan)
await query(`UPDATE approvals SET status='pending' WHERE id=?`, [approvalToSend.id]);

return sendTyping(chat, `*${nama_user}*, laporan berhasil dikirim ke *${nama_atasan}* untuk proses approval.`);


    } 
    
    
    catch (err) {        
        console.error('Gagal kirim approval:', err);
        return sendTyping(chat, 'Terjadi kesalahan saat mengirim approval.');
    }
};

// pdf absensi
async function generatePDFwithTTD(user, db, templateName, namaAtasan = 'Atasan', nikAtasan = '') {
    const query = (sql, params = []) =>
        new Promise((res, rej) => db.query(sql, params, (err, r) => err ? rej(err) : res(r)));

    // ambil absensi
    const now = new Date();
    const bulan = now.getMonth() + 1;
    const tahun = now.getFullYear();
    const absensi = await query(
        `SELECT * FROM absensi WHERE user_id=? AND MONTH(tanggal)=? AND YEAR(tanggal)=? ORDER BY tanggal`,
        [user.id, bulan, tahun]
    );

    // template HTML
    const templatePath = path.join(__dirname, `../../templates/absensi/${templateName}.html`);
    let html = fs.readFileSync(templatePath, 'utf8');

    // rows absensi
    const rows = [];
    const totalHari = new Date(tahun, bulan, 0).getDate();
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

    // ttd
    const ttdUserHTML = getTTDHTML(user.wa_number);
    html = html.replace(/{{logo}}/g, logoBase64)
               .replace(/{{nama}}/g, user.nama_lengkap)
               .replace(/{{jabatan}}/g, user.jabatan)
               .replace(/{{nik}}/g, user.nik)
               .replace(/{{periode}}/g, `${1}-${totalHari} ${moment().format('MMMM YYYY')}`)
               .replace(/{{rows_absensi}}/g, rows.join(''))
               .replace(/{{ttd_user}}/g, ttdUserHTML)
               .replace(/{{nama_atasan}}/g, namaAtasan)
               .replace(/{{nik_atasan}}/g, nikAtasan);

    // export PDF
    const exportsDir = path.join(__dirname, '../../exports');
    if (!fs.existsSync(exportsDir)) fs.mkdirSync(exportsDir, { recursive: true });
    const bulanNama = moment().format('MMMM');
    const safeName = user.nama_lengkap
        .toLowerCase()
        .replace(/[^a-z0-9]+/g,'-')
        .replace(/^-+|-+$/g,'');

        const output = path.join(
            exportsDir,
            `ABSENSI-${safeName}-${templateName}-${bulanNama}-${tahun}.pdf`
        );

    await generatePDF(html, output);
    return output;
}

// pdf lembur
async function generatePDFLemburwithTTD(user, db, templateName = 'LMD', namaAtasan = '', nikAtasan = '') {
    const query = (sql, params = []) =>
        new Promise((res, rej) => db.query(sql, params, (err, r) => err ? rej(err) : res(r)));

    if (!namaAtasan || !nikAtasan) {
        const [approver] = await query(`SELECT * FROM users WHERE jabatan='Head West Java Operation' LIMIT 1`);
        namaAtasan = approver?.nama_lengkap || 'Approver';
        nikAtasan  = approver?.nik || '-';
    }

    // Ambil data lembur
    const lemburData = await query(`SELECT YEAR(tanggal) AS tahun, MONTH(tanggal) AS bulan, lembur.* FROM lembur WHERE user_id=? ORDER BY tanggal`, [user.id]);
    if (!lemburData.length) throw new Error('Belum ada data lembur untuk dibuat PDF.');

    const bulanNama = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];

    // Grouping per bulan
    const grouped = {};
    for(const l of lemburData){
        const key = `${l.tahun}-${l.bulan}`;
        if(!grouped[key]) grouped[key] = [];
        grouped[key].push(l);
    }

    // Prioritas bulan sekarang, fallback bulan terakhir
    const now = new Date();
    const currentKey = `${now.getFullYear()}-${now.getMonth() + 1}`;
    const keysToGenerate = grouped[currentKey] ? [currentKey] : [Object.keys(grouped).sort().pop()];

    const exportsDir = path.join(__dirname,'../../exports');
    if(!fs.existsSync(exportsDir)) fs.mkdirSync(exportsDir,{recursive:true});

    // menyimpan semua PDF
    const pdfFiles = [];

    for(const key of keysToGenerate){
        const dataBulan = grouped[key];
        const sample = dataBulan[0];
        const bulanIdx = sample.bulan - 1;
        const tahun = sample.tahun;

        const periode = templateName === 'LMD'
            ? `${bulanNama[bulanIdx]} ${tahun}`
            : `1 - ${new Date(tahun, bulanIdx+1, 0).getDate()} ${bulanNama[bulanIdx]} ${tahun}`;

        // Logo
        const logoBase64 = getLogoBase64(templateName);

        //ttd
        const ttdUserHTML = getTTDHTML(user.wa_number);

        // Generate rows
        let rows = '';
        let totalLemburDecimal = 0;

        if(templateName === 'KSPS'){
            const totalHari = new Date(tahun, bulanIdx+1, 0).getDate();
            for(let i=1;i<=totalHari;i++){
                const dateObj = moment(`${tahun}-${bulanIdx+1}-${i}`, 'YYYY-M-D');
                const l = dataBulan.find(x => moment(x.tanggal).format('YYYY-MM-DD') === dateObj.format('YYYY-MM-DD'));

                let totalJam = '';
                if(l?.total_lembur){
                    const [h,m=0] = l.total_lembur.includes(':') ? l.total_lembur.split(':').map(Number) : [parseFloat(l.total_lembur),0];
                    const jam = h + m/60;
                    totalLemburDecimal += jam;
                    totalJam = `${jam % 1 === 0 ? jam : jam.toFixed(1)} Jam`;
                }

                rows += `<tr>
    <td>${i}</td>
    <td>${l?.jam_mulai || ''}</td>
    <td>${l?.jam_selesai || ''}</td>
    <td>${totalJam}</td>
    <td>${l?.deskripsi || ''}</td>
    <td></td>
</tr>`;
            }
        } else {
            for(const l of dataBulan){
                let jam = 0;
                if(l.total_lembur){
                    const [h,m=0] = l.total_lembur.includes(':') ? l.total_lembur.split(':').map(Number) : [parseFloat(l.total_lembur),0];
                    jam = h + m/60;
                    totalLemburDecimal += jam;
                }

                rows += `<tr>
    <td>${moment(l.tanggal).format('DD/MM/YYYY')}</td>
    <td>${moment(l.tanggal).locale('id').format('dddd')}</td>
    <td>${l.jam_mulai || '-'}</td>
    <td>${l.jam_selesai || '-'}</td>
    <td>${jam ? (jam % 1 === 0 ? jam : jam.toFixed(1))+' Jam' : '-'}</td>
    <td>${l.deskripsi || '-'}</td>
</tr>`;
            }
        }

        const totalLembur = `${totalLemburDecimal % 1 === 0 ? totalLemburDecimal : totalLemburDecimal.toFixed(1)} Jam`;

        // Template HTML
        const templatePath = path.join(__dirname, `../../templates/lembur/${templateName}.html`);
        let htmlTemplate = fs.readFileSync(templatePath,'utf8');

        const html = htmlTemplate
            .replace(/{{rows_lembur}}/g, rows)
            .replace(/{{nama}}/g, user.nama_lengkap || '-')
            .replace(/{{jabatan}}/g, user.jabatan || '-')
            .replace(/{{nik}}/g, user.nik || '-')
            .replace(/{{periode}}/g, periode)
            .replace(/{{logo}}/g, logoBase64)
            .replace(/{{ttd_user}}/g, ttdUserHTML)
            .replace(/{{nama_atasan}}/g, namaAtasan)
            .replace(/{{nik_atasan}}/g, nikAtasan)
            .replace(/{{total_lembur}}/g, totalLembur)

        const safeName = user.nama_lengkap
            .toLowerCase()
            .replace(/[^a-z0-9]+/g,'-')
            .replace(/^-+|-+$/g,'');

        const pdfFile = path.join(
            exportsDir,
            `LEMBUR-${safeName}-${templateName}-${bulanNama[bulanIdx]}-${tahun}.pdf`
        );

        // Simpan HTML sementara (opsional)
        fs.writeFileSync(path.join(exportsDir, `LEMBUR-${safeName}-${templateName}-${bulanNama[bulanIdx]}-${tahun}.html`), html, 'utf8');

        await generatePDF(html, pdfFile);
        pdfFiles.push(pdfFile);; // simpan PDF yang di-generate
    }

    // kembalikan array PDF jika lebih dari 1, atau string PDF terakhir
    return pdfFiles.length === 1 ? pdfFiles[0] : pdfFiles;
}


