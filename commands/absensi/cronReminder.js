const cron = require('node-cron');
const intentAI = require('../../utils/intentAI');

module.exports = function startReminder(client, db) {
  console.log('Reminder service started');

  let waReady = false;

  if (client?.ev) {
    client.ev.on('connection.update', ({ connection }) => {
      if (connection === 'open') {
        waReady = true;
        console.log('WhatsApp connected — Reminder aktif');
      }
    });
  } else {
    waReady = true;
  }

  // HELPER
  function isWeekday() {
    const day = new Date().getDay();
    return day !== 0 && day !== 6; // Senin–Jumat
  }

  function toWAJid(number) {
    if (!number) return null;

    let n = number.toString().trim();
    n = n.replace(/[^0-9]/g, '');

    if (n.startsWith('0')) n = '62' + n.slice(1);
    if (!n.startsWith('62')) return null;

    return `${n}@s.whatsapp.net`; // BAILEYS FORMAT
  }

  // corn pagi — 08.00 absen masuk
  cron.schedule(
    '0 8 * * *',
    () => {
      console.log('[CRON PAGI]', new Date().toLocaleString('id-ID'));

      if (!waReady) {
        console.log('WA belum ready (pagi)');
        return;
      }

      if (!isWeekday()) {
        console.log('Bukan hari kerja (pagi)');
        return;
      }

      const query = `
        SELECT u.wa_number, u.nama_wa
        FROM users u
        LEFT JOIN absensi a
          ON u.id = a.user_id
          AND a.tanggal = CURDATE()
        WHERE a.id IS NULL
           OR a.jam_masuk IS NULL
           OR a.jam_masuk = ''
      `;

      db.query(query, async (err, users) => {
        if (err) {
          console.error('DB error pagi:', err);
          return;
        }

        console.log(`Pagi: kirim ke ${users.length} user`);
        if (!users.length) return;

        for (const user of users) {
          const jid = toWAJid(user.wa_number);
          if (!jid) continue;

          const pesan = 
`Selamat pagi *${user.nama_wa || 'User'}* 

Kamu belum melakukan *absen masuk* hari ini.

Ketik:
*absen masuk*`;

          try {
            await client.sendMessage(jid, { text: pesan });
            console.log('Sent pagi →', jid);
          } catch (e) {
            console.error('WA send failed (pagi):', jid, e.message);
          }
        }
      });
    },
    { timezone: 'Asia/Jakarta' }
  );

  // Cron sore — 17.30 (absen pulang)
  cron.schedule(
    '40 17 * * *',
    () => {
      console.log('[CRON SORE]', new Date().toLocaleString('id-ID'));

      if (!waReady) {
        console.log('WA belum ready (sore)');
        return;
      }

      if (!isWeekday()) {
        console.log('Bukan hari kerja (sore)');
        return;
      }

      const query = `
        SELECT u.wa_number, u.nama_wa
        FROM users u
        JOIN absensi a
          ON u.id = a.user_id
          AND a.tanggal = CURDATE()
        WHERE a.jam_masuk IS NOT NULL
          AND a.jam_masuk != ''
          AND (a.jam_pulang IS NULL OR a.jam_pulang = '')
      `;

      db.query(query, async (err, users) => {
        if (err) {
          console.error('DB error sore:', err);
          return;
        }

        console.log(`Sore: kirim ke ${users.length} user`);
        if (!users.length) return;

        for (const user of users) {
          const jid = toWAJid(user.wa_number);
          if (!jid) continue;

          const pesan =
`Hai *${user.nama_wa || 'User'}*

Sudah Terlambat Untuk Pulang.
Jangan lupa lakukan *absen pulang* ya.

Ketik:
*absen pulang*`;

          try {
            await client.sendMessage(jid, { text: pesan });
            console.log('Sent sore →', jid);
          } catch (e) {
            console.error('WA send failed (sore):', jid, e.message);
          }
        }
      });
    },
    { timezone: 'Asia/Jakarta' }
  );
};
