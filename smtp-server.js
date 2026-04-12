/**
 * Custom SMTP Server
 * Basit, güvenilir, sadece giden mail için SMTP sunucusu
 */

const { SMTPServer } = require('smtp-server');
const { simpleParser } = require('mailparser');
const nodemailer = require('nodemailer');
const dns = require('dns').promises;
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// SMTP Server Configuration
const SITE_NAME = process.env.SITE_NAME || 'E-Ticaret';
const SMTP_PORT = parseInt(process.env.SMTP_PORT) || 587;
const SMTP_HOST = process.env.SMTP_BIND || '127.0.0.1'; // Bind to localhost by default
const SMTP_USER = process.env.SMTP_USER || 'noreply@localhost';
const SMTP_PASSWORD = process.env.SMTP_SERVER_PASSWORD || (() => {
  try {
    const envPath = path.join(__dirname, '.env');
    if (process.env.SMTP_SERVER_PASSWORD) return process.env.SMTP_SERVER_PASSWORD;
    const generated = require('crypto').randomBytes(24).toString('hex');
    let env = {};
    if (fs.existsSync(envPath)) {
      const raw = fs.readFileSync(envPath, 'utf8');
      raw.split('\n').forEach(line => {
        const idx = line.indexOf('=');
        if (idx > 0) {
          const k = line.substring(0, idx).trim();
          const v = line.substring(idx + 1).trim();
          if (k) env[k] = v;
        }
      });
    }
    env['SMTP_SERVER_PASSWORD'] = generated;
    const content = Object.keys(env).map(k => `${k}=${env[k]}`).join('\n') + '\n';
    fs.writeFileSync(envPath, content, { mode: 0o600 });
    console.log('🔐 Generated SMTP_SERVER_PASSWORD and stored in .env');
    process.env.SMTP_SERVER_PASSWORD = generated;
    return generated;
  } catch (e) {
    console.warn('⚠️ Could not persist SMTP_SERVER_PASSWORD to .env, using ephemeral generated password');
    const generated = require('crypto').randomBytes(24).toString('hex');
    process.env.SMTP_SERVER_PASSWORD = generated;
    return generated;
  }
})();

// Log klasörünü oluştur
const LOG_DIR = path.join(__dirname, 'logs', 'smtp');
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

