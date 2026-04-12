# 📧 CaYaDev Mail Sunucusu Kurulum Rehberi

## 🎯 Genel Bakış

Bu rehber, CaYaDev için kendi mail sunucunuzu nasıl kuracağınızı ve yapılandıracağınızı açıklar. Üçüncü taraf mail sağlayıcılarına (Gmail, SendGrid vb.) ihtiyaç duymadan kendi domain'inizden mail gönderebilirsiniz.

## ⚙️ Kurulum Adımları

### 1. Gerekli Paketler
```bash
npm install nodemailer dotenv
```

### 2. Ortam Değişkenlerini Ayarlama

`.env.example` dosyasını `.env` olarak kopyalayın ve değerleri güncelleyin:

```bash
cp .env.example .env
```

`.env` dosyasını düzenleyin:
```env
MAIL_HOST=cayadev.com
MAIL_PORT=587
MAIL_USER=recover@cayadev.com
MAIL_PASSWORD=güvenli-şifreniz-buraya
MAIL_FROM_NAME=CaYaDev Support
MAIL_FROM_EMAIL=recover@cayadev.com
```

### 3. DNS Kayıtlarını Yapılandırma

Domain sağlayıcınızın (GoDaddy, Namecheap, Cloudflare vb.) DNS yönetim panelinden aşağıdaki kayıtları ekleyin:

#### A) MX Kayıtları (Mail Exchange)
Mail sunucunuzu tanımlar:

```
Type: MX
Name: @
Priority: 10
Value: mail.cayadev.com
TTL: 3600
```

#### B) A Kaydı (Mail Sunucusu)
Mail sunucunuzun IP adresini belirtir:

```
Type: A
Name: mail
Value: SUNUCU_IP_ADRESINIZ
TTL: 3600
```

#### C) SPF Kaydı (Sender Policy Framework)
Kimlik doğrulama için:

```
Type: TXT
Name: @
Value: v=spf1 mx a ip4:SUNUCU_IP_ADRESINIZ ~all
TTL: 3600
```

#### D) DKIM Kaydı (DomainKeys Identified Mail)
E-posta imzalama için:

```
Type: TXT
Name: default._domainkey
Value: v=DKIM1; k=rsa; p=YOUR_PUBLIC_KEY_HERE
TTL: 3600
```

DKIM key oluşturmak için:
```bash
openssl genrsa -out dkim_private.pem 2048
openssl rsa -in dkim_private.pem -pubout -outform der 2>/dev/null | openssl base64 -A
```

#### E) DMARC Kaydı (Domain-based Message Authentication)
Mail politikalarını belirtir:

```
Type: TXT
Name: _dmarc
Value: v=DMARC1; p=quarantine; rua=mailto:dmarc-reports@cayadev.com
TTL: 3600
```

### 4. Port Yönlendirmeleri

Router'ınızdan aşağıdaki portları yönlendirin:

- **Port 25** (SMTP) - Gelen mail için
- **Port 587** (STARTTLS) - Giden mail için (önerilen)
- **Port 465** (SMTPS/SSL) - Giden mail için (alternatif)

### 5. Firewall Ayarları

Windows Firewall'da portları açın:

```powershell
# PowerShell (Yönetici olarak çalıştırın)
New-NetFirewallRule -DisplayName "SMTP Port 25" -Direction Inbound -Protocol TCP -LocalPort 25 -Action Allow
New-NetFirewallRule -DisplayName "SMTP Port 587" -Direction Inbound -Protocol TCP -LocalPort 587 -Action Allow
New-NetFirewallRule -DisplayName "SMTP Port 465" -Direction Inbound -Protocol TCP -LocalPort 465 -Action Allow
```

### 6. SSL/TLS Sertifikaları

Let's Encrypt ile ücretsiz SSL sertifikası alın:

```bash
# Certbot kurulumu (Windows)
choco install certbot

# Sertifika oluşturma
certbot certonly --standalone -d mail.cayadev.com
```

Veya mevcut Cloudflare sertifikalarınızı kullanın.

## 🧪 Test Etme

### 1. DNS Kayıtlarını Kontrol Edin

```bash
# MX kaydını kontrol et
nslookup -type=mx cayadev.com

# SPF kaydını kontrol et
nslookup -type=txt cayadev.com

# DKIM kaydını kontrol et
nslookup -type=txt default._domainkey.cayadev.com
```

### 2. Online Araçlar

- **MXToolbox**: https://mxtoolbox.com/SuperTool.aspx
- **Mail-Tester**: https://www.mail-tester.com/
- **DKIM Validator**: https://dkimvalidator.com/

### 3. Test Maili Gönderme

Server'ı çalıştırın ve şifremi unuttum özelliğini deneyin:

```bash
npm start
```

Tarayıcıda `http://localhost/` adresine gidin ve "Şifremi Unuttum" linkine tıklayın.

## 📊 Mail Gönderimi İzleme

Server loglarında mail gönderimini takip edin:

```
✉️ Mail gönderildi: <message-id>
✅ Password reset email sent to: user@example.com
```

## ⚠️ Önemli Güvenlik Notları

1. **Şifre Güvenliği**: `.env` dosyasını asla Git'e eklemeyin
2. **Rate Limiting**: Spam önlemek için rate limiting aktif
3. **Token Süresi**: Reset tokenları 1 saat geçerli
4. **Tek Kullanım**: Her token sadece bir kez kullanılabilir
5. **HTTPS**: Mutlaka HTTPS kullanın (token güvenliği için)

## 🔧 Sorun Giderme

### Mail Gitmiyor

1. DNS kayıtlarını kontrol edin (propagasyon 24-48 saat sürebilir)
2. Port yönlendirmelerini kontrol edin
3. Firewall ayarlarını kontrol edin
4. Mail server loglarını kontrol edin

### Spam Klasörüne Düşüyor

1. SPF, DKIM, DMARC kayıtlarını düzeltin
2. PTR kaydı ekleyin (Reverse DNS)
3. IP reputation'ınızı kontrol edin
4. Blacklist kontrolü yapın

### Connection Timeout

1. ISP'nizin port 25'i bloke edip etmediğini kontrol edin
2. Port 587 (STARTTLS) kullanmayı deneyin
3. Firewall ve antivirus yazılımlarını kontrol edin

## 📝 Ek Kaynaklar

- [Nodemailer Dokümantasyonu](https://nodemailer.com/)
- [SPF Kayıt Oluşturucu](https://www.spfwizard.net/)
- [DKIM Validator](https://dkimvalidator.com/)
- [Mail Server Test Tools](https://mxtoolbox.com/)

## 🎉 Başarı!

Mail sisteminiz artık hazır! Kullanıcılar şifrelerini sıfırlayabilir ve `recover@cayadev.com` adresinden mail alabilirler.

## 📞 Destek

Sorun yaşarsanız:
- GitHub Issues: [cayadev-web/issues](https://github.com/cayadev/cayadev-web/issues)
- Email: support@cayadev.com
