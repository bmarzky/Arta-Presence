const fs = require('fs');
const path = require('path');
const moment = require('moment');
const { MessageMedia } = require('whatsapp-web.js');
const { sendTyping } = require('../utils/sendTyping');
const generatePDF = require('../utils/pdfGenerator');

const ttdFolder = path.join(__dirname, '../assets/ttd/');

const formatTanggalLMD = (date) => {
    const d = new Date(date);
    return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
};

const hariIndonesia = (date) => moment(date).locale('id').format('dddd');

async function handleExport(chat, user, pesan, db, paramBulan=null) {
    if(!db || !user?.id) return;

    const query = (sql, params=[]) =>
        new Promise((res, rej) =>
            db.query(sql, params, (err, r) => err ? rej(err) : res(r))
        );

    try {
        const [dbUser] = await query(`SELECT * FROM users WHERE id=?`, [user.id]);
        if(!dbUser) return;

        user = { ...user, ...dbUser };

        const nama_wa = user.pushname || user.nama_wa || 'Arta';
        const text = pesan.toLowerCase().trim();

        /* =========================
           COMMAND /EXPORT
        ========================= */
        if (text === '/export') {
            await query(`
                UPDATE users 
                SET step_input='start_export',
                    template_export=NULL,
                    export_type=NULL
                WHERE id=?
            `, [user.id]);

            user.step_input = 'start_export';
        }

        /* =========================
           STEP: START EXPORT
        ========================= */
        if (user.step_input === 'start_export') {
            await query(
                `UPDATE users SET step_input='choose_export_type' WHERE id=?`,
                [user.id]
            );

            return sendTyping(
                chat,
                `Halo *${nama_wa}*, mau export *Absensi* atau *Lembur*?\nBalas *absensi* atau *lembur*`
            );
        }

        /* =========================
           STEP: CHOOSE EXPORT TYPE
        ========================= */
        if (user.step_input === 'choose_export_type') {
            if (!['absensi', 'lembur'].includes(text))
                return sendTyping(chat, 'Balas *absensi* atau *lembur* ya.');

            // CEK PENDING HANYA UNTUK JENIS TERPILIH
            const [pendingApproval] = await query(
                `SELECT file_path 
                FROM approvals 
                WHERE user_id=? 
                AND source='export'
                AND status='pending'
                AND user_approved=1
                AND file_path LIKE ? 
                ORDER BY created_at DESC 
                LIMIT 1`,
                [user.id, (text==='lembur' ? 'LEMBUR-%' : 'ABSENSI-%')]
            );

            if (pendingApproval) {
                return sendTyping(
                    chat,
                    `Kamu masih punya laporan *${text.toUpperCase()}* yang menunggu approval.\nSilakan tunggu sampai proses approval selesai.`
                );
            }

            // SIMPAN PILIHAN & LANJUT KE TEMPLATE
            await query(
                `UPDATE users 
                SET export_type=?, step_input='choose_template' 
                WHERE id=?`,
                [text, user.id]
            );

            return sendTyping(
                chat,
                `Pilih template:\n1. KSPS\n2. LMD\nBalas *ksps* atau *lmd*`
            );
        }


        /* =========================
           STEP: CHOOSE TEMPLATE
        ========================= */
        if (user.step_input === 'choose_template') {
            if (!['ksps', 'lmd'].includes(text))
                return sendTyping(chat, 'Balas *ksps* atau *lmd* ya.');

            await query(
                `UPDATE users 
                 SET template_export=?, step_input=NULL 
                 WHERE id=?`,
                [text.toUpperCase(), user.id]
            );

            const [freshUser] = await query(
                `SELECT * FROM users WHERE id=?`,
                [user.id]
            );

            if (freshUser.export_type === 'absensi') {
                return generatePDFandSend(chat, freshUser, db, paramBulan);
            } else {
                return generatePDFLembur(chat, freshUser, db);
            }
        }

    } catch (err) {
        console.error(err);
        return sendTyping(chat, 'Terjadi kesalahan saat export.');
    }
}