// Log fonksiyonu
function log(message, level = 'INFO') {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] [${level}] ${message}\n`;
  
  console.log(logMessage.trim());
  
  // Log dosyasına yaz
  const logFile = path.join(LOG_DIR, `smtp-${new Date().toISOString().split('T')[0]}.log`);
  fs.appendFileSync(logFile, logMessage);
}

// Mail queue (basit implementasyon)
const mailQueue = [];
let isProcessing = false;

// Hedef sunucunun MX kaydını bul
async function getMXRecords(domain) {
  try {
    const records = await dns.resolveMx(domain);
    if (records && records.length > 0) {
      // En düşük priority'ye sahip MX kaydını seç
      records.sort((a, b) => a.priority - b.priority);
      return records[0].exchange;
    }
  } catch (error) {
    log(`⚠️ MX lookup failed for ${domain}: ${error.message}`, 'WARN');
  }
  return null;
}

// Direkt SMTP ile mail gönder
// fromHeader: mesaj başlığında olacak From (ör. "CaYaDev - Doğrulama <verify@cayadev.com>")
// envelopeFrom: SMTP envelope MAIL FROM (ör. verify@cayadev.com)
async function sendDirectMail(to, fromHeader, envelopeFrom, subject, html, text) {
  // to array ise ilk elemanı al
  const toAddress = Array.isArray(to) ? to[0] : to;
  const domain = toAddress.split('@')[1];
  const mxHost = await getMXRecords(domain);

  if (!mxHost) {
    throw new Error(`MX record not found for ${domain}`);
  }

  log(`🌐 MX record for ${domain}: ${mxHost}`, 'INFO');

  // Hedef sunucuya bağlan (port 25 - standart SMTP)
  const transporter = nodemailer.createTransport({
    host: mxHost,
    port: 25,
    secure: false,
    name: process.env.SMTP_HELO || 'localhost', // HELO/EHLO hostname
    tls: {
      rejectUnauthorized: process.env.NODE_ENV === 'production'
    },
    connectionTimeout: 10000,
    greetingTimeout: 5000
  });

  const mailOptions = {
    // Header From: display adıyla gönder
    from: fromHeader || envelopeFrom,
    to: toAddress,
    subject: subject,
    text: text || 'Bu bir HTML email\'dir. Lütfen HTML destekli bir email istemcisi kullanın.',
    html: html,
    // Envelope olarak SMTP MAIL FROM'u zorla
    envelope: {
      from: envelopeFrom,
      to: toAddress
    }
  };

  const info = await transporter.sendMail(mailOptions);
  return info;
}

// Mail kuyruğunu işle (gerçek SMTP gönderimi)
async function processMailQueue() {
  if (isProcessing || mailQueue.length === 0) return;
  
  isProcessing = true;
  
  while (mailQueue.length > 0) {
    const mail = mailQueue.shift();
    
    try {
      log(`📧 Processing mail: ${mail.subject} to ${mail.to}`, 'INFO');
      
      // Gerçek mail gönderimi (headerFrom vs envelopeFrom ayrımı)
      const info = await sendDirectMail(
        mail.to,
        mail.headerFrom,   // header From (display name + address)
        mail.envelopeFrom, // SMTP MAIL FROM
        mail.subject,
        mail.html,
        mail.text
      );
      
      log(`✅ Mail sent successfully: ${mail.subject} (${info.messageId})`, 'SUCCESS');
      
      // Mail içeriğini dosyaya kaydet (backup)
      const mailFile = path.join(LOG_DIR, 'sent', `mail-${Date.now()}.json`);
      const sentDir = path.join(LOG_DIR, 'sent');
      if (!fs.existsSync(sentDir)) {
        fs.mkdirSync(sentDir, { recursive: true });
      }
      
      fs.writeFileSync(mailFile, JSON.stringify({ ...mail, sentInfo: info }, null, 2));
      
    } catch (error) {
      log(`❌ Mail sending failed: ${error.message}`, 'ERROR');
      
      // Hatalı mail'i dosyaya kaydet
      const failedDir = path.join(LOG_DIR, 'failed');
      if (!fs.existsSync(failedDir)) {
        fs.mkdirSync(failedDir, { recursive: true });
      }
      const failFile = path.join(failedDir, `failed-${Date.now()}.json`);
      fs.writeFileSync(failFile, JSON.stringify({ ...mail, error: error.message }, null, 2));
    }
  }
  
  isProcessing = false;
}

// SMTP Server oluştur
const server = new SMTPServer({
  // Authentication
  onAuth(auth, session, callback) {
    const username = auth.username;
    const password = auth.password;
    
    log(`🔐 Auth attempt: ${username} from ${session.remoteAddress}`, 'AUTH');
    
    if (username === SMTP_USER && password === SMTP_PASSWORD) {
      log(`✅ Auth successful: ${username}`, 'AUTH');
      callback(null, { user: username });
    } else {
      log(`❌ Auth failed: ${username}`, 'AUTH');
      callback(new Error('Invalid username or password'));
    }
  },

  // Mail handler
  onData(stream, session, callback) {
    log(`📨 Receiving mail from ${session.envelope.mailFrom.address}`, 'MAIL');
    
    simpleParser(stream, (err, parsed) => {
      if (err) {
        log(`❌ Mail parsing error: ${err.message}`, 'ERROR');
        return callback(err);
      }
      
      // parsed.from may contain a display name (header From). Preserve it for headers,
      // and keep envelope MAIL FROM separately for SMTP envelope.
      const headerFrom = (parsed && parsed.from && parsed.from.text) ? parsed.from.text : session.envelope.mailFrom.address;
      const envelopeFrom = session.envelope.mailFrom.address;

      // Mail bilgilerini queue'ya ekle
      const mail = {
        headerFrom: headerFrom,
        envelopeFrom: envelopeFrom,
        to: session.envelope.rcptTo.map(r => r.address),
        subject: parsed.subject,
        text: parsed.text,
        html: parsed.html,
        date: new Date().toISOString(),
        messageId: parsed.messageId
      };
      
      mailQueue.push(mail);
      
      log(`✅ Mail queued: ${mail.subject} (Queue size: ${mailQueue.length})`, 'MAIL');
      
      // Mail queue'yu işle
      setTimeout(() => processMailQueue(), 100);
      
      callback(null, 'Message queued for delivery');
    });
  },

  // Server options
  secure: false, // STARTTLS kullanıyoruz
  authOptional: false, // Auth zorunlu
  size: 10 * 1024 * 1024, // Max 10MB
  
  // Banner
  banner: SITE_NAME + ' SMTP Server Ready',
  
  // Logging
  logger: false, // Kendi log sistemimizi kullanıyoruz
  
  // Connection options
  disabledCommands: ['STARTTLS'], // TLS şimdilik kapalı
  hideSTARTTLS: true
});

// Error handler
server.on('error', (err) => {
  log(`❌ SMTP Server Error: ${err.message}`, 'ERROR');
  console.error(err);
});

// Log retention: remove files older than 20 days
function smtpRemoveOldLogs() {
  try {
    const cutoff = Date.now() - (20 * 24 * 60 * 60 * 1000);
    if (!fs.existsSync(LOG_DIR)) return;
    fs.readdirSync(LOG_DIR).forEach(fn => {
      const full = path.join(LOG_DIR, fn);
      try {
        const st = fs.statSync(full);
        if (st.isFile() && st.mtimeMs < cutoff) {
          fs.unlinkSync(full);
          log(`🗑️ Removed old SMTP log file: ${full}`, 'INFO');
        }
        if (st.isDirectory()) {
          fs.readdirSync(full).forEach(sub => {
            const subFull = path.join(full, sub);
            try {
              const s2 = fs.statSync(subFull);
              if (s2.isFile() && s2.mtimeMs < cutoff) {
                fs.unlinkSync(subFull);
                log(`🗑️ Removed old SMTP sub-log: ${subFull}`, 'INFO');
              }
            } catch (e) {}
          });
        }
      } catch (e) {}
    });
  } catch (e) {
    console.error('SMTP log cleanup error:', e && e.message ? e.message : e);
  }
}

try { smtpRemoveOldLogs(); } catch (e) {}
setInterval(smtpRemoveOldLogs, 24 * 60 * 60 * 1000);

// Sunucuyu başlat
server.listen(SMTP_PORT, SMTP_HOST, () => {
  log(`🚀 SMTP Server started on ${SMTP_HOST}:${SMTP_PORT}`, 'STARTUP');
  log(`📧 Ready to accept mail for ${SMTP_USER}`, 'STARTUP');
  log(`🔐 Authentication required`, 'STARTUP');
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║        🚀 ${SITE_NAME} SMTP Server${' '.repeat(Math.max(0, 37 - SITE_NAME.length))}║
║                                                           ║
║        Host: ${SMTP_HOST.padEnd(42)}   ║
║        Port: ${SMTP_PORT.toString().padEnd(42)}   ║
║        User: ${SMTP_USER.padEnd(42)}   ║
║                                                           ║
║        Status: ✅ RUNNING                                 ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
  `);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  log('⚠️  SIGTERM received, shutting down gracefully...', 'SHUTDOWN');
  server.close(() => {
    log('✅ SMTP Server closed', 'SHUTDOWN');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  log('⚠️  SIGINT received, shutting down gracefully...', 'SHUTDOWN');
  server.close(() => {
    log('✅ SMTP Server closed', 'SHUTDOWN');
    process.exit(0);
  });
});

module.exports = server;
