/**
 * E-Posta Gönderim Sistemi
 * SMTP sunucusu üzerinden e-posta gönderir
 */

const nodemailer = require('nodemailer');
const path = require('path');
const ejs = require('ejs');
const { getSettings } = require('./database');

let transporter = null;

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.MAIL_HOST || '127.0.0.1',
      port: parseInt(process.env.MAIL_PORT) || 587,
      secure: false,
      auth: {
        user: process.env.MAIL_USER || process.env.SMTP_USER || 'noreply@cayadev.com',
        pass: process.env.MAIL_PASSWORD || process.env.SMTP_SERVER_PASSWORD || ''
      },
      tls: { rejectUnauthorized: false }
    });
  }
  return transporter;
}

/**
 * E-posta şablonunu render et
 */
async function renderTemplate(templateName, data) {
  const settings = getSettings();
  const templateData = {
    ...data,
    siteName: settings.site_name || 'E-Ticaret',
    siteUrl: settings.site_url || process.env.SITE_URL || 'http://localhost:3000',
    primaryColor: settings.primary_color || '#2563eb',
    currencySymbol: settings.currency_symbol || '₺',
    year: new Date().getFullYear()
  };

  const templatePath = path.join(__dirname, '..', 'views', 'emails', `${templateName}.ejs`);
  return ejs.renderFile(templatePath, templateData);
}

/**
 * E-posta gönder
 */
async function sendMail(to, subject, templateName, data = {}) {
  try {
    const settings = getSettings();
    const fromName = settings.site_name || process.env.MAIL_FROM_NAME || 'E-Ticaret';
    const fromEmail = process.env.MAIL_FROM_EMAIL || process.env.MAIL_USER || 'noreply@site.com';
    const html = await renderTemplate(templateName, data);

    const info = await getTransporter().sendMail({
      from: `"${fromName}" <${fromEmail}>`,
      to,
      subject: `${subject} - ${fromName}`,
      html
    });

    console.log(`📧 E-posta gönderildi: ${to} - ${subject} (${info.messageId})`);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error(`❌ E-posta gönderilemedi: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * Hoş geldiniz e-postası
 */
async function sendWelcomeEmail(user, verifyUrl) {
  return sendMail(user.email, 'Hoş Geldiniz', 'welcome', { user, verifyUrl });
}

/**
 * E-posta doğrulama
 */
async function sendVerificationEmail(user, verifyUrl) {
  return sendMail(user.email, 'E-posta Doğrulama', 'verify', { user, verifyUrl });
}

/**
 * Şifre sıfırlama
 */
async function sendPasswordResetEmail(user, resetUrl) {
  return sendMail(user.email, 'Şifre Sıfırlama', 'reset', { user, resetUrl });
}

/**
 * Sipariş onayı
 */
async function sendOrderConfirmation(user, order, items, ibanInfo) {
  return sendMail(user.email, `Sipariş Onayı #${order.order_number}`, 'order', { user, order, items, ibanInfo: ibanInfo || null });
}

/**
 * Sipariş durum güncelleme
 */
async function sendOrderStatusUpdate(user, order, statusText) {
  return sendMail(user.email, `Sipariş Güncelleme #${order.order_number}`, 'order-status', { user, order, statusText });
}

/**
 * Ödeme onayı
 */
async function sendPaymentConfirmation(user, order) {
  return sendMail(user.email, `Ödeme Onayı #${order.order_number}`, 'payment-confirmed', { user, order });
}

/**
 * Kargo takip bilgisi gönder
 */
async function sendCargoTrackingEmail(user, order) {
  return sendMail(user.email, `Kargo Bilgisi #${order.order_number}`, 'cargo-tracking', { user, order });
}

/**
 * Fatura e-postası gönder (PDF ek ile)
 */
async function sendInvoiceEmail(user, order, invoicePath) {
  try {
    const settings = getSettings();
    const fromName = settings.site_name || process.env.MAIL_FROM_NAME || 'E-Ticaret';
    const fromEmail = process.env.MAIL_FROM_EMAIL || process.env.MAIL_USER || 'noreply@site.com';
    const html = await renderTemplate('invoice', { user, order });
    const fileName = `Fatura_${order.order_number}.pdf`;

    const info = await getTransporter().sendMail({
      from: `"${fromName}" <${fromEmail}>`,
      to: user.email,
      subject: `Fatura #${order.order_number} - ${fromName}`,
      html,
      attachments: [{
        filename: fileName,
        path: invoicePath
      }]
    });

    console.log(`📧 Fatura gönderildi: ${user.email} - #${order.order_number} (${info.messageId})`);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error(`❌ Fatura e-postası gönderilemedi: ${error.message}`);
    return { success: false, error: error.message };
  }
}

module.exports = {
  sendMail,
  sendWelcomeEmail,
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendOrderConfirmation,
  sendOrderStatusUpdate,
  sendPaymentConfirmation,
  sendCargoTrackingEmail,
  sendInvoiceEmail,
  renderTemplate
};