/* ==============================
   GENERATE PDF ABSENSI
============================== */
async function generatePDFandSend(chat, user, db, paramBulan){
    const query = (sql, params=[]) =>
        new Promise((res, rej) => db.query(sql, params, (err,r)=>err?rej(err):res(r)));

    try {
        const [approver] = await query(
            `SELECT * FROM users WHERE jabatan='Head' LIMIT 1`
        );

        const approverWA   = approver?.wa_number || null;
        const approverNama = approver?.nama_lengkap || '-';
        const approverNik  = approver?.nik || '-';

        const templateName = user.template_export || 'LMD';
        const templateSafe = templateName.toLowerCase();

        const bulanNama = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
        const now = new Date();
        let bulan = now.getMonth();
        let tahun = now.getFullYear();

        if(paramBulan){
            const idx = bulanNama.findIndex(b=>b.toLowerCase()===paramBulan.toLowerCase());
            if(idx!==-1) bulan=idx;
        }

        const totalHari = new Date(tahun, bulan+1, 0).getDate();
        const periode = templateName === 'LMD'
            ? `${bulanNama[bulan]} ${tahun}`
            : `1 - ${totalHari} ${bulanNama[bulan]} ${tahun}`;

        const absensi = await query(
            `SELECT * FROM absensi WHERE user_id=? AND MONTH(tanggal)=? AND YEAR(tanggal)=? ORDER BY tanggal`,
            [user.id, bulan+1, tahun]
        );

        const rows=[];
        for(let i=1;i<=totalHari;i++){
            const d = moment(`${tahun}-${bulan+1}-${i}`,'YYYY-M-D');
            const r = absensi.find(a=>moment(a.tanggal).format('YYYY-MM-DD')===d.format('YYYY-MM-DD'));
            const libur = [0,6].includes(d.day());

            rows.push(templateName === 'LMD'
                ? `<tr style="background-color:${libur?'#f15a5a':'#FFF'}">
                     <td>${formatTanggalLMD(d)}</td>
                     <td>${hariIndonesia(d)}</td>
                     <td>${r?.jam_masuk||'-'}</td>
                     <td>${r?.jam_pulang||'-'}</td>
                     <td>${r?.deskripsi||'-'}</td>
                   </tr>`
                : `<tr style="background-color:${libur?'#f0f0f0':'#FFF'}">
                     <td>${i}</td>
                     <td>${r?.jam_masuk||''}</td>
                     <td>${r?.jam_pulang||''}</td>
                     <td>${libur?'<b>LIBUR</b>':(r?.deskripsi||'')}</td>
                     <td></td>
                   </tr>`
            );
        }

        const logoFile = path.join(__dirname, `../assets/logo/${templateSafe}.png`);
        const logoBase64 = fs.existsSync(logoFile)
            ? 'data:image/png;base64,'+fs.readFileSync(logoFile).toString('base64')
            : '';

        const ttdPng = path.join(ttdFolder,`${user.wa_number}.png`);
        const ttdJpg = path.join(ttdFolder,`${user.wa_number}.jpg`);
        let ttdUserBase64='';
        if(fs.existsSync(ttdPng)) ttdUserBase64=fs.readFileSync(ttdPng,'base64');
        else if(fs.existsSync(ttdJpg)) ttdUserBase64=fs.readFileSync(ttdJpg,'base64');

        const ttdUserHTML = ttdUserBase64
            ? `<img src="data:image/png;base64,${ttdUserBase64}" style="max-width:150px;max-height:80px;">`
            : '';

        const templatePath = path.join(__dirname, `../templates/absensi/${templateName}.html`);
        let html = fs.readFileSync(templatePath,'utf8');

        html = html
            .replace(/{{logo}}/g,logoBase64)
            .replace(/{{nama}}/g,user.nama_lengkap||'-')
            .replace(/{{jabatan}}/g,user.jabatan||'-')
            .replace(/{{nik}}/g,user.nik||'-')
            .replace(/{{periode}}/g,periode)
            .replace(/{{rows_absensi}}/g,rows.join(''))
            .replace(/{{ttd_user}}/g,ttdUserHTML)
            .replace(/{{nama_atasan}}/g,approverNama)
            .replace(/{{nik_atasan}}/g,approverNik);

        const exportsDir = path.join(__dirname,'../exports');
        if(!fs.existsSync(exportsDir)) fs.mkdirSync(exportsDir,{recursive:true});

        const pdfFile = path.join(exportsDir, `ABSENSI-${user.nama_lengkap}-${templateName}.pdf`);

        await generatePDF(html,pdfFile);
        await chat.sendMessage(MessageMedia.fromFilePath(pdfFile));

        await query(
            `INSERT INTO approvals 
             (user_id, approver_wa, file_path, template_export, status, source,
              created_at, ttd_user_at, nama_atasan, nik_atasan)
             VALUES (?, ?, ?, ?, 'pending', 'export', NOW(), NOW(), ?, ?)`,
            [
                user.id,
                approverWA,
                path.basename(pdfFile),
                templateName,
                approverNama,
                approverNik
            ]
        );

        await sendTyping(chat,'Laporan absensi berhasil dibuat.');

    } catch(err){
        console.error(err);
        return sendTyping(chat,'Terjadi kesalahan saat membuat PDF absensi.');
    }
}

