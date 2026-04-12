# ETicaretSystemCYDev (CaYaDev Ticaret)

**Türkçe** | [English](#english)

Node.js + Express + EJS ile yazılmış, tek sunucuda çalışan, veritabanı olarak dosya tabanlı SQLite (sql.js / WASM) kullanan bir e-ticaret altyapısı. Mağaza, blog, kullanıcı hesabı ve kapsamlı bir yönetim paneli içerir.

## Özellikler

- **Katalog:** kategoriler, ürünler, çoklu ürün görseli (sharp ile işleme), ürün filtreleri, SEO dostu slug'lar
- **Sepet ve ödeme:** sepet API'si (`/api/cart`), adres ve fatura profili seçimiyle checkout
- **Ödeme:** IBAN/havale ile ödeme (sipariş başına `PAY-XXXX` ödeme kodu, müşteri "ödedim" onayı, admin onayı). Admin panelinde 3. parti kart sağlayıcı (iyzico, PayTR vb.) ayarları saklanabilir, ancak gerçek bir kart ödeme entegrasyonu kodda **yoktur**
- **Siparişler:** durum takibi, kargo takip, fatura e-postası, kullanıcı tarafından iptal
- **Hesap:** kayıt, giriş, e-posta doğrulama, şifre sıfırlama, adresler, fatura profilleri, Google OAuth ve CaYaDev OAuth ile giriş
- **Blog:** yazılar (Markdown, `marked` + `sanitize-html`)
- **Yönetim paneli (`/admin`):** gösterge paneli, ürün/kategori/sipariş/kullanıcı/yazı yönetimi, site ayarları ve tema, ödeme ayarları, ziyaret analitiği, yasal sayfalar, backlink'ler, iletişim yöntemleri, ana sayfa bölümleri ve slider, rol bazlı yetkiler (admin/editor)
- **E-postalar:** hoş geldin, doğrulama, şifre sıfırlama, sipariş, ödeme onayı, durum değişikliği, kargo takip, fatura (EJS şablonları, nodemailer)
- **Dahili SMTP sunucusu** (`smtp-server.js`, `npm run smtp`)
- **SEO:** `sitemap.xml`, `sitemap.txt`, `robots.txt`
- **Güvenlik:** helmet, rate limit (giriş/kayıt/şifre sıfırlama), CSRF koruması, bcrypt, dosya yükleme doğrulaması

## Teknolojiler

Node.js, Express 4, EJS + ejs-mate, sql.js (SQLite), express-session + session-file-store, bcryptjs, jsonwebtoken, multer, sharp, nodemailer, smtp-server, mailparser, helmet, express-rate-limit, axios.

## Gereksinimler

- Node.js 18+ ve npm
- Harici bir veritabanı sunucusu gerekmez; veritabanı `data/database.sqlite` dosyasında ilk çalıştırmada otomatik oluşturulur

## Kurulum

```bash
npm install
cp .env.example .env   # Windows: copy .env.example .env
```

`.env` anahtarları:

| Anahtar | Açıklama |
|---|---|
| `PORT`, `NODE_ENV` | Sunucu portu ve ortam |
| `SESSION_SECRET`, `JWT_SECRET` | Uzun, rastgele değerler kullanın (CSRF anahtarı da `SESSION_SECRET`'tan türetilir) |
| `SITE_URL`, `SITE_NAME`, `SITE_DESCRIPTION` | Site bilgileri (e-posta bağlantılarında kullanılır) |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME` | İlk admin hesabı |
| `SMTP_PORT`, `SMTP_BIND`, `SMTP_USER`, `SMTP_SERVER_PASSWORD` | Dahili SMTP sunucusu |
| `MAIL_HOST`, `MAIL_PORT`, `MAIL_USER`, `MAIL_PASSWORD`, `MAIL_FROM_NAME`, `MAIL_FROM_EMAIL` | Giden e-posta |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` | Google ile giriş (opsiyonel) |
| `CAYADEV_CLIENT_ID`, `CAYADEV_CLIENT_SECRET`, `CAYADEV_REDIRECT_URI` | CaYaDev OAuth (opsiyonel, bkz. `CaYaDev_OAuth_Entegrasyonu.md`) |
| `IBAN_*`, `PAYMENT_*` | Ödeme bilgileri (panelden de ayarlanabilir) |

E-posta kurulumu için `MAIL_SETUP.md` dosyasına bakın.

## Çalıştırma

```bash
npm start        # üretim
npm run dev      # nodemon ile geliştirme
npm run smtp     # dahili SMTP sunucusu
```

Varsayılan adres: http://localhost:3000, panel: http://localhost:3000/admin

## Varsayılan admin

İlk çalıştırmada hiç admin yoksa `ADMIN_EMAIL` / `ADMIN_PASSWORD` ile bir admin oluşturulur. `ADMIN_PASSWORD` tanımlı değilse rastgele bir şifre üretilir ve konsola yazılır.

## Proje yapısı

```
server.js            Uygulama girişi
smtp-server.js       Dahili SMTP sunucusu
config/              database.js (şema, seed), mail.js
middleware/          auth, rateLimit, security, upload
routes/              index, shop, blog, auth, account, api, admin, sitemap
views/               pages, admin, emails, layouts, partials (EJS)
public/              css, js, görseller
uploads/             Yüklenen dosyalar (repoda yok)
data/                SQLite veritabanı ve oturumlar (repoda yok)
```

## Güvenlik notları

- `.env`, `data/`, `logs/` ve `uploads/` repoya dahil edilmemiştir.
- Yayın öncesinde koddaki sabit varsayılan admin şifresi ve sabit CSRF yedek anahtarı kaldırıldı; artık ortam değişkeninden okunuyor ya da rastgele üretiliyor.
- Üretimde HTTPS ve güçlü `SESSION_SECRET` kullanın.

## Bilinen sorunlar

- Kart ödeme sağlayıcısı için yalnızca ayar ekranı var, gerçek ödeme entegrasyonu yok.
- Veritabanı sql.js ile bellekte tutulup dosyaya yazılıyor; yüksek trafik ve çoklu süreç için uygun değil.
- `test_admin.js` ve `test_admin2.js` geliştirme sırasında kullanılan hata ayıklama betikleridir.
- Otomatik test yok.

## Proje tarihleri

- **Oluşturma:** Ekim 2025 (en eski dosya: 4 Ekim 2025)
- **Son güncelleme:** 13 Nisan 2026

## Lisans

Lisans belirtilmemiştir.

---

<a name="english"></a>
# English

An e-commerce platform built with Node.js, Express and EJS, running as a single server with a file-based SQLite database (sql.js / WASM). It includes a shop, a blog, user accounts and an extensive admin panel.

## Features

- **Catalog:** categories, products, multiple product images (processed with sharp), product filters, SEO-friendly slugs
- **Cart & checkout:** cart API (`/api/cart`), checkout with address and billing profile selection
- **Payment:** bank transfer (IBAN) with a per-order `PAY-XXXX` payment code, customer "I paid" confirmation and admin approval. Card provider settings (iyzico, PayTR, etc.) can be stored in the admin panel, but there is **no** actual card payment integration in the code
- **Orders:** status tracking, cargo tracking, invoice email, customer cancellation
- **Accounts:** registration, login, email verification, password reset, addresses, billing profiles, Google OAuth and CaYaDev OAuth login
- **Blog:** posts (Markdown via `marked` + `sanitize-html`)
- **Admin panel (`/admin`):** dashboard, products/categories/orders/users/posts, site settings and theme, payment settings, visit analytics, legal pages, backlinks, contact methods, homepage sections and slider, role-based permissions (admin/editor)
- **Emails:** welcome, verification, password reset, order, payment confirmed, status change, cargo tracking, invoice (EJS templates, nodemailer)
- **Built-in SMTP server** (`smtp-server.js`, `npm run smtp`)
- **SEO:** `sitemap.xml`, `sitemap.txt`, `robots.txt`
- **Security:** helmet, rate limiting (login/register/password reset), CSRF protection, bcrypt, upload validation

## Tech

Node.js, Express 4, EJS + ejs-mate, sql.js (SQLite), express-session + session-file-store, bcryptjs, jsonwebtoken, multer, sharp, nodemailer, smtp-server, mailparser, helmet, express-rate-limit, axios.

## Requirements

- Node.js 18+ and npm
- No external database server; the database is created automatically at `data/database.sqlite` on first run

## Setup

```bash
npm install
cp .env.example .env
```

Fill in `.env` (see the key table in the Turkish section): session/JWT secrets, site info, initial admin, SMTP and mail settings, optional Google/CaYaDev OAuth, and IBAN/payment info.

## Run

```bash
npm start
npm run dev
npm run smtp
```

Default: http://localhost:3000, admin panel at `/admin`.

## Default admin

On first run, if no admin exists, one is created from `ADMIN_EMAIL` / `ADMIN_PASSWORD`. If `ADMIN_PASSWORD` is not set, a random password is generated and printed to the console.

## Security notes

- `.env`, `data/`, `logs/` and `uploads/` are not included in the repository.
- Before publishing, a hard-coded default admin password and a hard-coded CSRF fallback key were removed; they now come from environment variables or are generated randomly.

## Known issues

- Card payment provider has a settings screen only, no real integration.
- sql.js keeps the database in memory and writes it to a file; not suitable for heavy traffic or multiple processes.
- `test_admin.js` / `test_admin2.js` are debugging scripts.
- No automated tests.

## Project dates

- **Created:** October 2025 (oldest file: 4 October 2025)
- **Last updated:** 13 April 2026

## License

No license specified.