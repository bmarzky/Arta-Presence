const cron = require('node-cron');

module.exports = function startReminder(client, db) {
  console.log('Reminder service started');

  function isWeekday() {
    const day = new Date().getDay();
    return day !== 0 && day !== 6; // Senin–Jumat
  }

  // PAGI — 08.00 (ABSEN MASUK)

  cron.schedule('0 8 * * *', () => {
    console.log('[CRON PAGI]', new Date().toLocaleString('id-ID'));

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
      if (users.length === 0) return;

      for (const user of users) {
        const pesan =
`Selamat pagi *${user.nama_wa || 'User'}* ☀️

Kamu belum melakukan *absen masuk* hari ini.

Ketik:
*absen masuk*`;

        try {
          await client.sendMessage(`${user.wa_number}@c.us`, pesan);
        } catch (e) {
          console.error('WA send failed (pagi):', user.wa_number, e.message);
        }
      }
    });
  }, { timezone: 'Asia/Jakarta' });

  // SORE — 17.30 (ABSEN PULANG)

  cron.schedule('30 17 * * *', () => {
    console.log('[CRON SORE]', new Date().toLocaleString('id-ID'));

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
      if (users.length === 0) return;

      for (const user of users) {
        const pesan =
`Hai *${user.nama_wa || 'User'}* 👋

Waktunya pulang.
Jangan lupa lakukan *absen pulang* ya.

Ketik:
*absen pulang*`;

        try {
          await client.sendMessage(`${user.wa_number}@c.us`, pesan);
        } catch (e) {
          console.error('WA send failed (sore):', user.wa_number, e.message);
        }
      }
    });
  }, { timezone: 'Asia/Jakarta' });
};