/* ==============================
   GENERATE PDF LEMBUR
============================== */
async function generatePDFLembur(chat, user, db){
    const query = (sql, params=[]) =>
        new Promise((res, rej) =>
            db.query(sql, params, (err,r)=>err?rej(err):res(r))
        );

    try {
        const templateName = user.template_export || 'LMD';

        const [approver] = await query(
            `SELECT * FROM users WHERE jabatan='Head' LIMIT 1`
        );

        const approverWA   = approver?.wa_number || null;
        const approverNama = approver?.nama_lengkap || '-';
        const approverNik  = approver?.nik || '-';

        const lemburData = await query(
            `SELECT * FROM lembur WHERE user_id=? ORDER BY tanggal`,
            [user.id]
        );

        if(!lemburData.length)
            return sendTyping(chat,'Belum ada data lembur.');

        const bulanNama = [
            'Januari','Februari','Maret','April','Mei','Juni',
            'Juli','Agustus','September','Oktober','November','Desember'
        ];

        const firstTanggal = new Date(lemburData[0].tanggal);

        let periode = templateName === 'LMD'
            ? `${bulanNama[firstTanggal.getMonth()]} ${firstTanggal.getFullYear()}`
            : `1 - ${new Date(firstTanggal.getFullYear(), firstTanggal.getMonth()+1, 0).getDate()} ${bulanNama[firstTanggal.getMonth()]} ${firstTanggal.getFullYear()}`;

        const rows = [];

        if(templateName === 'LMD'){
            for(const l of lemburData){
                rows.push(`<tr>
                    <td>${moment(l.tanggal).format('DD/MM/YYYY')}</td>
                    <td>${moment(l.tanggal).locale('id').format('dddd')}</td>
                    <td>${l.jam_mulai || '-'}</td>
                    <td>${l.jam_selesai || '-'}</td>
                    <td>${l.total_lembur || '-'}</td>
                    <td>${l.deskripsi || '-'}</td>
                </tr>`);
            }
        } else {
            const totalHari = new Date(firstTanggal.getFullYear(), firstTanggal.getMonth()+1, 0).getDate();

            for(let i=1;i<=totalHari;i++){
                const dateObj = moment(`${firstTanggal.getFullYear()}-${firstTanggal.getMonth()+1}-${i}`,'YYYY-M-D');
                const r = lemburData.find(l => moment(l.tanggal).format('YYYY-MM-DD') === dateObj.format('YYYY-MM-DD'));

                rows.push(`<tr>
                    <td>${i}</td>
                    <td>${r?.jam_mulai || ''}</td>
                    <td>${r?.jam_selesai || ''}</td>
                    <td>${r?.total_lembur || ''}</td>
                    <td>${r?.deskripsi || ''}</td>
                    <td></td>
                </tr>`);
            }
        }

        const logoFile = path.join(__dirname, `../assets/logo/${templateName.toLowerCase()}.png`);
        const logoBase64 = fs.existsSync(logoFile)
            ? 'data:image/png;base64,' + fs.readFileSync(logoFile).toString('base64')
            : '';

        const ttdPng = path.join(ttdFolder,`${user.wa_number}.png`);
        const ttdJpg = path.join(ttdFolder,`${user.wa_number}.jpg`);
        let ttdUserBase64 = '';

        if(fs.existsSync(ttdPng)) ttdUserBase64 = fs.readFileSync(ttdPng,'base64');
        else if(fs.existsSync(ttdJpg)) ttdUserBase64 = fs.readFileSync(ttdJpg,'base64');

        const ttdUserHTML = ttdUserBase64
            ? `<img src="data:image/png;base64,${ttdUserBase64}" style="max-width:150px; max-height:80px;" />`
            : '';

        const templatePath = path.join(__dirname, `../templates/lembur/${templateName}.html`);
        let html = fs.readFileSync(templatePath,'utf8');

        html = html
            .replace(/{{logo}}/g, logoBase64)
            .replace(/{{rows_lembur}}/g, rows.join(''))
            .replace(/{{nama}}/g, user.nama_lengkap || '-')
            .replace(/{{jabatan}}/g, user.jabatan || '-')
            .replace(/{{nik}}/g, user.nik || '-')
            .replace(/{{periode}}/g, periode)
            .replace(/{{ttd_user}}/g, ttdUserHTML)
            .replace(/{{nama_atasan}}/g, approverNama)
            .replace(/{{nik_atasan}}/g, approverNik)
            .replace(/{{ttd_atasan}}/g, '');

        const exportsDir = path.join(__dirname,'../exports');
        if(!fs.existsSync(exportsDir)) fs.mkdirSync(exportsDir,{recursive:true});

        const pdfFile = path.join(exportsDir, `LEMBUR-${user.nama_lengkap}-${templateName}.pdf`);

        await generatePDF(html, pdfFile);
        await chat.sendMessage(MessageMedia.fromFilePath(pdfFile));

        await query(
            `INSERT INTO approvals 
             (user_id, approver_wa, file_path, template_export, status, source,
              created_at, ttd_user_at, nama_atasan, nik_atasan)
             VALUES (?, ?, ?, ?, 'pending', 'export', NOW(), NOW(), ?, ?)`,
            [
                user.id,
                approverWA,
                path.basename(pdfFile),
                templateName,
                approverNama,
                approverNik
            ]
        );

        await sendTyping(chat,'PDF lembur berhasil dibuat.');

    } catch(err){
        console.error('PDF LEMBUR ERROR:', err);
        return sendTyping(chat,'Terjadi kesalahan saat membuat PDF lembur.');
    }
}

module.exports = {
    handleExport,
    generatePDFandSend,
    generatePDFLembur
};
